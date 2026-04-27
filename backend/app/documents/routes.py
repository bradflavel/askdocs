import hashlib
import shutil
from pathlib import Path
from typing import Annotated

import aiofiles
from fastapi import (
    APIRouter,
    BackgroundTasks,
    Depends,
    File,
    HTTPException,
    Response,
    UploadFile,
    status,
)
from fastapi.responses import FileResponse
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.deps import CurrentUser
from app.config import get_settings
from app.db import get_session
from app.documents.ingest import process_document
from app.documents.schemas import DocumentOut, UploadResponse
from app.models import Document
from app.storage import (
    document_dir,
    final_document_path,
    move_to_final,
    safe_basename,
    temp_upload_path,
)

router = APIRouter(prefix="/documents", tags=["documents"])

ALLOWED_SUFFIXES = {".pdf", ".docx"}


@router.post("", response_model=UploadResponse, status_code=status.HTTP_201_CREATED)
async def upload_document(
    user: CurrentUser,
    session: Annotated[AsyncSession, Depends(get_session)],
    bg: BackgroundTasks,
    response: Response,
    file: Annotated[UploadFile, File(...)],
) -> UploadResponse:
    settings = get_settings()

    raw_filename = file.filename or ""
    try:
        filename = safe_basename(raw_filename)
    except ValueError as e:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            detail="invalid filename",
        ) from e
    suffix = Path(filename).suffix.lower()
    if suffix not in ALLOWED_SUFFIXES:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            detail="only PDF and DOCX files are accepted",
        )

    tmp = temp_upload_path(user.id)
    hasher = hashlib.sha256()
    written = 0
    try:
        async with aiofiles.open(tmp, "wb") as out:
            while True:
                chunk = await file.read(1 << 20)  # 1 MiB
                if not chunk:
                    break
                written += len(chunk)
                if written > settings.max_upload_bytes:
                    raise HTTPException(
                        status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                        detail=f"file exceeds {settings.max_upload_bytes} bytes",
                    )
                hasher.update(chunk)
                await out.write(chunk)
    except Exception:
        tmp.unlink(missing_ok=True)
        raise

    file_hash = hasher.hexdigest()

    existing = (
        await session.execute(
            select(Document).where(
                Document.user_id == user.id,
                Document.file_hash == file_hash,
            )
        )
    ).scalar_one_or_none()

    if existing:
        tmp.unlink(missing_ok=True)
        response.status_code = status.HTTP_200_OK
        return UploadResponse(id=existing.id, status=existing.status, duplicate=True)

    doc = Document(
        user_id=user.id,
        filename=filename,
        file_hash=file_hash,
        status="pending",
    )
    session.add(doc)
    await session.commit()
    await session.refresh(doc)

    try:
        final_path = move_to_final(tmp, user.id, doc.id, filename)
    except OSError as e:
        await session.execute(
            update(Document)
            .where(Document.id == doc.id)
            .values(status="failed", error=f"storage error: {e}")
        )
        await session.commit()
        tmp.unlink(missing_ok=True)
        raise HTTPException(
            status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="failed to persist uploaded file",
        ) from e

    bg.add_task(process_document, doc.id, str(final_path))
    return UploadResponse(id=doc.id, status="pending", duplicate=False)


@router.get("", response_model=list[DocumentOut])
async def list_documents(
    user: CurrentUser,
    session: Annotated[AsyncSession, Depends(get_session)],
) -> list[DocumentOut]:
    result = await session.execute(
        select(Document).where(Document.user_id == user.id).order_by(Document.uploaded_at.desc())
    )
    return [DocumentOut.model_validate(d) for d in result.scalars()]


@router.get("/{document_id}", response_model=DocumentOut)
async def get_document(
    document_id: int,
    user: CurrentUser,
    session: Annotated[AsyncSession, Depends(get_session)],
) -> DocumentOut:
    doc = await session.get(Document, document_id)
    if not doc or doc.user_id != user.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="document not found")
    return DocumentOut.model_validate(doc)


@router.get("/{document_id}/file")
async def get_document_file(
    document_id: int,
    user: CurrentUser,
    session: Annotated[AsyncSession, Depends(get_session)],
) -> FileResponse:
    doc = await session.get(Document, document_id)
    if not doc or doc.user_id != user.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="document not found")
    path = final_document_path(user.id, doc.id, doc.filename)
    if not path.exists():
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="file not found on disk")
    media_type = (
        "application/pdf" if doc.filename.lower().endswith(".pdf") else "application/octet-stream"
    )
    return FileResponse(path, media_type=media_type, filename=doc.filename)


@router.delete("/{document_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_document(
    document_id: int,
    user: CurrentUser,
    session: Annotated[AsyncSession, Depends(get_session)],
) -> Response:
    doc = await session.get(Document, document_id)
    if not doc or doc.user_id != user.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="document not found")
    await session.delete(doc)
    await session.commit()
    dir_ = document_dir(user.id, document_id)
    if dir_.exists():
        shutil.rmtree(dir_, ignore_errors=True)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
