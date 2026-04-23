"""initial schema

Revision ID: 0001
Revises:
Create Date: 2026-04-23

"""
from alembic import op

revision = "0001"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("CREATE EXTENSION IF NOT EXISTS vector")
    op.execute("CREATE EXTENSION IF NOT EXISTS citext")

    op.execute(
        """
        CREATE TABLE users (
          id            BIGSERIAL PRIMARY KEY,
          email         CITEXT UNIQUE NOT NULL,
          password_hash TEXT NOT NULL,
          created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
        )
        """
    )

    op.execute(
        """
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
        )
        """
    )
    op.execute("CREATE INDEX idx_documents_user ON documents(user_id)")

    op.execute(
        """
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
        )
        """
    )
    op.execute("CREATE INDEX idx_chunks_document ON chunks(document_id)")
    op.execute("CREATE INDEX idx_chunks_tsv ON chunks USING GIN (tsv)")
    op.execute(
        """
        CREATE INDEX idx_chunks_embedding ON chunks
          USING hnsw (embedding vector_cosine_ops)
          WITH (m = 16, ef_construction = 64)
        """
    )

    op.execute(
        """
        CREATE TABLE conversations (
          id          BIGSERIAL PRIMARY KEY,
          document_id BIGINT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
          title       TEXT,
          created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
        )
        """
    )
    op.execute("CREATE INDEX idx_conversations_document ON conversations(document_id)")

    op.execute(
        """
        CREATE TABLE messages (
          id              BIGSERIAL PRIMARY KEY,
          conversation_id BIGINT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
          role            TEXT NOT NULL CHECK (role IN ('user','assistant')),
          content         TEXT NOT NULL,
          cited_chunk_ids BIGINT[] NOT NULL DEFAULT '{}',
          created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
        )
        """
    )
    op.execute(
        "CREATE INDEX idx_messages_conversation ON messages(conversation_id, created_at)"
    )


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS messages")
    op.execute("DROP TABLE IF EXISTS conversations")
    op.execute("DROP TABLE IF EXISTS chunks")
    op.execute("DROP TABLE IF EXISTS documents")
    op.execute("DROP TABLE IF EXISTS users")
