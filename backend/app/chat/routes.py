import json
import logging
import re
from collections.abc import AsyncIterator
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import StreamingResponse
from openai import APIError, AsyncOpenAI, OpenAIError
from pydantic import BaseModel, Field
from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.deps import CurrentUser
from app.chat.prompt import ContextChunk, build_messages
from app.config import get_settings
from app.conversations.routes import load_owned_conversation
from app.db import get_session, session_scope
from app.models import Chunk, Conversation, Message
from app.retrieval.bm25 import search_bm25
from app.retrieval.embed import embed_all
from app.retrieval.fuse import rrf
from app.retrieval.vector import search_vector

log = logging.getLogger(__name__)

router = APIRouter(prefix="/chat", tags=["chat"])

CITATION_RE = re.compile(r"\[chunk:(\d+)\]")
TOP_K_PER_RETRIEVER = 20
CONTEXT_CHUNKS = 8
HISTORY_MESSAGES = 6
# Bound the model call so we don't accidentally pay for runaway answers
# or block on a hung upstream. Low temperature for grounded QA.
CHAT_TEMPERATURE = 0.2
CHAT_MAX_TOKENS = 1024
OPENAI_TIMEOUT_SECONDS = 60.0


class ChatRequest(BaseModel):
    conversation_id: int
    question: str = Field(min_length=1, max_length=2000)


def _sse(event: str, data: dict) -> str:
    return f"event: {event}\ndata: {json.dumps(data)}\n\n"


def _parse_citations(text: str, allowed: set[int]) -> list[int]:
    found = (int(m) for m in CITATION_RE.findall(text))
    return list(dict.fromkeys(i for i in found if i in allowed))


@router.post("")
async def chat(
    body: ChatRequest,
    user: CurrentUser,
    session: Annotated[AsyncSession, Depends(get_session)],
) -> StreamingResponse:
    conv = await load_owned_conversation(session, body.conversation_id, user.id)
    document_id = conv.document_id
    question = body.question.strip()
    if not question:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="question required")

    async def stream() -> AsyncIterator[str]:
        try:
            q_emb = (await embed_all([question]))[0]

            async with session_scope() as s:
                history_rows = (
                    (
                        await s.execute(
                            select(Message)
                            .where(Message.conversation_id == body.conversation_id)
                            .order_by(Message.created_at.desc(), Message.id.desc())
                            .limit(HISTORY_MESSAGES)
                        )
                    )
                    .scalars()
                    .all()
                )
                history = [{"role": m.role, "content": m.content} for m in reversed(history_rows)]

                vec_ids = await search_vector(s, document_id, q_emb, k=TOP_K_PER_RETRIEVER)
                bm25_ids = await search_bm25(s, document_id, question, k=TOP_K_PER_RETRIEVER)
                ranked_lists = [vec_ids]
                if bm25_ids:
                    ranked_lists.append(bm25_ids)
                fused = rrf(ranked_lists)
                allowed_ids = [cid for cid, _ in fused[:CONTEXT_CHUNKS]]
                if not allowed_ids:
                    yield _sse("error", {"detail": "no indexed chunks for this document"})
                    return

                chunk_rows = (
                    (await s.execute(select(Chunk).where(Chunk.id.in_(allowed_ids))))
                    .scalars()
                    .all()
                )
                by_id = {c.id: c for c in chunk_rows}
                context_chunks = [
                    ContextChunk(
                        id=c.id,
                        content=c.content,
                        page_start=c.page_start or 1,
                        page_end=c.page_end or 1,
                    )
                    for cid in allowed_ids
                    if (c := by_id.get(cid)) is not None
                ]

            messages = build_messages(context_chunks, history, question)
            settings = get_settings()
            client = AsyncOpenAI(
                api_key=settings.openai_api_key,
                timeout=OPENAI_TIMEOUT_SECONDS,
            )

            parts: list[str] = []
            openai_stream = await client.chat.completions.create(
                model=settings.chat_model,
                messages=messages,
                stream=True,
                temperature=CHAT_TEMPERATURE,
                max_tokens=CHAT_MAX_TOKENS,
            )
            async for event in openai_stream:
                if not event.choices:
                    continue
                delta = event.choices[0].delta.content
                if delta:
                    parts.append(delta)
                    yield _sse("token", {"text": delta})

            full_text = "".join(parts)
            cited = _parse_citations(full_text, set(allowed_ids))

            async with session_scope() as s:
                s.add(
                    Message(
                        conversation_id=body.conversation_id,
                        role="user",
                        content=question,
                        cited_chunk_ids=[],
                    )
                )
                assistant_msg = Message(
                    conversation_id=body.conversation_id,
                    role="assistant",
                    content=full_text,
                    cited_chunk_ids=cited,
                )
                s.add(assistant_msg)
                await s.flush()
                await s.execute(
                    update(Conversation)
                    .where(Conversation.id == body.conversation_id)
                    .values(updated_at=func.now())
                )
                assistant_id = assistant_msg.id

            yield _sse("citation", {"chunk_ids": cited})
            yield _sse("done", {"message_id": assistant_id})

        except (APIError, OpenAIError):
            log.exception("chat stream failed: upstream model error")
            yield _sse("error", {"detail": "upstream model error"})
        except Exception:
            log.exception("chat stream failed: internal error")
            yield _sse("error", {"detail": "internal error"})

    return StreamingResponse(
        stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
            "Connection": "keep-alive",
        },
    )
