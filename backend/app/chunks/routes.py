from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.deps import CurrentUser
from app.chunks.schemas import ChunkOut
from app.db import get_session
from app.models import Chunk, Document

router = APIRouter(prefix="/chunks", tags=["chunks"])


@router.get("/{chunk_id}", response_model=ChunkOut)
async def get_chunk(
    chunk_id: int,
    user: CurrentUser,
    session: Annotated[AsyncSession, Depends(get_session)],
) -> ChunkOut:
    stmt = (
        select(Chunk)
        .join(Document, Chunk.document_id == Document.id)
        .where(Chunk.id == chunk_id, Document.user_id == user.id)
    )
    chunk = (await session.execute(stmt)).scalar_one_or_none()
    if not chunk:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="chunk not found")
    return ChunkOut.model_validate(chunk)
