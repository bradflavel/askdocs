# AskDocs — Data Model

Postgres schema. Five tables, one database, `vector` and `citext` extensions enabled. For how this schema is used at runtime, see [PIPELINES.md](PIPELINES.md).

---

## Overview

The `chunks` table is the only interesting one — it carries both the embedding (for vector search) and a `tsvector` column (for BM25 keyword search). Co-locating both signals in one row is what makes hybrid search clean: one table, one join, two ranked lists.

**Deletion cascades.** `users → documents → {chunks, conversations → messages}`. Deleting a document removes its chunks *and* its conversations (each conversation is bound to exactly one document). This is the chosen policy for citation integrity: once the source document is gone, conversations that cited it are gone too, so no stored `cited_chunk_ids` can dangle.

---

## DDL

```sql
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS citext;

CREATE TABLE users (
  id            BIGSERIAL PRIMARY KEY,
  email         CITEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE documents (
  id          BIGSERIAL PRIMARY KEY,
  user_id     BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  filename    TEXT NOT NULL,
  file_hash   TEXT NOT NULL,
  page_count  INT,
  status      TEXT NOT NULL CHECK (status IN ('pending','processing','ready','failed')),
  error       TEXT,
  uploaded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, file_hash)
);
CREATE INDEX idx_documents_user ON documents(user_id);

CREATE TABLE chunks (
  id           BIGSERIAL PRIMARY KEY,
  document_id  BIGINT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  chunk_index  INT NOT NULL,
  content      TEXT NOT NULL,
  page_start   INT,
  page_end     INT,
  char_start   INT,
  char_end     INT,
  embedding    vector(1536),
  tsv          tsvector GENERATED ALWAYS AS (to_tsvector('english', content)) STORED,
  UNIQUE (document_id, chunk_index)
);
CREATE INDEX idx_chunks_document ON chunks(document_id);
CREATE INDEX idx_chunks_tsv      ON chunks USING GIN (tsv);
CREATE INDEX idx_chunks_embedding ON chunks
  USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

CREATE TABLE conversations (
  id          BIGSERIAL PRIMARY KEY,
  document_id BIGINT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  title       TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_conversations_document ON conversations(document_id);

CREATE TABLE messages (
  id              BIGSERIAL PRIMARY KEY,
  conversation_id BIGINT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  role            TEXT NOT NULL CHECK (role IN ('user','assistant')),
  content         TEXT NOT NULL,
  cited_chunk_ids BIGINT[] NOT NULL DEFAULT '{}',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_messages_conversation ON messages(conversation_id, created_at);
```

---

## Notes

- `tsv` is a `GENERATED ALWAYS AS ... STORED` column — it stays in sync automatically on insert/update, no trigger needed.
- `embedding` uses `vector(1536)` matching `text-embedding-3-small`. Change this dimension and you change the model.
- HNSW is preferred over IVFFlat for query-time latency; `m=16, ef_construction=64` are sane defaults and can be tuned later.
- `users.email` uses `citext` so `Alice@example.com` and `alice@example.com` are one account. Still normalize to lowercase in the auth layer before storing.
- `documents.(user_id, file_hash)` unique constraint gives you dedupe for free. See [API.md](API.md#post-documents) for the 200/201 upload contract.
- `chunks.(document_id, chunk_index)` is unique so reprocessing is idempotent — a retry writes to the same chunk index rather than duplicating rows.
- `chunks.page_start` / `page_end` — chunks can span page boundaries when the token-aware splitter crosses a page break. Equal for single-page chunks.
- `conversations.document_id` binds a conversation to exactly one document — and by transitivity, to whoever owns that document. User ownership is **derived** via `conversations → documents.user_id` rather than duplicated on the conversation row; this way the DB cannot admit a conversation whose document belongs to a different user. "My conversations" queries join through `documents`. The cascade on document deletion keeps `messages.cited_chunk_ids` from ever pointing at missing chunks.
- `conversations.updated_at` is bumped on every new message; the chat-view conversation list sorts by it.
- `messages.cited_chunk_ids BIGINT[]` is a **deliberate MVP simplification**. A proper `message_citations(message_id, chunk_id)` table would give cleaner integrity and easier analytics, but the array is fine until citations become queryable data.
- Keep the original text in `chunks.content` — citation rendering should never re-open the PDF.

---

## Migrations

Managed via **Alembic**. Initial migration creates the above schema; each subsequent change lands as its own revision under `backend/alembic/versions/`. Run `alembic upgrade head` as part of `docker-compose up` and CI setup.
