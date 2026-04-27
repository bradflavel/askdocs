"""AskDocs evaluation harness.

Runs retrieval + generation against a dataset of question / gold_evidence
pairs, measures recall@5, MRR, and LLM-judged faithfulness, and writes
a markdown comparison table to eval/results/.

Run inside the api container (the backend package is importable there):

    docker compose exec api python /eval/run.py --mode both --label baseline

Flags:
    --mode {vector,hybrid,both}   retrieval mode(s) to score (default: both)
    --label NAME                  filename suffix for the output markdown
    --dev                         write to results/dev/ (gitignored) instead
                                  of results/milestones/

The script ingests the fixture document into a dedicated eval user on
first run; subsequent runs reuse it via the (user_id, file_hash) dedupe
so embedding cost is paid once.
"""
from __future__ import annotations

import argparse
import asyncio
import hashlib
import re
from datetime import date
from pathlib import Path

import yaml
from openai import AsyncOpenAI
from sqlalchemy import select

from app.chat.prompt import ContextChunk, build_messages
from app.config import get_settings
from app.db import session_scope
from app.documents.chunk import token_aware_split
from app.documents.parse import parse_document
from app.models import Chunk, Document, User
from app.retrieval.bm25 import search_bm25
from app.retrieval.embed import embed_all
from app.retrieval.fuse import rrf
from app.retrieval.vector import search_vector

ROOT = Path(__file__).resolve().parent
EVAL_USER_EMAIL = "eval@askdocs.local"


async def ensure_eval_user() -> int:
    async with session_scope() as s:
        existing = (
            await s.execute(select(User).where(User.email == EVAL_USER_EMAIL))
        ).scalar_one_or_none()
        if existing:
            return existing.id
        user = User(email=EVAL_USER_EMAIL, password_hash="eval-not-a-real-password")
        s.add(user)
        await s.flush()
        return user.id


async def ensure_fixture_ingested(user_id: int, fixture_path: Path) -> int:
    hasher = hashlib.sha256()
    with open(fixture_path, "rb") as f:
        for buf in iter(lambda: f.read(1 << 20), b""):
            hasher.update(buf)
    file_hash = hasher.hexdigest()

    async with session_scope() as s:
        existing = (
            await s.execute(
                select(Document).where(
                    Document.user_id == user_id,
                    Document.file_hash == file_hash,
                )
            )
        ).scalar_one_or_none()
        if existing and existing.status == "ready":
            print(f"[eval] fixture already ingested (document_id={existing.id})")
            return existing.id
        if existing:
            # Half-ingested row from a previous failed/interrupted run.
            # Drop it so the insert below doesn't trip the
            # (user_id, file_hash) unique constraint.
            print(
                f"[eval] removing existing non-ready fixture row "
                f"(document_id={existing.id}, status={existing.status})"
            )
            await s.delete(existing)

    print(f"[eval] ingesting {fixture_path} ...")
    pages = parse_document(fixture_path)
    pieces = token_aware_split(pages, 500, 50)
    vectors = await embed_all([p.content for p in pieces])

    async with session_scope() as s:
        doc = Document(
            user_id=user_id,
            filename=fixture_path.name,
            file_hash=file_hash,
            status="ready",
            page_count=len(pages),
        )
        s.add(doc)
        await s.flush()
        s.add_all(
            Chunk(
                document_id=doc.id,
                chunk_index=idx,
                content=p.content,
                page_start=p.page_start,
                page_end=p.page_end,
                char_start=p.char_start,
                char_end=p.char_end,
                embedding=v,
            )
            for idx, (p, v) in enumerate(zip(pieces, vectors, strict=True))
        )
        doc_id = doc.id
    print(f"[eval] ingested document_id={doc_id} with {len(pieces)} chunks")
    return doc_id


def _normalize(text: str) -> str:
    return re.sub(r"\s+", " ", text).strip().lower()


def matches_any(chunk_content: str, snippets: list[str]) -> bool:
    n = _normalize(chunk_content)
    return any(_normalize(s) in n for s in snippets)


async def retrieve_top_k(
    mode: str, document_id: int, question: str, k: int
) -> list[int]:
    async with session_scope() as s:
        q_emb = (await embed_all([question]))[0]
        vec = await search_vector(s, document_id, q_emb, k=k)
        if mode == "vector":
            return vec
        bm25 = await search_bm25(s, document_id, question, k=k)
        lists = [vec]
        if bm25:
            lists.append(bm25)
        fused = rrf(lists)
        return [cid for cid, _ in fused]


async def load_chunks(chunk_ids: list[int]) -> list[Chunk]:
    if not chunk_ids:
        return []
    async with session_scope() as s:
        rows = (
            await s.execute(select(Chunk).where(Chunk.id.in_(chunk_ids)))
        ).scalars().all()
    by_id = {c.id: c for c in rows}
    return [by_id[cid] for cid in chunk_ids if cid in by_id]


async def generate_answer(chunks: list[Chunk], question: str) -> str:
    context = [
        ContextChunk(
            id=c.id,
            content=c.content,
            page_start=c.page_start or 1,
            page_end=c.page_end or 1,
        )
        for c in chunks
    ]
    messages = build_messages(context, [], question)
    settings = get_settings()
    client = AsyncOpenAI(api_key=settings.openai_api_key)
    resp = await client.chat.completions.create(
        model=settings.chat_model,
        messages=messages,
    )
    return resp.choices[0].message.content or ""


