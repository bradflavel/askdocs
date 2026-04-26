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
        select(Chunk, Document.filename)
        .join(Document, Chunk.document_id == Document.id)
        .where(Chunk.id == chunk_id, Document.user_id == user.id)
    )
    row = (await session.execute(stmt)).first()
    if not row:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="chunk not found")
    chunk, filename = row
    return ChunkOut(
        id=chunk.id,
        document_id=chunk.document_id,
        document_filename=filename,
        chunk_index=chunk.chunk_index,
        content=chunk.content,
        page_start=chunk.page_start,
        page_end=chunk.page_end,
    )
