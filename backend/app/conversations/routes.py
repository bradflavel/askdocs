from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.deps import CurrentUser
from app.conversations.schemas import (
    ConversationOut,
    CreateConversationRequest,
    MessageOut,
)
from app.db import get_session
from app.models import Conversation, Document, Message

router = APIRouter(prefix="/conversations", tags=["conversations"])


async def load_owned_conversation(
    session: AsyncSession, conversation_id: int, user_id: int
) -> Conversation:
    """404 if the conversation doesn't exist or its document isn't owned by user_id."""
    result = await session.execute(
        select(Conversation)
        .join(Document, Conversation.document_id == Document.id)
        .where(Conversation.id == conversation_id, Document.user_id == user_id)
    )
    conv = result.scalar_one_or_none()
    if not conv:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="conversation not found")
    return conv


@router.post("", response_model=ConversationOut, status_code=status.HTTP_201_CREATED)
async def create_conversation(
    body: CreateConversationRequest,
    user: CurrentUser,
    session: Annotated[AsyncSession, Depends(get_session)],
) -> ConversationOut:
    doc = await session.get(Document, body.document_id)
    if not doc or doc.user_id != user.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="document not found")
    title = body.title or doc.filename
    conv = Conversation(document_id=doc.id, title=title)
    session.add(conv)
    await session.commit()
    await session.refresh(conv)
    return ConversationOut.model_validate(conv)


@router.get("", response_model=list[ConversationOut])
async def list_conversations(
    user: CurrentUser,
    session: Annotated[AsyncSession, Depends(get_session)],
) -> list[ConversationOut]:
    result = await session.execute(
        select(Conversation)
        .join(Document, Conversation.document_id == Document.id)
        .where(Document.user_id == user.id)
        .order_by(Conversation.updated_at.desc())
    )
    return [ConversationOut.model_validate(c) for c in result.scalars()]


@router.get("/{conversation_id}/messages", response_model=list[MessageOut])
async def get_messages(
    conversation_id: int,
    user: CurrentUser,
    session: Annotated[AsyncSession, Depends(get_session)],
) -> list[MessageOut]:
    await load_owned_conversation(session, conversation_id, user.id)
    result = await session.execute(
        select(Message)
        .where(Message.conversation_id == conversation_id)
        .order_by(Message.created_at.asc(), Message.id.asc())
    )
    return [MessageOut.model_validate(m) for m in result.scalars()]