async def judge_faithfulness(
    question: str, answer: str, chunks: list[str]
) -> bool:
    settings = get_settings()
    client = AsyncOpenAI(api_key=settings.openai_api_key)
    context_str = "\n\n---\n\n".join(chunks)
    user_prompt = (
        f"QUESTION:\n{question}\n\n"
        f"CONTEXT:\n{context_str}\n\n"
        f"ANSWER:\n{answer}\n\n"
        "Is every factual claim in the answer supported by the context? "
        "Respond with exactly YES or NO."
    )
    resp = await client.chat.completions.create(
        model="gpt-4o-mini",
        messages=[
            {
                "role": "system",
                "content": (
                    "You evaluate whether an answer is supported by provided context. "
                    "Ignore citation markers like [chunk:123]. Respond only with YES or NO."
                ),
            },
            {"role": "user", "content": user_prompt},
        ],
        temperature=0,
    )
    text = (resp.choices[0].message.content or "").strip().upper()
    return text.startswith("YES")


async def evaluate_mode(
    mode: str, document_id: int, questions: list[dict], k: int = 20
) -> list[dict]:
    results = []
    for i, q in enumerate(questions, 1):
        text = q["q"]
        gold = q["gold_evidence"]
        print(f"[{mode}] Q{i}/{len(questions)}: {text[:60]}")

        top_ids = await retrieve_top_k(mode, document_id, text, k)
        top_chunks = await load_chunks(top_ids)

        rank = None
        for r, c in enumerate(top_chunks, 1):
            if matches_any(c.content, gold):
                rank = r
                break
        retrieved_top5 = rank is not None and rank <= 5

        context_chunks = top_chunks[:8]
        answer = await generate_answer(context_chunks, text)
        faithful = await judge_faithfulness(
            text, answer, [c.content for c in context_chunks]
        )

        results.append(
            {
                "q": text,
                "first_gold": gold[0],
                "retrieved_top5": retrieved_top5,
                "rank": rank,
                "faithful": faithful,
            }
        )
    return results


def summarize(results: list[dict]) -> dict:
    n = len(results)
    return {
        "recall_at_5": sum(1 for r in results if r["retrieved_top5"]) / n,
        "mrr": sum((1 / r["rank"]) if r["rank"] else 0 for r in results) / n,
        "faithfulness": sum(1 for r in results if r["faithful"]) / n,
    }


def render_markdown(
    results_by_mode: dict[str, list[dict]],
    summary_by_mode: dict[str, dict],
    label: str,
) -> str:
    out = [f"# Eval run — {label}", "", f"Date: {date.today().isoformat()}", ""]
    out += [
        "## Summary",
        "",
        "| Mode | Recall@5 | MRR | Faithfulness |",
        "|------|----------|-----|--------------|",
    ]
    for mode, s in summary_by_mode.items():
        out.append(
            f"| {mode} | {s['recall_at_5']:.2f} | {s['mrr']:.2f} | "
            f"{s['faithfulness']:.2f} |"
        )
    out.append("")

    for mode, results in results_by_mode.items():
        out.append(f"## Per-question — {mode}")
        out.append("")
        out.append(
            "| # | Question | Gold (first) | Retrieved@5? | Rank | Faithful? |"
        )
        out.append(
            "|---|----------|--------------|--------------|------|-----------|"
        )
        for i, r in enumerate(results, 1):
            q_trunc = r["q"][:60] + ("..." if len(r["q"]) > 60 else "")
            g_trunc = r["first_gold"][:50] + (
                "..." if len(r["first_gold"]) > 50 else ""
            )
            out.append(
                f"| {i} | {q_trunc} | {g_trunc} | "
                f"{'✓' if r['retrieved_top5'] else '✗'} | "
                f"{r['rank'] if r['rank'] else '—'} | "
                f"{'✓' if r['faithful'] else '✗'} |"
            )
        out.append("")
    return "\n".join(out)


async def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--mode", choices=["vector", "hybrid", "both"], default="both"
    )
    parser.add_argument("--label", default="run")
    parser.add_argument("--dev", action="store_true")
    args = parser.parse_args()

    with open(ROOT / "dataset.yaml") as f:
        dataset = yaml.safe_load(f)
    fixture_path = ROOT / dataset["document"]
    if not fixture_path.exists():
        raise FileNotFoundError(
            f"fixture not found: {fixture_path}\n"
            "Download the BERT paper and place it at eval/fixtures/paper.pdf."
        )

    user_id = await ensure_eval_user()
    doc_id = await ensure_fixture_ingested(user_id, fixture_path)

    modes = ["vector", "hybrid"] if args.mode == "both" else [args.mode]
    results_by_mode: dict[str, list[dict]] = {}
    summary_by_mode: dict[str, dict] = {}
    for m in modes:
        results_by_mode[m] = await evaluate_mode(
            m, doc_id, dataset["questions"]
        )
        summary_by_mode[m] = summarize(results_by_mode[m])

    out_dir = ROOT / "results" / ("dev" if args.dev else "milestones")
    out_dir.mkdir(parents=True, exist_ok=True)
    out_path = out_dir / f"{date.today().isoformat()}-{args.label}.md"
    out_path.write_text(
        render_markdown(results_by_mode, summary_by_mode, args.label),
        encoding="utf-8",
    )
    print(f"\n[eval] wrote {out_path}")
    for m, s in summary_by_mode.items():
        print(
            f"  {m:>7}: recall@5={s['recall_at_5']:.2f} "
            f"mrr={s['mrr']:.2f} faithfulness={s['faithfulness']:.2f}"
        )


if __name__ == "__main__":
    asyncio.run(main())
