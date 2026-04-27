# AskDocs — Architecture

System shape, request flows, repo layout, and deployment. For phases and edge cases see [PLAN.md](PLAN.md); for schema see [DATA_MODEL.md](DATA_MODEL.md); for pipeline internals see [PIPELINES.md](PIPELINES.md).

---

## System Diagram

Two services, one database. The frontend talks to the backend over HTTPS; the backend talks to Postgres and the OpenAI API.

```text
┌────────────────────┐      HTTPS       ┌──────────────────────┐
│  Next.js Frontend  │ ───────────────► │  FastAPI Backend     │
│  (Vercel)          │ ◄─── SSE ─────── │  (Railway)           │
│                    │                  │                      │
│  - Upload UI       │                  │  - Auth              │
│  - Chat UI         │                  │  - Ingestion (bg)    │
│  - Citation panel  │                  │  - Retrieval         │
└────────────────────┘                  │  - Generation (SSE)  │
                                        └──────────┬───────────┘
                                                   │
                                        ┌──────────▼───────────┐
                                        │  Postgres + pgvector │
                                        │  (Railway)           │
                                        │  - users             │
                                        │  - documents         │
                                        │  - chunks (vec+tsv)  │
                                        │  - conversations     │
                                        │  - messages          │
                                        └──────────────────────┘
                                                   ▲
                                                   │  embeddings, completions
                                        ┌──────────┴───────────┐
                                        │  OpenAI API          │
                                        └──────────────────────┘
```

---

## Request Flows

