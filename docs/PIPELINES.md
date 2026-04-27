# AskDocs — Pipelines

The three core backend pipelines: ingestion, retrieval, and generation. These share data flow — chunk IDs produced by ingestion are consumed by retrieval and emitted as citations by generation — so they live in one document.

See also: [DATA_MODEL.md](DATA_MODEL.md) for the schema these pipelines read/write, [API.md](API.md) for the endpoints that invoke them, [EVAL.md](EVAL.md) for how retrieval quality is measured.

---

## Ingestion Pipeline

Triggered when the client uploads a file. Runs as a FastAPI `BackgroundTask` at MVP; upgrade to Celery/RQ/arq only if per-file processing exceeds what a single worker can absorb (see [PLAN.md](PLAN.md)). Operational caveats — restart durability, shared storage, single-instance assumption — are documented in [ARCHITECTURE.md](ARCHITECTURE.md#operational-caveats-at-mvp).

### Steps

1. Accept multipart upload. **Stream bytes to a temp path while hashing in a single pass** — never consume the body before persisting it. (We don't know the final path yet; there's no `document_id` until the row is inserted.)
2. Check `(user_id, file_hash)`. If it already exists, delete the temp file and return the existing document (see [API.md](API.md#post-documents) for the response contract).
3. Otherwise insert `documents` row with `status='pending'`, move the temp file to its final home at `./storage/{user_id}/{document_id}/{filename}`, return id to the client, kick off the background task.
4. Parse — `pypdf` for text-layer PDFs, `python-docx` for DOCX, `unstructured` as fallback when `pypdf` output is degraded (trigger below).
5. Chunk — **token-aware** recursive splitter targeting **~500 tokens per chunk, ~50 token overlap**, preserving `page_start`, `page_end`, `char_start`, `char_end`.
6. Embed — batch chunks to `text-embedding-3-small` in groups of ~100; OpenAI's endpoint accepts arrays.
7. Bulk insert `chunks` rows with `embedding` populated; the `tsv` column is computed automatically.
8. Update `documents.status = 'ready'` (or `'failed'` with an error message).

Chunking parameters are a tuning knob — the evaluation harness (see [EVAL.md](EVAL.md)) is how you pick the right numbers. Start with 500/50.

### Parser fallback heuristic

Use `unstructured` instead of `pypdf` when any of these hold after the first parse pass:

- Extracted text length averages **< 100 characters per page** across the document
- **More than 30%** of pages produce empty text
- The document is known to be table-heavy (future: a user-facing toggle)

This keeps `pypdf` as the cheap default and reserves `unstructured` for cases where `pypdf` demonstrably struggles.

### Code sketch

Stream-and-hash in one pass so the upload body is never consumed before it lands on disk:

```python
import hashlib, os
import aiofiles
from fastapi import BackgroundTasks, UploadFile

async def upload_document(file: UploadFile, user_id: int, bg: BackgroundTasks):
    tmp_path = make_tmp_path(user_id, file.filename)
    hasher = hashlib.sha256()
    async with aiofiles.open(tmp_path, "wb") as out:
        while chunk := await file.read(1 << 20):  # 1 MiB
            hasher.update(chunk)
            await out.write(chunk)
    file_hash = hasher.hexdigest()

    existing = find_document(user_id, file_hash)
    if existing:
        os.remove(tmp_path)
        return {"id": existing.id, "status": existing.status, "duplicate": True}

    doc = insert_document(user_id, file.filename, file_hash, status="pending")
    final_path = move_to_storage(tmp_path, user_id, doc.id)
    bg.add_task(process_document, doc.id, final_path)
    return {"id": doc.id, "status": "pending", "duplicate": False}

def process_document(doc_id: int, path: str):
    update_status(doc_id, "processing")
    try:
        pages = parse(path)                               # pypdf / python-docx / unstructured
        chunks = token_aware_split(pages, size=500, overlap=50)
        for batch in batched(chunks, 100):
            vectors = openai.embeddings.create(
                model="text-embedding-3-small",
                input=[c.content for c in batch],
            ).data
            bulk_insert_chunks(doc_id, batch, vectors)
        update_status(doc_id, "ready")
    except Exception as e:
        update_status(doc_id, "failed", error=str(e))
```

Use `RecursiveCharacterTextSplitter.from_tiktoken_encoder(...)` from `langchain-text-splitters` for `token_aware_split`, or a short custom wrapper around `tiktoken`.

---

## Retrieval Pipeline

Hybrid retrieval with reciprocal rank fusion. This is where the interesting work happens.

### Steps

1. Embed the user's question with `text-embedding-3-small` (same model as ingestion).
2. Resolve `document_id` server-side from the `conversation_id` in the request (clients don't pass it — see [DATA_MODEL.md](DATA_MODEL.md)).
3. Run two queries in parallel:
   - **Vector:** `SELECT id FROM chunks WHERE document_id = $1 ORDER BY embedding <=> $2 LIMIT 20`
   - **BM25:** `SELECT id FROM chunks WHERE document_id = $1 AND tsv @@ plainto_tsquery('english', $2) ORDER BY ts_rank(tsv, plainto_tsquery('english', $2)) DESC LIMIT 20`
4. Fuse the two ranked lists with **Reciprocal Rank Fusion**.
5. Take the top **5–8** fused results as context. **Remember this set of chunk IDs** — it is the *allowed citation set* for this turn (see Generation).
6. *(Phase 3+, optional)* Re-rank with `cross-encoder/ms-marco-MiniLM-L-6-v2` if the evaluation harness shows it's worth the latency.

BM25 uses Postgres' `english` text-search config, so non-English documents effectively run vector-only. This is an MVP constraint — see [PLAN.md](PLAN.md) edge cases.

### RRF — self-contained, no deps

```python
def rrf(ranked_lists: list[list[int]], k: int = 60) -> list[tuple[int, float]]:
    """Fuse multiple ranked lists of IDs into a single ranking.
    ranked_lists[i] is a list of chunk ids ordered best-first from source i.
    Returns (id, score) pairs sorted by score descending.
    """
    scores: dict[int, float] = {}
    for lst in ranked_lists:
        for rank, chunk_id in enumerate(lst):
            scores[chunk_id] = scores.get(chunk_id, 0.0) + 1.0 / (k + rank + 1)
    return sorted(scores.items(), key=lambda x: x[1], reverse=True)

# Usage:
vector_ids = [row.id for row in vector_results]   # top 20 from vector search
bm25_ids   = [row.id for row in bm25_results]     # top 20 from BM25
fused      = rrf([vector_ids, bm25_ids])[:8]      # top 8 fused
```

`k=60` is the Cormack/Clarke/Buettcher default and works well out of the box.

### Re-ranking (deferred, add only if eval shows gain)

```python
from sentence_transformers import CrossEncoder
ce = CrossEncoder("cross-encoder/ms-marco-MiniLM-L-6-v2")
pairs = [(question, chunk.content) for chunk in fused_chunks]
rerank_scores = ce.predict(pairs)
final = [c for _, c in sorted(zip(rerank_scores, fused_chunks), reverse=True)][:5]
```

Adds ~100–300ms of latency for a small model. Justify with numbers from [EVAL.md](EVAL.md) before turning it on.

---

## Generation

Build the prompt as a fixed template. Stream completions back to the client over Server-Sent Events.

### Prompt template

```text
SYSTEM:
You are a research assistant. Answer the user's question using ONLY the
information in the CONTEXT below. Cite sources inline using the format
[chunk:ID] after each claim, where ID is one of the chunk ids shown. If the
context does not contain the answer, reply exactly:
"I don't know based on the provided documents."
Do not invent facts, page numbers, or citations.

CONTEXT:
[chunk:123] (pages 4-4)
<chunk 123 content here>

[chunk:456] (pages 7-8)
<chunk 456 content here>

... (5-8 chunks total)

CONVERSATION HISTORY (last 6 messages):
user: <previous question>
assistant: <previous answer>
...

USER QUESTION:
<current question>
```

### Streaming

Use `StreamingResponse` from FastAPI with `media_type="text/event-stream"`. The exact event shape (event names, end-of-stream marker, error frame) is defined in [API.md](API.md#chat-stream-protocol). Frontend consumption is in [FRONTEND.md](FRONTEND.md#streaming-consumption).

### Citation parsing (server-side, validated)

On stream close — keep it simple, no mid-stream parsing:

1. Regex-extract `\[chunk:(\d+)\]` from the assembled assistant message.
2. **Filter extracted IDs against the allowed citation set** — the chunk IDs retrieved for this turn. Drop anything outside that set; the model occasionally hallucinates IDs like `[chunk:999999]`.
3. Dedupe the survivors. Persist as `messages.cited_chunk_ids`.

The frontend renders each surviving `[chunk:N]` as a clickable pill via a remark plugin that rewrites the MDAST (see [FRONTEND.md](FRONTEND.md#components)). IDs that didn't survive validation render as plain text — the transcript stays faithful to what the model wrote, but only real citations become interactive.

### History window

Include the last 6 messages (3 user + 3 assistant turns). Enough for conversational coherence, short enough to keep prompt tokens bounded.

---

## Backend Libraries

- `fastapi` — web framework
- `uvicorn` — ASGI server
- `sqlalchemy` + `alembic` — ORM + migrations
- `pgvector` (pgvector-python) — vector column type for SQLAlchemy
- `pydantic` + `pydantic-settings` — validation, config
- `python-jose` + `bcrypt` — JWT + password hashing (passlib was the original choice; replaced because it's unmaintained and incompatible with bcrypt 4.x)
- `aiofiles` — async file I/O for the stream-and-hash upload path
- `pypdf` — text-layer PDF parsing (primary)
- `python-docx` — DOCX parsing
- `unstructured` — fallback for messy PDFs with tables / multi-column. Optional via the `[fallback-parser]` extras group: dev image installs it; prod image skips it to save ~400MB and falls back only when pypdf extracts essentially no text.
- `langchain-text-splitters` — token-aware recursive splitter (or a short custom wrapper around `tiktoken`)
- `tiktoken` — tokenization for chunk-size budgeting
- `openai` — embeddings + completions
- `sentence-transformers` — cross-encoder reranking (Phase 3+ only, optional)
- `httpx` — async HTTP client
- `pytest` + `pytest-asyncio` — tests
