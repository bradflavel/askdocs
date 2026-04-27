# AskDocs — Frontend

Three screens. Reuse the three-panel layout pattern from prior work; don't reinvent it. Backend contract lives in [API.md](API.md); the streaming/citation behavior it consumes is defined in [PIPELINES.md](PIPELINES.md#generation).

---

## Screens

### Library view — `/library`

- List of uploaded documents with filename, upload date, page count, status badge (pending / processing / ready / failed).
- Poll `GET /documents` while any doc is in `pending` or `processing`. Efficient polling:
  - Start at **2s** intervals.
  - Back off to **5s** after three consecutive polls without a terminal transition, then **10s**.
  - **Pause** while `document.visibilityState === "hidden"`; resume on `visibilitychange`.
  - Only poll doc IDs still in non-terminal states — drop each from the polled set as it becomes `ready` or `failed`.
- Click a ready doc to start a new conversation against it (calls `POST /conversations` with the `document_id`, navigates to `/chat/[id]`).

### Chat view — `/chat/[conversationId]`

Three panels:

- **Left:** conversation list (rename, delete, new chat). Sorted by `updated_at` descending.
- **Middle:** active chat transcript with streaming.
- **Right:** citation panel — when the user clicks `[chunk:N]` in the assistant message, fetch `GET /chunks/{chunk_id}` and display `content` + `page_start`–`page_end` + source document.

### Upload flow

- Drag-and-drop zone, progress bar during upload, polling for status transitions after upload.
- File-type validation client-side (PDF, DOCX).
- 50MB cap enforced both client- and server-side.

---

## Components

- Plain Tailwind utility classes for primitives (button, dialog, card, badge, skeleton, toast). The implementation deliberately skipped `shadcn/ui` to keep the dep tree small; revisit if the component set grows past ~10 hand-rolled pieces.
- `react-markdown` renders assistant messages. Use a **remark plugin** that rewrites `[chunk:N]` tokens into a custom MDAST node *before* rendering, then map that node type to a `<CitationPill>` component. This way code blocks, inline code, and other markdown constructs are never touched. Avoid the blunt `components.text` override pattern — it can match text inside code blocks and other constructs where a citation-shaped string shouldn't become a pill.
- `tailwindcss` for layout plus `@tailwindcss/typography` for the `prose` styles on assistant messages; no CSS modules, no styled-components.
- `next-themes` provides the dark-mode toggle with SSR-safe class flipping on `<html>`.

---

## Streaming Consumption

Auth is via `Authorization: Bearer <jwt>` header (see [API.md](API.md#authentication)). Browser `EventSource` can't attach custom headers and is GET-only, so it is **not** an option for this API.

The implementation uses **raw `fetch` + `ReadableStream`** with a small hand-rolled SSE parser in `frontend/lib/sse.ts`. The backend's named events (`token`, `citation`, `done`, `error` — see [API.md](API.md#chat-stream-protocol)) don't map cleanly onto the Vercel AI SDK's Data Stream Protocol, so the cost of bridging via a `fetch` override and custom parser was higher than just owning the SSE parsing directly. The parser is ~35 lines.

Stream cancellation is wired via `AbortController` — the chat composer's "stop" button calls `abort()` on the in-flight request.

---

## Frontend Libraries

- `next` (App Router) + `react` — framework
- `typescript` — type safety
- `tailwindcss` + `@tailwindcss/typography` — styling and assistant-message prose
- `next-themes` — dark mode with SSR-safe class flipping
- `react-markdown` + `mdast-util-find-and-replace` — render assistant messages with an AST-level citation rewrite
- `react-pdf` — inline PDF preview in the source panel (worker pulled from CDN)
