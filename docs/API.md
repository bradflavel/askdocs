# AskDocs — API Surface

FastAPI endpoints. This file is the contract between frontend and backend — update it whenever either side needs a new route, before writing the code on either end.

Backend implementations live under `backend/app/{auth,documents,chunks,conversations,chat}/routes.py` (see [ARCHITECTURE.md](ARCHITECTURE.md#proposed-directory-layout)). Frontend consumption is in [FRONTEND.md](FRONTEND.md).

---

## Authentication

All routes except `/auth/*` require a valid JWT in the `Authorization` header:

```text
Authorization: Bearer <token>
```

Tokens are issued by `/auth/login`. JWT secret lives in the `JWT_SECRET` env var. No cookies, no session state on the server.

Browser integration details (CORS allow-list, credentials policy, streaming headers) live in [ARCHITECTURE.md](ARCHITECTURE.md#browser-integration).

---

## Endpoints

| Method | Path | Purpose | Auth |
|--------|------|---------|------|
| POST | `/auth/register` | Create user | — |
| POST | `/auth/login` | Return JWT | — |
| GET | `/auth/me` | Current user info | ✓ |
| POST | `/documents` | Upload file (multipart), start ingestion | ✓ |
| GET | `/documents` | List user's documents | ✓ |
| GET | `/documents/{id}` | Document metadata + status | ✓ |
| GET | `/documents/{id}/file` | Stream the original document binary (used by the inline PDF preview) | ✓ |
| DELETE | `/documents/{id}` | Delete document — cascades to chunks, conversations, messages | ✓ |
| GET | `/chunks/{chunk_id}` | Fetch single chunk for citation panel (ownership verified via join through `documents`) | ✓ |
| POST | `/conversations` | Create conversation bound to a specific document | ✓ |
| GET | `/conversations` | List user's conversations (sorted by `updated_at` desc) | ✓ |
| PATCH | `/conversations/{id}` | Rename | ✓ |
| DELETE | `/conversations/{id}` | Delete conversation + messages | ✓ |
| POST | `/chat` | Send question, stream response (SSE) | ✓ |
| GET | `/conversations/{id}/messages` | Load transcript | ✓ |

---

## Payloads

### `POST /auth/login`

**Request**
```json
{"email": "alice@example.com", "password": "hunter2"}
```
**Response `200`**
```json
{
  "access_token": "eyJhbGciOiJIUzI1NiIs...",
  "token_type": "bearer",
  "user": {"id": 1, "email": "alice@example.com"}
}
```
**Errors:** `401` bad credentials, `422` malformed body.

### `POST /documents`

Multipart upload. Field name: `file`. Server streams the body to disk while hashing; see [PIPELINES.md](PIPELINES.md#code-sketch).

**Response `201 Created`** — new document accepted, ingestion pending
```json
{"id": 42, "status": "pending", "duplicate": false}
```
**Response `200 OK`** — same user already uploaded this file; returns the existing row
```json
{"id": 17, "status": "ready", "duplicate": true}
```
**Errors:** `400` bad/missing file type, `401` no auth, `413` file > 50MB, `422` missing field.

*Note: duplicate uploads intentionally do **not** return `409` — a duplicate is a success from the caller's perspective, just with a different document id.*

### `GET /documents`

**Response `200`**
```json
[
  {"id": 42, "filename": "paper.pdf",  "page_count": 12, "status": "ready",   "uploaded_at": "2026-04-22T10:00:00Z"},
  {"id": 43, "filename": "notes.docx", "page_count":  4, "status": "pending", "uploaded_at": "2026-04-22T10:05:00Z"}
]
```

### `POST /conversations`

**Request** — `document_id` is required; the conversation is scoped to exactly that document.
```json
{"document_id": 42, "title": "Questions about the paper"}
```
`title` is optional; if omitted, the server generates one from the document filename.

**Response `201`**
```json
{
  "id": 7,
  "document_id": 42,
  "title": "Questions about the paper",
  "created_at": "2026-04-22T10:10:00Z",
  "updated_at": "2026-04-22T10:10:00Z"
}
```
**Errors:** `404` document not found or not owned by caller.

### `POST /chat`

**Request**
```json
{"conversation_id": 7, "question": "What dataset is used?"}
```
The server derives `document_id` from the conversation — the client never passes it. Returns an SSE stream; see next section.

### `GET /conversations/{id}/messages`

**Response `200`**
```json
[
  {
    "id": 101, "role": "user",
    "content": "What dataset is used?",
    "cited_chunk_ids": [],
    "created_at": "2026-04-22T10:11:00Z"
  },
  {
    "id": 102, "role": "assistant",
    "content": "SQuAD 2.0 [chunk:123].",
    "cited_chunk_ids": [123],
    "created_at": "2026-04-22T10:11:02Z"
  }
]
```

### `GET /chunks/{chunk_id}`

Fetches a single chunk for the citation panel. `chunks.id` is globally unique, so the path doesn't need the document id. Ownership is verified server-side by joining through `documents`.

**Response `200`**
```json
{
  "id": 123,
  "document_id": 42,
  "document_filename": "paper.pdf",
  "chunk_index": 17,
  "content": "We evaluate on SQuAD 2.0 and report the following F1 scores...",
  "page_start": 4,
  "page_end": 4
}
```
The `document_filename` field lets the frontend decide whether to render an inline PDF preview (`.pdf`) or fall back to the chunk-content card alone (`.docx`).

**Errors:** `404` chunk not found or its document isn't owned by caller.

### `GET /documents/{document_id}/file`

Streams the original document binary so the inline PDF preview can render the cited page. Ownership is verified server-side. PDFs come back as `application/pdf`; DOCX as `application/octet-stream` (the frontend skips preview rendering and shows the chunk-content card only).

**Response `200`** — `Content-Disposition: attachment; filename="..."` plus the raw bytes.

**Errors:** `404` document not found, not owned by caller, or missing on disk.

---

## Chat Stream Protocol

`POST /chat` returns `Content-Type: text/event-stream` with `Cache-Control: no-cache` and `X-Accel-Buffering: no` (to disable proxy buffering).

Named SSE events:

```text
event: token
data: {"text": "SQuAD"}

event: token
data: {"text": " 2.0"}

event: citation
data: {"chunk_ids": [123]}

event: done
data: {"message_id": 102}
```

- `token` — a single delta from the model. Client appends `text` to the rendered assistant message.
- `citation` — emitted **once**, right before `done`, with the validated `cited_chunk_ids` (filtered against the retrieved set — see [PIPELINES.md](PIPELINES.md#citation-parsing-server-side-validated)).
- `done` — stream terminator carrying the persisted assistant `message_id`. No more frames after this; the server closes the connection.

On server-side failure mid-stream:

```text
event: error
data: {"detail": "upstream model timeout"}
```

…then the server closes. The client treats `error` as terminal.

---

## Error Conventions

- `400` — validation errors (bad input shape, unsupported file type)
- `401` — missing/invalid JWT
- `403` — JWT valid but resource belongs to another user
- `404` — resource doesn't exist
- `409` — conflict on write — e.g. re-registering an existing email. Duplicate document uploads do **not** use `409`; see `POST /documents` above.
- `413` — file exceeds the 50MB cap
- `422` — pydantic validation failure (FastAPI default)
- `500` — unhandled server error; log with request id

Error bodies are JSON: `{"detail": "<message>"}`.
