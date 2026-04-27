# AskDocs — Decisions Log

Every decision made during implementation where at least two options were technically viable. Included even when one choice was a no-brainer — the point is to surface trade-offs that weren't obvious, and to give future-me the reasoning rather than just the outcome.

Organised by phase, in roughly the order decisions came up. **Some early decisions are superseded by later ones** — see the "Current state" snapshot below for what's actually true today, then read the chronological log for how we got there.

---

## Current state (as of Phase 5 audit fixes)

A short cheat-sheet so a reader doesn't mistake an early phase decision for the current architecture:

- **Backend stack:** FastAPI + async SQLAlchemy 2 + Alembic, Postgres 16 with `pgvector` and `tsvector`. JWT auth with `bcrypt` directly (passlib was the original choice, replaced because it's unmaintained). Multi-stage Dockerfile with `dev` and `prod` targets.
- **Retrieval:** hybrid — vector (cosine via pgvector HNSW) + BM25 (`ts_rank` on `tsv` GIN index), fused with RRF (`k=60`). Top 20 from each retriever, top 8 fused IDs become the allowed citation set per turn.
- **Generation:** `gpt-4o-mini` via `chat.completions.create(stream=True)` with `temperature=0.2`, `max_tokens=1024`, 60s timeout. SSE frames: `token`, `citation`, `done`, `error`. Citations validated server-side against the allowed set before persistence.
- **Frontend stack:** Next.js 15 App Router + React 19 + Tailwind 3 + `@tailwindcss/typography` + `next-themes`. JWT in `localStorage`, bearer header. Hand-rolled SSE parser (~35 lines). Citation pills via `mdast-util-find-and-replace` MDAST-level rewrite. Inline PDF preview via `react-pdf` (worker from CDN). Source panel is `w-96` (384px). Dark mode supported with `dark:prose-invert`.
- **Eval:** `eval/run.py` ingests a fixture PDF (BERT paper, 25 questions), runs vector and hybrid modes, scores recall@5 + MRR + LLM-as-judge faithfulness with `gpt-4o-mini`. Direct Python calls into backend modules — no HTTP.
- **Deploy:** Vercel (frontend) + Railway (backend + Postgres). Multi-stage Dockerfile's `prod` target builds by default on Railway. `CORS_ORIGINS` is a JSON array env var. `JWT_SECRET` placeholder rejected at startup when `ENV != "dev"`.
- **Hardening done in Phase 5:** filename sanitisation (`storage.safe_basename`), softened parse-fallback heuristic, JWT `sub` int-conversion guard, JWT secret startup check, conversation rename bumps `updated_at`, error messages categorised before reaching the client, chat call bounded with temperature/max_tokens/timeout, length-validated user inputs, eval re-ingestion handles non-ready rows, frontend caches PDF ArrayBuffers per document.

---

## Project setup & git workflow

### First commit scope
- Options: commit all planning docs + `.gitignore` together / commit only `.gitignore` / commit nothing yet.
- Chosen: `.gitignore` only. User preference — planning docs stay local so they can iterate on them without polluting git history.

### Tracking planning docs
- Options: track (standard) / gitignore entirely / leave untracked without ignoring.
- Chosen: move to `docs/` and gitignore the folder. Docs are private working artefacts, not a published spec; gitignoring avoids noisy "untracked files" warnings on every `git status`.

### Branching model
- Options: trunk-based (commit directly to `main`) / one phase branch per PLAN.md phase / one branch per commit.
- Chosen: one branch per phase, merged to `main` with `--no-ff` once each phase's gate passes. Matches the PLAN.md structure and keeps each gate's worth of work reviewable as a unit.

### Merge strategy
- Options: fast-forward / `--no-ff` merge commit / squash.
- Chosen: `--no-ff`. Preserves each commit inside the phase while still producing a single "Phase N merged" marker on `main --first-parent`.

### Push the phase branch after merging?
- Options: push both `main` and phase branch / push only `main`.
- Chosen: push only `main`. Phase history is already in `main` via the merge commit; the branch is kept locally as a navigation bookmark. Cheap to push later if needed.

---

## Phase 1 — Backend framework & runtime

### Web framework
- Options: FastAPI / Flask / Starlette / Litestar.
- Chosen: FastAPI. Pinned by PLAN.md; async-native, strong pydantic integration, OpenAPI out of the box.

### Python version
- Options: 3.11 / 3.12 / 3.13.
- Chosen: 3.12 in the Dockerfile, `>=3.11` in `pyproject.toml`. 3.12 is stable and widely supported by the dep stack; 3.11 is fine too, 3.13 too new for some libraries.

### Package manager / build backend
- Options: pip + hatchling / Poetry / uv / PDM / setuptools.
- Chosen: pip + hatchling. Simplest thing that works with PEP 621 pyproject; no extra tool to install in CI or Docker. Poetry/uv would also work; not worth the onboarding friction for a solo project.

### ASGI server
- Options: uvicorn / hypercorn / daphne / granian.
- Chosen: uvicorn. Default for FastAPI; `--reload` works well in Docker with mounted source.

### Validation / settings
- Options: Pydantic v2 + `pydantic-settings` / dynaconf / raw env parsing.
- Chosen: `pydantic-settings`. Keeps the settings schema in one place and gives typed access.

### ORM
- Options: SQLAlchemy 2.x async / SQLModel / raw asyncpg / Tortoise / Piccolo.
- Chosen: SQLAlchemy async. Mature, Alembic integration, handles the pgvector and `Computed()` columns cleanly. SQLModel is a thin wrapper and didn't add value here.

### Postgres driver
- Options: asyncpg / psycopg 3 async.
- Chosen: asyncpg. Faster for typical workloads; the `postgresql+asyncpg://` URL is well-trodden. psycopg 3 would work too.

---

## Phase 1 — Database & migrations

### Migrations tool
- Options: Alembic / raw SQL files versioned by hand / no migrations (reset DB per deploy).
- Chosen: Alembic. Required for Railway deploy story and for reproducible dev environments.

### Initial migration — autogenerate vs hand-written
- Options: `alembic revision --autogenerate` / hand-written SQL via `op.execute`.
- Chosen: hand-written. Autogenerate mishandles `CREATE EXTENSION`, `GENERATED ALWAYS AS ... STORED`, the HNSW index operator class, and CITEXT. DATA_MODEL.md's DDL is the source of truth; copying it verbatim is both clearer and reversible.

### Email column type
- Options: `CITEXT` / lowercase `TEXT` + normalization.
- Chosen: `CITEXT` **and** explicit lowercasing in the auth layer. Belt-and-braces — CITEXT gives case-insensitive uniqueness, lowercasing keeps the stored form canonical for logs/queries.

### tsvector maintenance
- Options: `GENERATED ALWAYS AS ... STORED` / trigger-maintained / application-side on insert.
- Chosen: generated column. No triggers to keep in sync, no app-side discipline needed; the column is a function of `content` and Postgres enforces it.

### Vector index
- Options: HNSW / IVFFlat / no index (seq scan).
- Chosen: HNSW with `m=16, ef_construction=64`. Lower query latency at the cost of slower builds; fine for a dataset that grows incrementally. IVFFlat is better when you rebuild periodically on a fixed corpus — not our shape.

### Vector dimensionality
- Options: 1536 (matches `text-embedding-3-small`) / 3072 (matches `text-embedding-3-large`).
- Chosen: 1536. Plan pins `text-embedding-3-small`; halves the storage and index cost with minimal retrieval quality impact for our scale.

### Cascading deletes
- Options: cascade `documents → chunks, conversations → messages` / keep orphans / soft delete.
- Chosen: hard delete with `ON DELETE CASCADE`. DATA_MODEL.md calls this out explicitly for citation integrity — a stored `cited_chunk_ids` can never dangle.

---

## Phase 1 — Auth

### Password hashing library
- Options: `passlib[bcrypt]` / `bcrypt` directly / argon2-cffi.
- Chosen initially: `passlib[bcrypt]`. Replaced mid-Phase-1 with `bcrypt` directly after `passlib` 1.7 turned out to be unmaintained and incompatible with `bcrypt` 4.x (triggers a >72-byte password error in its self-test). argon2 would have been fine too but bcrypt is universal.

### JWT library
- Options: `python-jose` / `PyJWT` / `authlib`.
- Chosen: `python-jose`. FastAPI docs use it by default. PyJWT is equally fine.

### Auth transport
- Options: bearer token in `Authorization` header / httpOnly cookie with CSRF protection / session cookie with server-side store.
- Chosen: bearer header, JWT in localStorage on the client. Kills CSRF surface and keeps CORS trivial. Known tradeoff: XSS can read localStorage — moving to httpOnly cookies is a Phase-4-or-later decision if the app needs to harden.

### Password length handling
- Options: truncate client-side / truncate server-side to bcrypt's 72-byte limit / reject > 72 bytes with 422.
- Chosen: truncate on hash and verify. Matches historical passlib behavior, avoids surprising rejections on long passphrases, and the entropy loss past 72 bytes is irrelevant for bcrypt anyway.

---

## Phase 1 — Ingestion pipeline

### Primary PDF parser
- Options: `pypdf` / `pdfplumber` / `PyMuPDF` (fitz) / `pdfminer.six`.
- Chosen: `pypdf`. Lightweight, text-layer extraction is good enough for our target corpus. PyMuPDF is faster and better with tables but has AGPL licensing friction.

### Messy-PDF fallback
- Options: `unstructured` / `pdfplumber` / give up.
- Chosen: `unstructured` with a heuristic trigger (>30% empty pages or <100 chars/page avg). Heavy dependency but matches PIPELINES.md and handles tables / multi-column layouts where `pypdf` degrades silently.

### DOCX parser
- Options: `python-docx` / `docx2txt` / `unstructured`.
- Chosen: `python-docx`. Standard, maintained, gives structured paragraph iteration.

### Scanned-PDF (no text layer) handling
- Options: silent OCR fallback via Tesseract / reject with clear error / ignore (empty chunks).
- Chosen: reject with the exact error message from PLAN.md. OCR is a deferred decision with a clear trigger (>10% of uploads hit this).

### Chunking library
- Options: `langchain-text-splitters` recursive splitter / custom `tiktoken` wrapper / semantic chunking via embeddings.
- Chosen: `langchain-text-splitters`. One import, handles the recursive / token-aware logic without reinventing it.

### Chunk size / overlap
- Options: 500/50 (plan default) / smaller (200/20) / larger (1000/100) / variable.
- Chosen: 500/50. Plan default; tuning belongs to the Phase 3 eval harness, not to a hunch.

### Char offset tracking
- Options: use `text.find` after splitting / compute offsets from token spans directly / skip `char_start`/`char_end`.
- Chosen: `text.find` with forward-only search. Good enough for attribution; exact token-span math would mean reimplementing the splitter. Approximate offsets are acceptable for citation panels.

### Page range for chunks
- Options: concatenate all pages with separators and track per-page char ranges / split strictly per page (no cross-page chunks).
- Chosen: concatenate with tracked ranges. Per-page chunking would orphan content right at page breaks, which is common in reports.

### DOCX page semantics
- Options: treat each paragraph as a page / one virtual "page 1" / estimate pages from character count.
- Chosen: one virtual "page 1". DOCX has no intrinsic pagination until rendered; honesty beats a made-up page number.

### Embedding batching
- Options: 100 chunks per OpenAI call / smaller batches / one-at-a-time.
- Chosen: 100 per call. Matches PIPELINES.md guidance and OpenAI's embedding endpoint happily accepts arrays.

### Blocking parse/chunk work in async handler
- Options: run sync code directly in the event loop / wrap with `asyncio.to_thread`.
- Chosen: `asyncio.to_thread`. pypdf/langchain-text-splitters are CPU-bound; running them inline would stall the event loop during ingestion.

### Background task queue
- Options: FastAPI `BackgroundTasks` (in-process) / Celery / RQ / arq.
- Chosen: FastAPI `BackgroundTasks`. Plan says "upgrade to a real queue only if ingestion depth exceeds what a single worker absorbs." Documented durability caveat in ARCHITECTURE.md.

---

## Phase 1 — Upload & storage

### Upload reading strategy
- Options: read entire body into memory then hash / stream chunks to disk while hashing in one pass.
- Chosen: stream-and-hash. Matches PIPELINES.md code sketch, enforces size limit mid-stream for early abort, avoids holding 50MB in memory per upload.

### Size-limit enforcement
- Options: check `Content-Length` / check after full read / check mid-stream.
- Chosen: mid-stream with an early-abort `413`. Content-Length is client-controlled; mid-stream is the only trustworthy enforcement point.

### Duplicate upload response
- Options: `409 Conflict` / `200 OK` with `duplicate: true` / silently replace.
- Chosen: `200 OK` with `duplicate: true`, per API.md. A duplicate is a success from the caller's perspective, just with a different id.

### File-type validation
- Options: check extension / sniff magic bytes / check MIME type.
- Chosen: extension check. PDFs and DOCXes are small hit set; magic-byte sniffing is overkill for Phase 1 and costs an extra read.

### Local storage layout
- Options: `storage/{user_id}/{document_id}/{filename}` / flat UUID / content-addressed by hash.
- Chosen: per-user per-document directory with original filename. Human-browseable, trivial to map back from DB row, no filename collisions.

### Tmp path location
- Options: `tempfile.mkstemp` / under the storage dir itself / OS-specific temp dir.
- Chosen: `storage/tmp/{user_id}/*.part`. Same volume as the final destination so the final `os.replace` is atomic rather than a cross-device copy.

### page_count derivation
- Options: sniff file suffix to decide whether page count is meaningful / return `(pages, page_count)` from parser.
- Chosen: suffix sniff in `ingest.py`. Flagged in the audit as fragile; refactor deferred to whenever that file is next touched.

---

## Phase 1 — Frontend scaffold

### Framework
- Options: Next.js App Router / Next.js Pages Router / Remix / Astro / plain React + Vite.
- Chosen: Next.js App Router. Pinned by FRONTEND.md.

### Next.js / React versions
- Options: Next 14 + React 18 / Next 15 + React 19.
- Chosen: Next 15 + React 19. Current stable as of scaffold time; App Router is well-established there.

### Tailwind version
- Options: Tailwind 3.4 / Tailwind 4.x.
- Chosen: 3.4. More familiar config file style, better ecosystem coverage. 4.x is fine but introduces engine changes I didn't want to debug during Phase 1 scaffold.

### UI primitives
- Options: shadcn/ui / Chakra / Mantine / MUI / plain Tailwind.
- Chosen: plain Tailwind for Phase 1. shadcn/ui arrives in Phase 3/4 when the chat UI earns the component system.

### Token storage on the client
- Options: localStorage / sessionStorage / httpOnly cookie / in-memory only.
- Chosen: localStorage for MVP. XSS exposure is a real downside; see the auth transport decision above. In-memory-only would force re-login on every reload, which is worse UX for a solo tool.

### API client shape
- Options: hand-rolled typed `fetch` wrapper / openapi-typescript generated client / tRPC.
- Chosen: hand-rolled wrapper in `lib/api.ts`. Surface is small, types are hand-written, no build step. Generated clients become worth it when the surface grows.

### Form library
- Options: react-hook-form / Formik / native React state.
- Chosen: native state. Two simple forms in Phase 1; library overhead isn't earned yet.

### State management
- Options: `useState` / Zustand / Redux / Context.
- Chosen: `useState`. No state that needs to cross route boundaries besides the JWT, which is already in localStorage.

### Polling strategy while documents ingest
- Options: fixed interval / exponential backoff / long-poll / WebSocket / SSE.
- Chosen: fixed 2s interval for Phase 1. Plan's 2s→5s→10s backoff with `visibilityState` pause is Phase 4 polish.

### Package lockfile
- Options: commit `package-lock.json` / let consumer generate on first install.
- Chosen: let consumer generate. No `npm` available at scaffold time; users run `npm install` on first setup.

### Auto-generated `next-env.d.ts`
- Options: commit / gitignore.
- Chosen: commit. Next docs recommend it; it contains type references that avoid regeneration surprises in CI.

---

## Phase 1 — Dev infrastructure

### Postgres image
- Options: official `postgres:16` + script to install pgvector / `pgvector/pgvector:pg16` prebuilt.
- Chosen: `pgvector/pgvector:pg16`. Extension ships with the image; no build step, no init script.

### Dev install mode in Dockerfile
- Options: `pip install .` / `pip install -e .`.
- Chosen: `-e .`. Lets the host volume-mount of `./backend` override the baked-in code without breaking the installed module path. Not ideal for production; switch to non-editable for a prod Dockerfile later.

### Volume mounting strategy
- Options: bind-mount entire directory / named volume / COPY-only in image.
- Chosen: bind-mount source, named volumes for `storage/` and `pg-data/` so restarts preserve uploads and DB state. Anonymous volume for `node_modules` and `.next` so host/container don't collide on platform-specific files.

### Compose `depends_on`
- Options: no condition / `condition: service_started` / `condition: service_healthy`.
- Chosen: `service_healthy` against a postgres healthcheck. Avoids races where the API starts before Postgres accepts connections.

### Migration run timing
- Options: explicit `alembic upgrade head` command / as part of API CMD / init container.
- Chosen: part of the API CMD — `sh -c "alembic upgrade head && uvicorn ..."`. Single-process dev is simple; a real deploy would use an init container.

---

## Phase 1 — Hotfix

### `move_to_final` failure recovery
- Options: let the exception bubble, leave row in `pending` / catch `OSError`, mark the row `failed`, unlink tmp, return 500.
- Chosen: catch and mark failed. The only failure mode here is storage (disk full, permissions); the row should reflect that instead of hanging in `pending` forever.

### Hotfix branch vs direct to `main`
- Options: create `phase-1-hotfix` branch / commit directly on `main`.
- Chosen: direct to `main`. User preference for a ~5-line fix on a published branch.

---

## Phase 2 — Retrieval

### `embed.py` location
- Options: keep under `documents/` / move to `retrieval/`.
- Chosen: move to `retrieval/`. Embedding is shared between ingestion and query-time retrieval; the retrieval module is the better home.

### Query embedding reuse
- Options: reuse `embed_all([question])[0]` / add a dedicated `embed_query` function.
- Chosen: reuse `embed_all`. A single-element batch is still a valid batch; the extra function would duplicate a one-liner.

### Vector top-k
- Options: fetch exactly 8 / fetch 20 then slice to 8 in application.
- Chosen: fetch 20, slice 8. Phase 3 will fuse with BM25, which needs the wider vector list; the sliced 8 is also the allowed citation set. Fetching 20 now costs nothing.

---

## Phase 2 — Conversations

### Conversations module placement
- Options: put conversations routes under `app/chat/` / its own `app/conversations/`.
- Chosen: `app/conversations/`. Conversation CRUD is a different concern from the SSE chat endpoint; keeping them separate means one isn't forced to import the other.

### Ownership check pattern
- Options: denormalize `user_id` onto `conversations` / derive via join through `documents`.
- Chosen: derive via join. Matches DATA_MODEL.md's explicit rule — the DB cannot admit a conversation whose document belongs to a different user.

### Conversation scope in the UI sidebar
- Options: show all user conversations / scope to the current document.
- Chosen: all user conversations. Matches the API shape (`GET /conversations` returns everything) and gives the user a single navigation point.

### Conversation rename / delete endpoints
- Options: include in Phase 2 / defer.
- Chosen: defer to Phase 4. Gate-critical path doesn't need them; polish phase covers the CRUD completeness.

---

## Phase 2 — Chat & streaming

### OpenAI completion API
- Options: `chat.completions.create` / newer Responses API.
- Chosen: `chat.completions`. More widely documented, Python SDK streaming shape is well-understood. Responses API doesn't change the shape enough to justify the migration cost yet.

### Chat model
- Options: `gpt-4o-mini` / `gpt-4o` / `gpt-5` / a non-OpenAI provider.
- Chosen: `gpt-4o-mini`, configurable via `chat_model` env var. Cheap, fast, grounded-QA performance is fine. Swappable without code changes.

### Prompt structure
- Options: single monolithic user message / system + context + user / system-with-context + history + user.
- Chosen: system-with-context + history + user. Treats retrieved passages as grounding rather than prior turns; history is real user/assistant messages which models handle better than prose-y "HISTORY:" blocks.

### History window
- Options: none / last N tokens / last 6 messages (plan) / entire conversation.
- Chosen: last 6 messages. Bounded size; enough for conversational coherence. Token-based windowing is Phase 4 polish.

### Citation parsing location
- Options: client-side regex / server-side after stream close.
- Chosen: server-side. Only the server knows the allowed chunk id set; validation against it has to happen there. Client gets the pre-filtered list on the `citation` frame.

### Citation validation
- Options: accept whatever the model emits / filter against the retrieved set.
- Chosen: filter. Models occasionally hallucinate chunk ids like `[chunk:999999]`; keeping them out of `cited_chunk_ids` avoids polluting the clickable-pill render in Phase 3.

### Message persistence timing
- Options: insert user message upfront, assistant after stream / insert both in one transaction after stream close.
- Chosen: both after stream close. If the stream fails mid-way, nothing persists and the user simply retries — no orphan user message sitting in the transcript.

### DB session usage during streaming
- Options: reuse the request-scoped session throughout / request-scoped for ownership check, fresh `session_scope()` inside the generator.
- Chosen: fresh scope. OpenAI streams can run for minutes; holding the request session open pins a connection in the pool unnecessarily.

### `conversations.updated_at` bump
- Options: set via Python `datetime.now()` / `sqlalchemy.func.now()` in an UPDATE.
- Chosen: `func.now()`. Uses DB time so it's consistent with `created_at` defaults; also avoids loading the row just to mutate one field.

### SSE transport on the frontend
- Options: browser `EventSource` / raw `fetch` + `ReadableStream` / Vercel AI SDK.
- Chosen: raw fetch. `EventSource` can't attach the `Authorization: Bearer` header and is GET-only. Vercel AI SDK's Data Stream Protocol doesn't cleanly map to our custom `token`/`citation`/`done`/`error` events — hand-parsing is ~35 lines.

### Optimistic user message
- Options: insert immediately on submit / only render after server round-trip.
- Chosen: optimistic. Transcript feels responsive; the optimistic record gets replaced by the server list on `done`, so there's no divergence.

### New-chat button destination
- Options: bounce to `/library` for document selection / inline document picker dialog.
- Chosen: bounce to `/library`. 3-line change; the picker dialog is Phase 4 polish.

### Stream cancellation
- Options: server-side `AbortController` hook / no cancel at all.
- Chosen: no cancel for Phase 2. Closing the tab stops the SSE stream anyway; interactive cancel earns its place once prompts start being long enough to matter.

---

## Phase 2 — Polish

### `baseUrl` deprecation in `tsconfig.json`
- Options: delete `"baseUrl": "."` entirely / add `"ignoreDeprecations": "6.0"` to silence the warning.
- Chosen: delete. Modern TypeScript resolves `paths` relative to the tsconfig directory without `baseUrl`; deleting it is functionally identical and removes the warning for good. `ignoreDeprecations` would just defer the same decision to TS 7.0.

### Placement of the tsconfig fix
- Options: extra commit on `phase-2-retrieval-chat` so it rides into `main` with the Phase 2 merge / direct-to-main polish commit like the Phase 1 hotfix / defer to Phase 4.
- Chosen: include in Phase 2. Tiny, on-topic with frontend scaffolding that was already being touched in this phase; keeps `main` linear with just phase-merge commits rather than accumulating direct-to-main polish.

---

## Phase 3 — Chunks endpoint

### `chunks/` module placement
- Options: tack the `/chunks/{id}` route onto the existing `documents/routes.py` (different path prefix, awkward) / create a new `app/chunks/` module with its own router.
- Chosen: new module. Per-prefix-per-router is the convention everywhere else in the codebase (auth/, documents/, conversations/, chat/); keeping `chunks/` separate keeps the convention intact even though it currently holds one endpoint.

### Document ownership check on chunk fetch
- Options: store `user_id` on `chunks` directly / verify ownership at query time by joining through `documents`.
- Chosen: join through `documents`. The `chunks → documents → users` ownership chain is already enforced by foreign keys; denormalising would invite drift between two sources of truth.

---

## Phase 3 — Hybrid retrieval (BM25 + RRF)

### Whether to add hybrid at all
- Options: stay vector-only / add BM25 + RRF.
- Chosen: add. Numeric facts and proper nouns (parameter counts, F1 scores, term names) are exactly where cosine similarity under-ranks and BM25 over-ranks; combining them is the textbook complementary case.

### Reciprocal Rank Fusion vs alternatives
- Options: RRF / weighted score blending (alpha·vector + (1-alpha)·BM25) / cascade (rerank top-N from one with the other).
- Chosen: RRF. Doesn't depend on absolute score scales, which differ wildly between cosine distance and `ts_rank`. Calibrating weights for blended scores is fragile across queries; RRF only cares about ranks and works without tuning.

### RRF `k` parameter
- Options: tune empirically / use the Cormack/Clarke/Buettcher default of 60.
- Chosen: 60. The published default works well across most retrieval setups; tuning would be a Phase-4-or-later eval-driven decision and the current numbers don't suggest the default is wrong.

### Vector + BM25 execution order
- Options: run them in parallel via `asyncio.gather` with two sessions / run them sequentially on one session.
- Chosen: sequential, single session. SQLAlchemy's async session can't multiplex queries on one connection; parallel execution would mean spinning up a second session just to save ~20ms. The chat endpoint then spends seconds on OpenAI streaming, so 20ms is below the noise floor.

### Top-k per retriever vs final context size
- Options: ask each retriever for 8 directly / fetch 20 from each, fuse, take top 8.
- Chosen: 20 each → fuse → top 8. RRF needs candidate breadth to find chunks that rank well in *both* lists. Truncating to 8 before fusing throws away signal.

### Empty BM25 result handling
- Options: error out / fall back to vector-only / pass single-list to RRF.
- Chosen: pass single-list to RRF. RRF degrades gracefully with one input — the ranking is just the vector ranking. Matches the PLAN.md edge case "skip BM25, use vector-only for that query."

### BM25-alone benchmark in eval
- Options: add a third `--mode bm25` for completeness / skip.
- Chosen: skip. The practical question was "vector or hybrid?", not "which single retriever wins?" BM25 alone in 2026 is a fallback for environments where embeddings are too expensive — not a real option for us.

---

## Phase 3 — Eval harness

### Fixture document
- Options: my CAB320 report (private, small) / a short public paper (BERT) / a public Q&A dataset (SQuAD).
- Chosen: BERT paper. Public, shareable, dense factual content matching the EVAL.md example, and big enough to make retrieval metrics non-trivial without being overwhelming. CAB320 is too small and not redistributable; SQuAD's passage shape doesn't match our document Q&A use case.

### Eval transport
- Options: call the real `POST /chat` SSE endpoint (more realistic) / call retrieval and generation Python functions directly (simpler).
- Chosen: direct Python calls. The gate is retrieval quality, not end-to-end wiring. HTTP path would add auth, conversation creation, SSE parsing, and DB garbage on every run for no measurement benefit.

### Single script with `--mode` vs two separate runs
- Options: run vector first, commit code change to add hybrid, run hybrid second / single script with `--mode {vector,hybrid,both}`.
- Chosen: single script. Comparing two retrieval modes is the same shape as comparing N modes; baking it into the script keeps re-runs cheap and lets the milestone markdown render both side by side.

### Faithfulness measurement
- Options: skip it (recall@5 + MRR only) / heuristic checks (e.g., are all numeric claims in the chunks?) / LLM-as-judge.
- Chosen: LLM-as-judge with `gpt-4o-mini`. Heuristics miss paraphrased claims; human annotation doesn't scale. LLM judge is approximate but repeatable, fast, and cheap (~$0.03 per full run, far below my earlier $1 estimate).

### Judge model
- Options: same model as the answer generator (`gpt-4o-mini`) / a stronger model (`gpt-4o`) / a different family.
- Chosen: same model. Stronger judge would catch more hallucinations but doubles cost; same-model is honest about the noise floor and matches how most published eval harnesses work.

### Judge temperature
- Options: default (~0.7) / `temperature=0`.
- Chosen: 0. We want repeatability across runs more than creative grading. Even with 0, LLMs aren't perfectly deterministic but it's much closer.

### Gold-evidence format
- Options: page numbers / answer-text matching against a reference answer / verbatim snippets.
- Chosen: snippets, per EVAL.md. Multiple chunks can live on one page so page-based scoring would reward false positives; reference-answer matching is brittle to paraphrasing. Snippets pin gold to actual evidence text and accept multiple alternatives per question.

### Snippet matching
- Options: exact match / case-insensitive / case-insensitive + whitespace-normalized substring.
- Chosen: case-insensitive + whitespace-normalized substring. PDF extraction introduces minor whitespace noise; strict matching would over-penalise that.

### Dataset size and difficulty mix
- Options: 25 mostly-easy lookup questions (what we have) / 50 with mixed difficulty (multi-hop, paraphrased, inferential).
- Chosen: 25 easy. Authoring good hard questions takes hours of careful PDF reading and snippet verification; the easy set was sufficient to pass the gate even though it caps recall@5. Expanding the dataset is Phase-4-or-later polish.

### Eval user identity
- Options: reuse a real user / dedicated `eval@askdocs.local` user.
- Chosen: dedicated user. Keeps eval data isolated from real document lists and conversation history; fixture dedupe by `(user_id, file_hash)` makes re-runs free.

### First-run ingestion path
- Options: require user to upload via the UI before running eval / harness ingests directly via backend functions.
- Chosen: harness ingests. Same code path as production ingestion (parse, chunk, embed) but bypasses the HTTP boundary; idempotent because the dedupe check handles re-runs.

### Eval volume mount strategy
- Options: dedicated `eval` compose service with its own image / mount `./eval:/eval` into the existing api container.
- Chosen: mount into api. Backend deps are already there; one extra volume, no extra image build, no new service to manage.

### `pyyaml` dependency placement
- Options: optional extras group (`pip install .[eval]`) / main backend deps.
- Chosen: main deps. The eval container is the api container; gating yaml behind an extras flag would mean rebuilding with the flag set. Cost is one tiny dependency in the main image.

### Fixture PDF in git
- Options: gitignore (require local download) / commit the fixture.
- Chosen: commit. EVAL.md says fixtures are committed for reproducibility; arXiv papers are redistributable; ~800KB is fine in a small project.

### Eval results commit policy
- Options: commit everything / commit nothing / commit milestones, gitignore dev runs.
- Chosen: milestones + gitignore dev, per EVAL.md. Stops timestamped near-duplicates from flooding the history while preserving the runs that actually moved a metric.

---

## Phase 3 — Citation pills

### Markdown rendering library
- Options: `react-markdown` v9 / `markdown-to-jsx` / `@uiw/react-md-editor` / custom mdast walker.
- Chosen: `react-markdown`. Mature, integrates cleanly with remark plugins, supported component overrides for the citation interception. `markdown-to-jsx` is faster but doesn't expose AST plugins. Custom would be reinvention.

### How `[chunk:N]` becomes a pill
- Options: replace text via `components.text` override (FRONTEND.md explicitly warns against this — matches inside code blocks too) / AST-level rewrite via `mdast-util-find-and-replace` / regex on the rendered output.
- Chosen: AST rewrite. `mdast-util-find-and-replace` skips `code` and `inlineCode` nodes by default, so a `[chunk:42]` inside a code fence stays code. Regex on rendered output would have the same problem as `components.text`.

### MDAST node type for the rewrite
- Options: emit a custom node type (e.g., `{type: "citation", chunkId}`) and add a remark-rehype handler / emit a standard `link` node with `href: "#chunk-N"` and intercept via `components.a`.
- Chosen: link nodes. One less moving part — no custom mdast-to-hast handler, and `components.a` is the standard mapping point. The `#chunk-` href prefix is a clear sentinel.

### Validation set during streaming
- Options: render pills as soon as `[chunk:N]` arrives in the token stream / wait for the validated set from the `citation` SSE frame / always render plain text mid-stream.
- Chosen: empty allowed set during streaming → plain text. The validated set arrives only at the end, just before `done`. After `done`, `loadData()` refreshes the transcript with `cited_chunk_ids` and pills appear. Avoids inconsistency between streamed and persisted views.

### Markdown for user messages
- Options: render both user and assistant messages with markdown / assistant only.
- Chosen: assistant only. User input is plain prose; markdown-rendering it would risk surprising behaviour (`*emphasis*` in a question becoming italic). Assistant output is the only place where formatting + pills matter.

### Typography styling
- Options: install `@tailwindcss/typography` plugin and use `prose` classes / browser defaults with light Tailwind utility styling.
- Chosen: browser defaults. Our content is short paragraphs with occasional bold and pills — typography plugin's heavy styles would overshoot. Revisit if multi-paragraph answers ever look cramped.

---

## Phase 3 — Source panel

### Panel mounting strategy
- Options: slide-in panel that appears on first pill click / always-mounted with empty-state hint.
- Chosen: always-mounted. Simpler — no animation timing, no layout reflow when first clicking a pill, no "where did the panel come from?" surprise. Empty state lives in the same column as the content would.

### Stale-fetch handling
- Options: ignore the race (last-fetch-wins by default React render order, but with concurrent fetches the slower one might overwrite the newer one) / use `AbortController` / use a `cancelled` flag in the effect cleanup.
- Chosen: `cancelled` flag. Simpler than wiring AbortController through the API client, and the API doesn't honour aborted fetches anyway since the response is small. Cleanup-flag pattern is React-canonical.

### Panel layout width
- Options: equal-width with conversations sidebar (288px) / wider for content readability (320-400px).
- Chosen initially: 320px (`w-80`). Conversations sidebar at 288px is a navigation strip; the source panel needs more horizontal room because chunk content is paragraph-shaped text.
- **Widened to 384px (`w-96`) when the inline PDF preview landed in Phase 4** — the PDF page renders at width=336px inside the panel padding, and 320px was too narrow to read the cited page.

---

## Phase 4 — Workflow

### Public/private doc split
- Options: promote `docs/` (or part of it) to a tracked location for public consumption / keep `docs/` gitignored as private working notes.
- Chosen: keep private. README is the only public doc; ARCHITECTURE/PLAN/etc. stay local. Reduces the surface I have to maintain in two voices (private candor vs public pitch); promotion can happen later if there's a real audience for it.

### Mid-phase merge
- Options: one merge per phase after the gate is verified (the pattern from Phases 1-3) / two merges if a clean halfway point exists.
- Chosen: two merges for Phase 4 — one after the UI polish (commits 1-5), another after deploy verification (6-8 + any fix-forward). Backs up the polish work onto `main` before the deploy pulls in heavier infrastructure changes; cost is a slightly noisier history (two `Merge Phase 4` commits instead of one).

---

## Phase 4 — Conversation CRUD

### Empty rename validation
- Options: accept empty title and treat as null / reject with 400.
- Chosen: reject with 400. An empty title would render as `Conversation {id}` (the fallback in the UI), which feels like a silent no-op. Surfacing 400 lets the UI keep the input open until the user types something or cancels.

### Rename UI shape
- Options: inline edit (input replaces the title in place) / modal dialog with title field / dedicated rename page.
- Chosen: inline edit. Faster, fewer clicks, matches the convention in Slack/Linear/ChatGPT. Modal would have been over-scoped for a one-field action.

### Action visibility
- Options: always-visible icon buttons next to each conversation / hover-revealed via `group-hover`.
- Chosen: hover-revealed. The sidebar can have many conversations; permanent icons on every row would compete visually with the active-row highlight. Hidden-until-needed keeps the list scannable.

### Native `confirm()` vs custom modal
- Options: keep the browser-native `confirm()` (one line, free, ugly) / build a custom `ConfirmDialog`.
- Chosen: custom dialog. The native dialog clashes with the rest of the UI and there's no way to style it. The cost is ~80 lines of component code, which gets reused for any future destructive action.

### ConfirmDialog API shape
- Options: imperative — `await confirm({ title })` from anywhere via a global provider/portal / declarative — `<ConfirmDialog open={...} onConfirm={...} />` rendered conditionally in the calling page.
- Chosen: declarative. Less plumbing for a single use case. If we add a fourth or fifth confirmation flow, the imperative pattern earns its place; not yet.

### Focus trap inside the dialog
- Options: trap focus inside the dialog (a11y best practice for modal interfaces) / leave focus management to autofocus on the primary button.
- Chosen: no trap. Adding one means either a third-party hook (`focus-trap-react`) or ~40 lines of keyboard plumbing. autofocus + Escape handler covers the 90% case for a small confirm dialog. Real focus traps land when accessibility audit demands them.

### Action button glyphs
- Options: SVG icon set (heroicons, lucide) / inline unicode characters (✎, ✕).
- Chosen: unicode. Two icons total — not worth pulling in an SVG icon library. If/when we need 5+, swap to lucide.

---

## Phase 4 — Upload zone

### Where validation lives
- Options: inside `<UploadZone>` so feedback is instant on drop/select / on the parent page after the upload starts.
- Chosen: in the component. The component is the single source of truth for what's acceptable; instant feedback on rejected files avoids a wasted server round-trip.

### `fetch` vs `XMLHttpRequest` for upload
- Options: stick with `fetch` (consistent with the rest of the API client) / switch the upload call to `XMLHttpRequest` for byte-level upload progress.
- Chosen: XHR. `fetch` doesn't expose upload progress in browsers — only XHR has `xhr.upload.onprogress`. The TC39 streaming-upload proposal (`Streams.fetch`) is shipped only in Chromium and not stable enough to rely on. Worth the local divergence for a real progress bar.

### Progress bar placement
- Options: inline inside the drop zone / floating overlay or toast-style progress / browser's default upload UI.
- Chosen: inline in the zone. Anchors the feedback to where the user just dropped the file, no extra UI surface to manage.

### Upload cancel
- Options: wire `xhr.abort()` to a "cancel" button / no cancel.
- Chosen: no cancel for now. Users can refresh the page to abort. Real cancel UI earns its place when uploads are large enough to make abandonment likely.

---

## Phase 4 — Polling backoff

### Timer primitive
- Options: `setInterval` with a fixed interval (current Phase 1 implementation) / self-rescheduling `setTimeout` so each tick can use a different interval.
- Chosen: `setTimeout`. Backoff requires variable intervals; with `setInterval`, you'd have to clear and recreate it on each backoff transition anyway.

### Backoff thresholds
- Options: linear backoff (2 → 4 → 6 → 8…) / exponential (2 → 4 → 8 → 16) / stepped buckets (FRONTEND.md spec: 2 → 5 → 10).
- Chosen: stepped buckets per FRONTEND.md. Predictable maximum cadence (10s), only three intervals to think about, and matches what the frontend spec already prescribed.

### Tab-hidden behavior
- Options: keep polling regardless of visibility / pause when hidden, resume on `visibilitychange`.
- Chosen: pause + resume. No point burning quota on a tab the user isn't looking at. On resume, also reset the backoff counter so the user gets fresh data quickly instead of staring at a stale 10s wait.

### Tracking storage for backoff
- Options: `useState` (rerender on every change) / `useRef` (mutate without rerender).
- Chosen: refs. The backoff counter and previous-terminal set are bookkeeping state that doesn't need to drive UI updates. Using state would force re-renders on every tick.

### Transition detection
- Options: per-doc field comparison (was `processing`, is now `ready`) / set-based diff (any id terminal now wasn't terminal before).
- Chosen: set-based diff. Simpler — one `Set.has` check instead of a join across docs. Resilient to docs being deleted between polls.

---

## Phase 4 — Hotfixes during polish

### Where to land after deleting the active conversation
- Options: bounce to `/library` / hop to the next conversation in the sorted list / stay on a "no conversation" placeholder state.
- Chosen: hop to next. The bounce-to-library flow could trigger a `getMessages(deletedId)` race in the chat page's effect, which would 404 and be caught by the generic catch that called `signOut()` — kicking the user to login. Hopping to the next conversation eliminates the race and feels like every chat app the user already uses.

### Conversation-switch transition smoothing
- Options: accept the brief flash of the previous transcript while new data loads / reset transient view state synchronously on `conversationId` change / use Suspense + skeleton.
- Chosen: synchronous state reset, plus optimistic sidebar removal on delete. Smaller change than Suspense boundaries, immediately fixes the visible flash, and dovetails with the skeleton work in the next commit.

---

## Phase 4 — Skeletons + empty states

### Skeleton primitive — custom or library
- Options: install `react-loading-skeleton` or similar / write a 6-line `Skeleton` component.
- Chosen: write it. One pulse animation + a className prop is all we need; a library would add a dep and styling layer for no real gain.

### Loading-state tracking
- Options: rely on whether `messages` / `docs` arrays are empty / explicit `loaded` boolean per page / React Suspense.
- Chosen: `loaded` boolean. Empty arrays can mean either "still loading" or "loaded but empty," and we want different UI for each. Suspense would require route-level rearrangement and lifts loading state too high; a single boolean per page is enough.

### Skeleton shape
- Options: generic grey boxes / shapes that mirror the real content (rounded message bubbles, role-aligned widths).
- Chosen: mirror the real content. Switching from skeleton to real content has minimal layout shift, and the skeleton communicates "this is where the assistant's reply will appear" rather than just "loading."

### Empty state design
- Options: muted one-line hint (current Phase 1) / dashed-border card with headline + CTA copy.
- Chosen: dashed card. The library and chat empty states are both "you should do X next" moments — a card-with-CTA reads as deliberate UI rather than missing content.

### Reset `loaded` on conversation switch
- Options: reuse the previous conversation's `loaded=true` while the new one fetches / reset to `false` when `conversationId` changes.
- Chosen: reset. Showing the new conversation's skeleton while it loads is the consistent behavior; carrying over `loaded=true` would render an empty transcript with the previous conversation's "loaded" sentinel, looking like the new conversation is genuinely empty.

---

## Phase 4 — Auth + toasts

### 401 redirect signal
- Options: throw a special error class and have every caller catch it / Context + provider that the API client subscribes to / `window.dispatchEvent` of a custom event with a top-level listener.
- Chosen: CustomEvent. `lib/api.ts` can't import `next/navigation` (it'd break SSR), and threading a context through every call site is verbose. A single global event with one listener at the root layout is the smallest seam between the typed API client and the routing layer.

### Toast provider scope
- Options: per-route provider / single root-level provider in the layout.
- Chosen: root level. Toasts are user-feedback for any action and need to outlive route changes. Per-route would mean toasts disappear on navigation, which defeats half their purpose.

### Auto-dismiss timeout
- Options: persistent until clicked / 3s / 5s / per-toast configurable.
- Chosen: 5s flat. Long enough to read, short enough not to stack visually. Per-toast configurability earns its place when we have a use case (e.g., "upload complete — view document" might want longer); not yet.

### Streaming error: toast or inline?
- Options: route every error to a toast / keep streaming errors inline in the transcript.
- Chosen: streaming errors stay inline. They're contextual to the chat bubble the user just sent; surfacing them at the corner-of-screen while the user is mid-conversation reads as disconnected.

### `signOut()` in generic catch blocks
- Options: keep the "any error means sign out" hack from earlier phases / drop it and route 401s through the central handler.
- Chosen: drop it. The old behavior signed users out for unrelated 500s and network blips, which was bad UX. With centralized 401 handling, generic catches just toast the error.

### Toast kinds
- Options: just one (everything is a toast) / error+success / error+success+info / a wide spectrum (warn, debug, etc.).
- Chosen: error/success/info. Three is enough for everything Phase 4 cares about. More can be added when we have a use case that doesn't fit one of these.

---

## Phase 4 — Production Dockerfile

### Single multi-stage file vs separate dev/prod files
- Options: `backend/Dockerfile` for dev + `backend/Dockerfile.prod` for prod / single multi-stage `Dockerfile` with `dev` and `prod` targets.
- Chosen: single multi-stage. One source of truth; `target: dev` from compose, default last-stage target (`prod`) from Railway. Slightly slower to rebuild the dev image (each unrelated change to the prod stage's COPYs invalidates dev's cache too) but the readability win is bigger.

### `unstructured` in prod image
- Options: include in the prod image and accept the ~400MB transitive dep tree / move to `[fallback-parser]` extras and drop from prod / drop entirely.
- Chosen: extras group, dropped from prod. The fallback parser only fires when pypdf demonstrably fails (>30% empty pages or <100 chars/page). For a portfolio demo with normal text-layer PDFs that path never runs, so prod doesn't need the dep. In-prod failures from PDFs that actually need it surface a clear "rebuild with [fallback-parser] extras" error instead of `ModuleNotFoundError`.

### Lazy import vs top-level
- Options: import `unstructured.partition.pdf` at module top / function-local import inside `parse_pdf_unstructured`.
- Chosen: function-local. Makes the module loadable without `unstructured` installed; the import only fires when the fallback parser is actually invoked. Already function-local before the prod-strip decision; the `try/except ImportError` wrapper just makes the failure message human.

### Migration timing in prod
- Options: run `alembic upgrade head` in a pre-deploy hook / init container / as part of the API container's CMD before uvicorn.
- Chosen: in CMD before uvicorn. Single-instance deployment for the demo; if we ever scale to multiple replicas the migration moves to its own one-shot job to avoid races, but that's a deferred decision.

---

## Phase 4 — CI

### Two jobs (lint + integration) vs one
- Options: single job that does both / separate `lint` and `integration` jobs.
- Chosen: separate. Lint is fast (~30s, no services) and gives the most common feedback. Integration spins up Postgres and hits OpenAI. Splitting means the cheap signal arrives in seconds; the slow one runs in parallel.

### Skipping the OpenAI-dependent test on fork PRs
- Options: require the secret to be set, fail fork PRs that can't see it / detect missing secret in the workflow and skip the step / skip-on-import in the test itself with `pytest.mark.skipif`.
- Chosen: `skipif` in the test. Same pytest invocation works locally with or without a key, and fork PRs don't get blocked by missing secrets they can't access. The workflow doesn't need a conditional step.

### In-process `httpx.AsyncClient` vs standing up a real uvicorn
- Options: spin up uvicorn in the CI runner and hit it over the network / use `ASGITransport(app=app)` to route requests in-process.
- Chosen: in-process. No port juggling, no startup race, no extra subprocess. FastAPI's BackgroundTasks fire correctly under the in-process transport. Real-uvicorn would only earn its place if we needed to test middleware behaviour that differs between transports, which we don't.

### Generating the test fixture
- Options: commit a tiny PDF binary / generate one on the fly with `reportlab` / use the existing BERT fixture.
- Chosen: generate with reportlab. Adds a single dev dep but means the test fixture is reproducible from text — no opaque binary in git. BERT fixture is too big for a smoke test (48 chunks × an embedding round-trip per CI run is wasteful when one chunk would do).

### CI path filters
- Options: every workflow runs on every push / per-workflow path filter so backend changes only trigger backend CI.
- Chosen: path filters. A frontend-only change shouldn't burn 3 minutes of postgres + alembic + smoke test, and vice versa.

---

## Phase 4 — CI debugging

### `ruff check` vs `ruff format` are separate
- Options: `ruff check` covers everything (linting + formatting) / they're separate commands.
- Reality: they're separate. Discovered the hard way when `ruff check` went green but `ruff format --check` flagged 8 files for reformatting that had been written before the formatter was wired into CI. Having both in the workflow is the right move; lesson is that they cover non-overlapping rule sets.

### `known-third-party = ["alembic"]`
- Options: rely on ruff's auto-detection of first-party packages / explicitly list alembic as third-party.
- Chosen: explicit. Ruff treats any top-level directory in the source root as first-party. We have `backend/alembic/` (the migrations directory) which made ruff classify the `alembic` *Python package* (third-party PyPI) as first-party — so it kept demanding `from alembic import context` merge into the same import block as `from app.X import`. Pinning `alembic` to known-third-party silences the auto-detection.

### Email validation in the smoke test
- Options: use `ci@askdocs.local` (matches the eval user pattern) / use an RFC-reserved testing domain like `ci@example.com`.
- Chosen: `example.com`. `email-validator` (which `EmailStr` defers to) rejects `.local` because it's reserved for mDNS, not a real TLD. The eval user works because eval inserts directly via SQLAlchemy without going through Pydantic; the smoke test goes through the HTTP layer and gets validated. Lesson: any test that authenticates via the API needs an RFC 2606 reserved domain.

### Running ruff inside the dev container vs guessing
- After three rounds of guess-and-push, asking ruff itself via `docker compose exec api ruff check ... --diff` showed exactly what it wanted in seconds. Lesson for future-me: if a CI lint check fails twice, run the linter locally before pushing again.

---

## Phase 4 — Typography

### Add typography plugin vs roll our own
- Options: write Tailwind utility classes by hand / install `@tailwindcss/typography` and use the `prose` classes.
- Chosen: typography plugin. Already pulls in years of typography tuning (heading hierarchy, list spacing, code block style, blockquote indent). One devDep, no maintenance.

### Default `prose` margins vs tightened
- Options: ship default prose / override the larger margins.
- Chosen: override `prose-p:my-2`, `prose-pre:my-2`, etc. Default prose targets long-form articles where paragraphs have ~1.25em vertical breathing room. Inside a chat bubble that's too loose; tighter feels like a conversation, looser feels like a blog post.

### `prose-invert` for dark mode
- Options: write our own dark variants / use the plugin's `dark:prose-invert`.
- Chosen: `prose-invert`. Plugin ships a coherent dark colour scheme; rolling our own would mean re-tuning every text-on-text combination.

---

## Phase 4 — Smart auto-scroll

### "Always pin to bottom" vs conditional
- Options: keep the existing always-scroll behaviour / only auto-scroll when the user is already at (or near) the bottom.
- Chosen: conditional. The previous behaviour fought the user when they scrolled up to read older messages mid-stream, yanking them back down on every token. Now we check `scrollHeight - scrollTop - clientHeight <= 80` before scrolling.

### "↓ new content" button vs silent
- Options: when the user is scrolled up and new content arrives, do nothing / show a small button to jump to the bottom.
- Chosen: show the button. Without it, the user wouldn't know there's anything new and might assume the stream had stalled. Button position is centered just above the composer so it's where the eye lands when typing.

### Where to put `atBottom` in the deps array
- Options: include `atBottom` in the deps of the content-arrival effect / omit it deliberately and read it via closure.
- Chosen: omit. Including it would re-trigger the scroll-to-bottom every time `atBottom` flips, including when the user scrolls up — fighting the user again. The eslint-disable comment makes the omission deliberate, not an accident.

---

## Phase 4 — Stop button

### Distinguishing user-cancel from real errors
- Options: treat any thrown error as a stream failure and show the error toast / check `controller.signal.aborted` in the catch and silently clean up.
- Chosen: check the signal. User cancellation isn't an error from their perspective; surfacing "stream error" after they hit stop would be confusing.

### What to do with the partial answer on cancel
- Options: keep the partial assistant bubble visible with a "stopped" indicator / drop both the optimistic question and the partial answer.
- Chosen: drop both. The chat route only persists messages on stream completion, so the server has nothing for the cancelled exchange. Keeping the partial would make the local view diverge from server state and break on the next `loadData()`.

### Two buttons or one with swapping props
- Options: one button whose text/colour changes based on `streaming` / two distinct buttons rendered conditionally.
- Chosen: two buttons. The "ask" → "stop" transition is also a colour change (neutral-900 → red-600), and a fresh DOM element on each side keeps event handlers and styles cleanly separated. JSX is barely longer.

---

## Phase 4 — Dark mode

### `next-themes` vs roll-your-own
- Options: localStorage + a small useEffect / `next-themes` library.
- Chosen: `next-themes`. The flash-of-wrong-theme on first paint is real and annoying; next-themes injects a tiny inline `<script>` that sets the class before React hydrates. Three lines of integration vs ~30 of careful useEffect plumbing.

### `attribute="class"` vs `attribute="data-theme"`
- Options: drive Tailwind's `dark:` variants via `class="dark"` on `<html>` / use a `data-theme` attribute and configure Tailwind to match.
- Chosen: class. Tailwind's `darkMode: "class"` is the standard and well-trodden path; `data-theme` is also supported but less commonly documented.

### `defaultTheme` value
- Options: `"light"` / `"dark"` / `"system"`.
- Chosen: `"system"` with `enableSystem`. First-visit users get whatever their OS prefers. Once they explicitly toggle, the choice persists. No "everyone gets light by default" surprise for dark-mode-enabled users.

### Toggle placement
- Options: floating corner button always visible / inside the existing per-page sign-out areas / dedicated header bar.
- Chosen: next to sign-out on each page. We don't have a global header to attach it to, and a floating button would conflict with toasts and the chat composer. Two instances (library header + chat sidebar bottom) is mild duplication for cleaner layout.

### User bubble colour in dark mode
- Options: keep `bg-neutral-900` (would be dark-on-dark in dark mode) / switch to a different colour family in dark.
- Chosen: blue in dark. The user message is the most prominent element on screen; needs enough contrast to stand out from the dark transcript background. Blue/white is a familiar chat-app pattern.

### `suppressHydrationWarning` on `<html>`
- Options: live with the React hydration warning that next-themes triggers / suppress it.
- Chosen: suppress. The class-on-html flip between server-render and client-mount is by design, not a bug.

---

## Phase 4 — Inline PDF preview

### `react-pdf` vs iframe/embed vs custom
- Options: `<iframe src="...">` letting the browser render the PDF / `react-pdf` with single-page rendering / hand-rolled pdf.js integration.
- Chosen: react-pdf. iframe can't attach bearer auth headers (only GET-only with no header control), hand-rolled is reinvention. react-pdf gives page-level control with no auth gymnastics.

### Pre-fetch as ArrayBuffer vs `httpHeaders` prop
- Options: `<Document file={{url, httpHeaders: {Authorization: ...}}}>` / pre-fetch via authed `apiFetch` and pass the ArrayBuffer.
- Chosen: pre-fetch. react-pdf's httpHeaders prop has flaky behaviour across pdf.js worker versions. Pre-fetching is one extra round-trip but works reliably; for ~800KB PDFs the user-visible delay is invisible against the pdf.js render time anyway.

### Worker from CDN vs bundled
- Options: copy `pdf.worker.min.mjs` to `public/` during build / load from `unpkg.com/pdfjs-dist@${version}`.
- Chosen: CDN. Zero build config, version automatically matches the installed package. For a portfolio demo the trade-off (third-party request, one-time cache miss) is acceptable; production-real would self-host to remove the runtime dependency.

### Skip text/annotation layers
- Options: render full pdf.js layers (text selection, link highlighting work) / skip them.
- Chosen: skip. Text layer adds ~30% render time and we don't need in-page selection in a 384px preview. If the user wants to copy text, the chunk content card directly below the preview already shows it as plain text.

### `document_filename` on the chunk response vs separate document fetch
- Options: hit `GET /documents/{id}` after `GET /chunks/{id}` to learn the filename / embed `document_filename` in the chunk response.
- Chosen: embed. One DB join, one round-trip; the alternative was two round-trips for the same data. The chunk endpoint is already joining through documents for ownership anyway.

### DOCX preview behaviour
- Options: render DOCX inline somehow (mammoth.js → HTML, or open in Office viewer) / fall back to text-only.
- Chosen: text-only fallback. Inline DOCX rendering requires either a server-side conversion to PDF/HTML or a heavy client-side library (mammoth.js is decent but adds 200KB+). The text card is honest about what we have.

---

## Phase 4 — Final polish bundle

### Hardcoded suggested questions vs LLM-generated
- Options: hit OpenAI on conversation create to generate three doc-specific suggestions / hardcode three generic ones.
- Chosen: hardcoded ("What is this document about?", "Summarise the key findings.", "Who are the authors?"). LLM-generated would mean a per-conversation completion call (cost + latency) for marginal UX gain on a problem we don't yet have. Defer until users actually struggle with cold-start.

### Toast slide-in animation
- Options: install `framer-motion` / hand-rolled CSS keyframe.
- Chosen: keyframe. One named animation in `tailwind.config.ts`, applied via `animate-slide-in-right`. framer-motion is overkill for a 200ms slide.

### Toast exit animation
- Options: animate the slide-out / fade-out / nothing.
- Chosen: nothing. Auto-dismiss after 5s without animation. Adding exit motion means tracking dismissal state separately from visibility (toast is mounted while animating out, then unmounted), which leans on `framer-motion` or a transition-group. Not worth it for the volume of toasts a single user produces.

### Custom error page implementation
- Options: rely on Next's default error UI / custom `app/error.tsx` that logs to console / hook into Sentry or similar.
- Chosen: custom page that logs to console. Branded and useful as a starting point; production-grade error tracking lands when there are real users to triage errors for.

---

## Phase 4 — Deploy

### Hosting choice
- Options: single platform like Render, Fly.io, or Vercel-hosted backend / split: Vercel for frontend + Railway for backend.
- Chosen: split. Vercel is the natural fit for Next.js (zero-config), and Railway gives a Postgres+pgvector service plus persistent disk for less than the alternatives. PLAN.md called this out from day one.

### Railway builder
- Options: Railpack (their auto-detection) / explicit Dockerfile builder.
- Chosen: Dockerfile. Railpack is convenient for simple apps but doesn't know about our multi-stage Dockerfile or how to target the `prod` stage. Dockerfile builder respects what we've already designed.

### Multi-stage build target on Railway
- Options: explicitly set the build target in Railway's UI or `railway.toml` / let Docker default to the last stage.
- Chosen: rely on the default. In a multi-stage Dockerfile, omitting `--target` builds the last stage, which we ordered as `prod`. One less config knob.

### `DATABASE_URL` reconstruction
- Options: copy the auto-injected `${{Postgres.DATABASE_URL}}` reference (which starts with `postgresql://`) and add `?driver=asyncpg` somehow / reconstruct the URL with the asyncpg prefix from individual `${{Postgres.PGHOST}}`-style references.
- Chosen: reconstruct. SQLAlchemy needs `postgresql+asyncpg://` and there's no clean way to convert the bare `postgresql://` form. Reconstructing from `PGUSER/PGPASSWORD/PGHOST/PGPORT/PGDATABASE` keeps the value tied to Railway's reference system — if the password rotates, our URL updates automatically.

### `CORS_ORIGINS` env var format
- Options: comma-separated string parsed in code / JSON array string parsed by pydantic-settings.
- Chosen: JSON array (default pydantic-settings behaviour for `list[str]` fields). Cost: malformed JSON crashes on container startup with a `JSONDecodeError` that's spectacularly unhelpful to read. Lesson learned the live way: any "list of strings" pydantic-settings env var must be a valid JSON array, square brackets and double quotes included.

### Persistent storage on Railway
- Options: Railway persistent volume mounted at `/storage` / S3 / local-disk only (lost on every redeploy).
- Chosen: Railway persistent volume, per the earlier deferred-decision call. Survives redeploys, no AWS setup. S3 trigger remains "disk usage exceeds the plan's volume."

### Where to point Vercel
- Options: deploy from the phase branch first, verify, then merge / merge to `main` first, then point Vercel at `main`.
- Chosen: merge first. Solo project, fix-forward is faster than coordinating a verify-then-merge dance, and Vercel's GitHub integration defaults to the default branch.

### Creating a decisions log
- Options: keep decisions in scattered commit messages / maintain a dedicated log file / rely on memory.
- Chosen: dedicated log. Commit messages capture *what* shipped but rarely *what was considered and rejected*; having the discarded options written down is the useful part for future-me and for interview-style explanations.

### Decisions log location
- Options: tracked `DECISIONS.md` at repo root / untracked inside `docs/` / GitHub wiki.
- Chosen: untracked inside `docs/`. Same rule as the planning docs — private working artefact, iterates freely without polluting git history or pushing opinions to the public repo.

### Decisions log granularity
- Options: only record close-call decisions where the winner wasn't obvious / include every decision with a viable alternative, even no-brainers.
- Chosen: every decision with a viable alternative, per user direction. Even "obvious" choices (`pgvector/pgvector:pg16` vs building the extension myself) are worth recording because the rationale — not just the outcome — is what's useful six months later.

---

## Phase 5 — Audit fixes (2026-04-27)

GPT-5 Codex audited the deployed app and raised 32 findings. The full triage lives in the plan file; this section records the trade-offs for the fixes that shipped vs the ones we deliberately disregarded.

### What got fixed and why
- **Filename sanitisation** (`storage.safe_basename`) — real path traversal via raw `UploadFile.filename` was passing the suffix check. Cheap fix, high value, would have been embarrassing if discovered. Permissive whitelist (alphanumerics + dots + dashes + underscores + parens + spaces) so reasonable filenames stay intact for download.
- **Softened the parse fallback heuristic** — the old per-page rule (>30% empty pages OR <100 chars/page avg) tripped on legitimate short text-layer PDFs and broke them in prod where `unstructured` isn't installed. Now falls back only when total extracted text is below 200 chars, or when both the page-density rule fires AND the doc has very little text. Keeps the prod-image-size win, stops false-failures.
- **JWT `sub` guard** — `int(user_id)` returning 500 on a validly signed but malformed token was a 3-line fix.
- **JWT placeholder secret rejected outside `dev`** — a sentinel + model validator that crashes startup if `JWT_SECRET == "change-me-in-env"` and `ENV != "dev"`. Makes the well-known dev secret undeployable.
- **Conversation rename bumps `updated_at`** — without this, renaming a conversation didn't move it in the sidebar's recent-activity ordering. Surprising.
- **Chat call bounded** — `temperature=0.2`, `max_tokens=1024`, 60s timeout. Question field gets `Field(max_length=2000)`. Caps cost and bounds latency without changing answer quality on grounded QA.
- **Error messages categorised** — SSE error frames return `"upstream model error"` or `"internal error"` instead of `str(e)`. Ingestion failures persist a generic "delete and retry" message instead of raw exception text. Stops parser/SQL/OpenAI internals leaking.
- **Pydantic length constraints** across email/password/title — keeps payloads sane.
- **PDF ArrayBuffer cache (frontend)** — same-document repeated previews now hit a `Map<documentId, Promise<ArrayBuffer>>` instead of refetching. Stores the in-flight Promise so concurrent first-clicks share one network request; drops the entry on rejection so retries refetch.
- **Eval re-ingestion** drops a non-ready existing fixture row before re-inserting, so an interrupted prior run doesn't trip the unique constraint on the next try.

### What got disregarded and why
- **Lockfiles (`uv.lock` / `package-lock.json`)** — real concern but multi-hour scope (tool adoption + CI rework + Docker rework). Defer to a hypothetical Phase 6 stability commit. Reproducibility rests on caret-pinned versions for now.
- **localStorage JWT** — explicitly deferred decision; portfolio demo accepts XSS-token-theft risk in exchange for CSRF-free CORS.
- **Stuck-ingestion retry / cleanup** — explicitly deferred at Phase 1; user can delete + re-upload. Periodic cleanup belongs in a real queue.
- **Docker root user** — Railway runs containers as root anyway. Document as known harden-later.
- **Magic-byte file sniff** — extension validation + parser failure is good enough for a portfolio. Adds dep weight for marginal defense in depth.
- **Password >72 byte rejection** — silent truncation matches historical passlib behaviour and what users would expect from password managers. Rejecting would break already-registered accounts.
- **Mobile responsive** — explicitly deferred earlier in Phase 4.
- **A11y on dialogs/icons** — separate effort; defer to dedicated a11y pass.
- **BM25 English-only** — already documented as MVP-first.
- **SSE parser non-spec-compliance** — works for our server which is the only producer. Spec-compliance only matters if the parser gets reused.
- **Public docs split** — user already chose private (Phase 4 workflow decision).

### Notes for future-me
- The audit's "stale decisions" callouts on `localStorage`, `passlib`, `extension validation`, `no lockfile`, `unstructured-in-prod`, `migrations in app container`, `CDN PDF worker`, and `ignored docs` were all reviewed individually. Most stay as-is; `unstructured-in-prod` was effectively addressed by softening the heuristic instead of re-adding the dep; the doc-drift entries were fixed in this same pass.
- Adding a "Current state" snapshot at the top of this file (also part of this pass) was the audit's suggestion — a chronological log is honest about how decisions evolved, but new readers shouldn't have to scroll to the latest section to know what's actually true today.

---

## Phase 5 — Follow-ups (post-audit small fixes)

### JWT placeholder alignment
- Options: align the dev defaults in `docker-compose.yml` and `backend/.env.example` to match the validator's known placeholder (`change-me-in-env`) / expand the validator to check against a *set* of known placeholders.
- Chosen: align the defaults. Single source of truth — every "this is a placeholder" string is the same constant. Set-based check would be more robust to future drift, but it puts the validator at risk of going stale every time a new placeholder appears somewhere.

### Empty/whitespace JWT_SECRET also rejected
- Options: only reject the named placeholder when `ENV != "dev"` / also reject empty or whitespace-only.
- Chosen: also reject empty. An empty secret is even more dangerous than the placeholder (anyone can forge tokens trivially); takes one extra `.strip()` check.

### Frontend error page redaction
- Options: keep showing `error.message` so users can describe what they saw / drop it entirely / show a generic message plus the React error digest.
- Chosen: generic message + `error.digest`. The digest is short, opaque, and useful for support correlation; the message can leak parser, SQL, or upstream-provider internals. Detail still goes to the dev console.

---

## Phase 6 — UI polish

### Persistent app header vs per-page controls
- Options: keep the per-page sign-out + theme toggle (one in the library header, one in the chat sidebar) / single persistent `<AppHeader />` component used by both signed-in pages.
- Chosen: persistent header. The two per-page placements were inconsistent (library header vs chat sidebar bottom), and a casual user could miss the chat-sidebar one entirely. A single component is the natural place for "this is an app" controls.

### Where to mount the AppHeader
- Options: in `frontend/app/layout.tsx` so it renders everywhere automatically / mount it explicitly in each authenticated page.
- Chosen: explicit per-page mount. The layout wraps `/login` too, and the login page should NOT show "sign out" or auth-only controls. Mounting per-page keeps that distinction clean without adding "is the user signed in?" logic to the layout.

### Brand as a separate reusable component
- Options: inline the AskDocs name in each page that needs it / extract a `<Brand size>` component.
- Chosen: separate component. Used in both the app header (default size) and the login page (large size), and gives a single hook for dropping in a logo glyph later. Cost is one extra file.

### Brand links to `/library`
- Options: brand is unlinked text / brand links to `/` (which redirects to `/library`) / brand links directly to `/library`.
- Chosen: direct link to `/library`. "Home" for a signed-in user is the library; redirect-via-`/` adds a needless hop. Slight redundancy with the chat sidebar's "new chat" button (which also navigates to `/library`) — acceptable because the sidebar button is more discoverable for that action.

### Login page shape
- Options: minimal form on a blank page (current Phase 1) / dedicated marketing-style landing page at `/` with a separate `/login` form / form-in-a-card with brand + tagline above on the `/login` route.
- Chosen: form-in-a-card with brand + tagline. Rejects building a marketing page (scope creep, needs design assets, doesn't earn its place for a portfolio demo). The card pattern + tagline gives the login page a distinct identity without splitting the route tree.

### Login footer copy
- Options: no footer / generic footer ("© AskDocs") / honest portfolio attribution with a GitHub link.
- Chosen: portfolio attribution. Sets recruiter expectations correctly and gives a direct path to the source. Trivially deletable if the framing ever needs to change.

### Recent conversations placement
- Options: another panel in the chat-page sidebar / a section on the library page below the documents / a separate `/conversations` route.
- Chosen: below the documents on the library page. Library is where a signed-in user lands; the empty space below the document list is exactly where their attention is already. A separate route would split the surface area and add navigation complexity for marginal benefit.

### Recent conversations: hide when empty
- Options: always render the section with a "Nothing here yet" stub / hide the whole section when the list is empty.
- Chosen: hide. The library's existing zero-doc empty state already handles "nothing's happened yet"; a second "Recent conversations: nothing here" stub would just look like dead UI.

### Recent conversations: how many
- Options: all conversations / top N by recency / paginated.
- Chosen: top 5. Anchors the section visually without growing into a second list-of-everything. The chat-page sidebar is still the place for the full list; this is a "jump back into recent work" affordance.

### Library zero-doc empty state rewrite
- Options: keep the terse "No documents yet" copy / rewrite as a friendlier welcome hero pointing back at the upload zone.
- Chosen: rewrite. First-run users land on this exact state; the friendlier copy reads like deliberate UI rather than an empty list. Ends with `↑ the upload area is right above this card` so the visual flow back to the upload zone is explicit.

### Chat page header layout
- Options: drop the AppHeader for /chat to preserve the full-height three-panel layout / wrap the three-panel `<main>` in a flex column with the header on top.
- Chosen: flex column with header on top. Loses ~56px of vertical space but keeps the persistent app identity across every signed-in screen. The transcript scroll area was already the dominant chunk of the viewport; trimming a header's worth doesn't meaningfully change reading comfort.

### Mobile collapse on the new header
- Options: build a hamburger/drawer pattern for narrow viewports / accept fixed-height header that may overflow on phones.
- Chosen: accept overflow for now. Mobile responsiveness is an explicit deferred decision (Phase 4 plan, audit). The header is the *least* of the desktop-first issues — the three-panel chat layout is the bigger one. Defer with the rest.