**Upload:** client `POST /documents` → backend saves file, inserts `documents` row with `status='pending'`, schedules a FastAPI `BackgroundTask`, returns document id. Background task parses, chunks, embeds in batches, inserts `chunks` rows, updates `status='ready'`. Details in [PIPELINES.md](PIPELINES.md#ingestion-pipeline).

**Chat:** client `POST /chat` (SSE) → backend embeds question, runs vector + BM25 queries in parallel, fuses with RRF, builds prompt with retrieved chunks + last N messages, streams tokens back over SSE. On stream close, backend persists the user and assistant messages to `messages` with `cited_chunk_ids` populated. Details in [PIPELINES.md](PIPELINES.md#retrieval-pipeline).

---

## Proposed Directory Layout

```text
askdocs/
├── PLAN.md                        ← scope, phases, edge cases
├── ARCHITECTURE.md                ← this file
├── DATA_MODEL.md                  ← schema + DDL
├── PIPELINES.md                   ← ingestion / retrieval / generation
├── FRONTEND.md                    ← screens + components
├── API.md                         ← endpoint surface
├── EVAL.md                        ← evaluation harness
├── README.md
├── docker-compose.yml             ← postgres + api + web for local dev
├── .github/
│   └── workflows/
│       ├── backend-ci.yml         ← ruff check, ruff format, alembic, smoke test
│       └── frontend-ci.yml        ← tsc, next build
├── backend/
│   ├── pyproject.toml
│   ├── Dockerfile
│   ├── alembic.ini
│   ├── alembic/versions/
│   ├── app/
│   │   ├── main.py                ← FastAPI app factory
│   │   ├── config.py              ← pydantic-settings
│   │   ├── db.py                  ← SQLAlchemy engine + session
│   │   ├── models.py              ← SQLAlchemy models
│   │   ├── auth/
│   │   │   ├── routes.py
│   │   │   └── security.py        ← password hashing, JWT
│   │   ├── documents/
│   │   │   ├── routes.py          ← POST /documents, GET /documents
│   │   │   ├── ingest.py          ← background task
│   │   │   ├── parse.py           ← pypdf / docx / unstructured
│   │   │   └── chunk.py           ← recursive splitter
│   │   ├── retrieval/
│   │   │   ├── embed.py
│   │   │   ├── vector.py          ← cosine search
│   │   │   ├── bm25.py            ← tsvector search
│   │   │   └── fuse.py            ← RRF
│   │   ├── chat/
│   │   │   ├── routes.py          ← POST /chat (SSE)
│   │   │   └── prompt.py          ← template builder
│   │   └── storage.py             ← local disk → S3 later
│   └── tests/
│       └── test_smoke.py          ← register/upload/ask integration smoke
├── frontend/
│   ├── package.json
│   ├── next.config.ts
│   ├── tailwind.config.ts
│   ├── app/
│   │   ├── layout.tsx
│   │   ├── login/page.tsx
│   │   ├── library/page.tsx
│   │   ├── chat/[id]/page.tsx
│   │   └── api/                   ← minimal proxy routes if needed
│   ├── components/
│   │   ├── ui/                    ← shadcn/ui
│   │   ├── chat/
│   │   ├── library/
│   │   └── citation-panel.tsx
│   └── lib/
│       ├── api.ts                 ← typed backend client
│       └── sse.ts
└── eval/
    ├── run.py
    ├── dataset.yaml
    ├── fixtures/
    │   └── paper.pdf
    └── results/                   ← generated markdown tables
```

---

## Deployment

- **Frontend:** Vercel. Connect the `frontend/` directory as a project root. Env var: `NEXT_PUBLIC_API_URL`.
- **Backend + Postgres:** Railway. Two services:
  - Postgres service with the `vector` extension toggled on in Railway's settings.
  - FastAPI service built from `backend/Dockerfile`, connected to the Postgres service via Railway's private network.
- **Local dev:** `docker-compose up` brings up postgres, api, and web. Seed with `alembic upgrade head` and optionally a sample document.
- **CI (GitHub Actions):**
  - `backend-ci.yml`: `ruff check`, `ruff format --check`, `alembic upgrade head` (with a postgres service container + pgvector), and a register-upload-ask integration smoke test that self-skips when `OPENAI_API_KEY` isn't set.
  - `frontend-ci.yml`: `npm run typecheck`, `npm run build`.
- **Secrets:** `OPENAI_API_KEY`, `DATABASE_URL`, `JWT_SECRET` — set in Railway + Vercel dashboards; never committed.

---

## Operational Caveats at MVP

The MVP uses in-process background tasks and local-disk storage. Both are deliberate simplifications with real consequences in a hosted environment — listed here so there are no surprises when deploying:

- **In-process jobs are not durable.** A `BackgroundTask` lives in the same Python process as the request handler. If the API restarts (deploy, crash, OOM), in-flight ingestion work is lost. Affected documents stay in `processing` state. Surface "stuck" detection (e.g. `processing` for > 10 minutes with no updates) and let the user delete + retry.
- **Local-disk storage needs a persistent mounted volume.** Railway's ephemeral filesystem is reset on redeploys. Attach a persistent volume to the API service and mount it at `./storage`. Without this, uploaded files disappear on the next deploy.
- **Horizontal scaling is not safe.** Two API instances sharing a database but not sharing disk means a user's upload and their citation-panel fetch can land on different instances. MVP runs one API instance; scaling past one triggers the deferred S3 + queue decisions (see [PLAN.md](PLAN.md)).

These are the triggers that would move S3-backed storage and a proper background queue out of *deferred* and into the backlog.

---

## Browser Integration

Auth uses bearer tokens in the `Authorization` header — no cookies, no CSRF concerns — which simplifies CORS but constrains frontend transport choices (see [FRONTEND.md](FRONTEND.md#streaming-consumption)).

- **Allowed origins:** the Vercel deployment URL plus `http://localhost:3000` for local dev. Configured via a `CORS_ORIGINS` env var on the API.
- **Credentials:** `Access-Control-Allow-Credentials` stays `false`. Clients attach the bearer token manually in the `Authorization` header; the browser never sends cookies.
- **Streaming headers on `POST /chat`:** response includes `Content-Type: text/event-stream`, `Cache-Control: no-cache`, and `X-Accel-Buffering: no` to disable proxy buffering. Railway's edge and some browser extensions will otherwise hold the stream until it closes.
- **Local dev assumption:** frontend on `http://localhost:3000`, backend on `http://localhost:8000`. The API's CORS allowlist includes both.

---

## Infra Libraries

- `docker` + `docker-compose` — local dev (postgres + api + web up with one command)
- GitHub Actions — CI
