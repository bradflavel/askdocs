# AskDocs — Evaluation Harness

A separate script — **not part of the running app** — at `eval/run.py`. This is how you turn retrieval and prompt tuning from vibes into measurements. Used throughout Phase 3 to justify the hybrid-search upgrade with numbers, and thereafter whenever chunking, retrieval, or prompts change.

Sibling docs: [PIPELINES.md](PIPELINES.md) for the pipelines being measured, [PLAN.md](PLAN.md) for phase context.

---

## Dataset

20–30 question / expected-answer pairs against a known document. Pick a textbook chapter or a public dataset paper so the ground truth is verifiable. Store as `eval/dataset.yaml`:

```yaml
document: fixtures/paper.pdf
questions:
  - q: "What dataset does the paper evaluate on?"
    expected_answer: "SQuAD 2.0"
    gold_evidence:
      - "We evaluate on SQuAD 2.0"              # exact or near-exact verbatim snippet
  - q: "What is the reported F1 score?"
    expected_answer: "89.3"
    gold_evidence:
      - "F1 = 89.3"
      - "achieves an F1 of 89.3"                # any match counts — alternatives for paraphrase tolerance
```

Fixtures go under `eval/fixtures/`. Commit them so runs are reproducible.

**Why snippets, not page numbers?** Multiple chunks can live on one page; a page-based gold signal can score the system as "correct" even when the specific chunk containing the answer was missed. Snippets pin the gold to the actual evidence text. A retrieved chunk counts as a match when its `content` contains any listed snippet (case-insensitive, whitespace-normalized).

---

## Metrics

- **Recall@5** — did any top-5 retrieved chunk contain a gold snippet? Binary per question, averaged across the set.
- **MRR (mean reciprocal rank)** — `1 / rank_of_first_matching_chunk`, averaged. Captures *how high* the gold evidence was ranked, not just whether it was in the top-k.
- **Faithfulness** — does the generated answer contain only claims supported by the retrieved chunks? Use an LLM judge: send the chunks + answer to `gpt-4o-mini` with a strict yes/no rubric. Approximate, but repeatable.

---

## Output

A markdown table written to `eval/results/**/{timestamp}.md` (see Commit Policy below for folder routing):

| Question | Gold snippet (first) | Retrieved? | Rank | Faithful? |
|----------|----------------------|------------|------|-----------|
| What dataset is used? | "We evaluate on SQuAD 2.0" | ✓ | 2 | ✓ |
| ... | ... | ✗ | — | — |

Plus an aggregate row: `Recall@5 = 0.85, MRR = 0.71, Faithfulness = 0.92`.

---

## Commit Policy

Not every run belongs in git. Split by intent:

- `eval/results/milestones/` — **committed.** End-of-phase runs, baselines, and any run where a material metric moved. Name files `{YYYY-MM-DD}-{label}.md` (e.g. `2026-05-15-hybrid-rrf-baseline.md`).
- `eval/results/dev/` — **gitignored.** Routine iteration runs while tuning prompts or chunk sizes. Keep locally for short-term comparison, discard freely.

Add `eval/results/dev/` to `.gitignore`. The milestone folder tells the story of what moved the needle without flooding the repo with timestamped near-duplicates.

---

## Usage

- Re-run whenever chunking, retrieval, or prompts change.
- Decisions (e.g. "should we add the cross-encoder?") are answered with numbers from the milestone tables, not hunches. See [PIPELINES.md](PIPELINES.md#re-ranking-deferred-add-only-if-eval-shows-gain) for the primary deferred decision this gates.

---

## Libraries

- `pyyaml` — dataset loading
- `openai` — LLM judge for faithfulness
- Reuses backend retrieval modules from `backend/app/retrieval/` — no new stack.
