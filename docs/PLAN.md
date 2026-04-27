# AskDocs — Plan

An in-depth plan for **AskDocs**, a RAG-powered document Q&A application. This file is the entry point — it holds the scope, phased build order, edge cases, and deferred decisions. Deeper technical content lives in the companion docs.

## Documents

| File | Contents |
|------|----------|
| [PLAN.md](PLAN.md) | Overview, phases, edge cases, deferred decisions *(this file)* |
| [ARCHITECTURE.md](ARCHITECTURE.md) | System diagram, request flows, directory layout, deployment |
| [DATA_MODEL.md](DATA_MODEL.md) | Postgres schema + pgvector/tsvector DDL |
| [PIPELINES.md](PIPELINES.md) | Ingestion, retrieval (hybrid + RRF), generation, backend libraries |
| [FRONTEND.md](FRONTEND.md) | Screens, components, frontend libraries |
| [API.md](API.md) | FastAPI endpoint surface |
| [EVAL.md](EVAL.md) | Evaluation harness, metrics, dataset format |

---

## Overview

AskDocs is a two-service web app that lets a user upload PDFs and DOCX files, then ask questions against them and get grounded, cited answers. It is built to showcase a production-grade retrieval pipeline — hybrid search (vector + BM25), reciprocal rank fusion, streaming generation, inline citations, and a repeatable evaluation harness that turns retrieval tuning into a measured activity rather than vibes.

**What gets built:**

- A **Next.js frontend** for upload, chat, and citation viewing — see [FRONTEND.md](FRONTEND.md)
- A **FastAPI backend** for ingestion, retrieval, and generation — see [PIPELINES.md](PIPELINES.md) and [API.md](API.md)
- A **single Postgres database with pgvector** holding users, documents, chunks, embeddings, and conversations — see [DATA_MODEL.md](DATA_MODEL.md)
- An **evaluation harness** that scores retrieval quality (recall@5, MRR) and answer faithfulness — see [EVAL.md](EVAL.md)

No separate vector DB. No Redis at MVP. One Postgres instance is enough.

---

## Phased Build

Roughly 3–4 weeks of focused work. Each phase has a concrete success gate; do not advance until the gate passes.

| Phase | Week | Scope | Success Gate |
|-------|------|-------|--------------|
| **1. Ingestion & Storage** | 1 | Auth, upload endpoint, PDF/DOCX parsing, chunking, embedding, Postgres schema with pgvector, minimal upload form | "I can upload a PDF and see chunks with embeddings in the database." |
| **2. Basic Retrieval & Chat** | 2 | Vector-only search, chat endpoint, SSE streaming, working chat UI | "I can ask a question and get a grounded answer with streaming." |
| **3. Hybrid, Citations, Eval** | 3 | BM25, RRF fusion, citation rendering + source panel, evaluation harness, measure before/after | "Recall@5 went from X to Y after adding hybrid search, with numbers." |
| **4. Polish & Deploy** | 4 | Error states, file validation, loading skeletons, conversation list + rename/delete, Vercel + Railway deploy, README + architecture diagram + decisions doc | "Public URL works end-to-end and the README is publishable." |

Cross-encoder reranking and OCR are explicitly **not** in any phase — add only if post-Phase-3 evaluation data (see [EVAL.md](EVAL.md)) says they'd move the needle.

---

## Edge Cases

Handle these honestly at MVP. Don't pretend they don't exist, and don't over-engineer around them.

| Case | Behavior |
|------|----------|
| **Scanned PDFs** (no text layer) | Detect empty text extraction after parse, fail with a clear error: "This PDF has no text layer. OCR support is on the roadmap." No silent OCR fallback at MVP. |
| **Very large files** | Hard cap at **50MB** enforced at the upload endpoint. Return 413. |
| **Tables / multi-column layouts** | Fall back to `unstructured` when `pypdf` output is degraded — concrete trigger defined in [PIPELINES.md](PIPELINES.md#parser-fallback-heuristic). |
| **Non-English documents** | BM25 uses Postgres `english` text-search config. Non-English docs retrieve via vector-only (BM25 produces near-empty results). MVP is English-first; multi-language is a v2. |
| **Cross-document questions** | Out of scope at MVP — chat is scoped to a single document per conversation. Multi-doc is a v2 feature. |
| **Duplicate upload** | Detected via `(user_id, file_hash)`. Returns `200 OK` with `{duplicate: true, id, status}` pointing at the existing document (not `409`). See [API.md](API.md#post-documents). |
| **Failed ingestion** | Surface `documents.error` in the UI. Let the user delete and retry. Do not auto-retry. |
| **Empty BM25 result** (user query has no indexable tokens) | Skip BM25, use vector-only for that query. RRF handles a single list gracefully. |

---

## Decisions Deferred

Choices consciously punted to keep MVP scope tight. Each has a trigger that would bring it back.

| Deferred | Trigger to revisit |
|----------|--------------------|
| Separate vector DB (Pinecone, Weaviate, Qdrant) | Query latency on `chunks.embedding` exceeds ~200ms at 1M+ chunks, after HNSW tuning |
| Redis / background queue (Celery, RQ, arq) | Ingestion queue depth regularly exceeds what a single FastAPI worker absorbs in <30s |
| OCR for scanned PDFs (Tesseract) | >10% of upload attempts fail the "no text layer" check |
| Multi-document conversations | Real user demand, and a clear UX for selecting document scope |
| Cross-encoder reranking | Eval shows Phase 3 recall@5 below ~0.8 after hybrid + RRF |
| S3-backed storage | Disk usage on Railway exceeds the plan's included volume |
| Fine-grained permissions / sharing | More than one user asks for it |

---

*Start with Phase 1. See [PIPELINES.md](PIPELINES.md) and [DATA_MODEL.md](DATA_MODEL.md) for day-one implementation targets.*

---

## Status (2026-04-27)

All four phases shipped and merged to `main`; Phase 5 (audit fixes) and Phase 6 (UI polish) followed. The Phase 4 gate artefacts live at:

- **README** — [`README.md`](../README.md) at repo root, with the live demo URL
- **Architecture diagram** — ASCII block in [`ARCHITECTURE.md`](ARCHITECTURE.md) under the system-diagram section
- **Decisions doc** — [`DECISIONS.md`](DECISIONS.md), full chronological log
- **Eval results** — milestone markdown under `eval/results/milestones/`
