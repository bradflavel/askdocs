import asyncio
import logging
from pathlib import Path

from sqlalchemy import update

from app.db import session_scope
from app.documents.chunk import token_aware_split
from app.documents.parse import NoTextLayerError, parse_document
from app.models import Chunk, Document
from app.retrieval.embed import embed_all

log = logging.getLogger(__name__)


async def _set_failed(document_id: int, message: str) -> None:
    async with session_scope() as session:
        await session.execute(
            update(Document)
            .where(Document.id == document_id)
            .values(status="failed", error=message)
        )


async def process_document(document_id: int, path: str) -> None:
    file_path = Path(path)
    try:
        async with session_scope() as session:
            await session.execute(
                update(Document).where(Document.id == document_id).values(status="processing")
            )

        pages = await asyncio.to_thread(parse_document, file_path)
        page_count = len(pages) if file_path.suffix.lower() == ".pdf" else None

        pieces = await asyncio.to_thread(token_aware_split, pages, 500, 50)
        if not pieces:
            raise ValueError("no content extracted after chunking")

        vectors = await embed_all([p.content for p in pieces])

        async with session_scope() as session:
            session.add_all(
                Chunk(
                    document_id=document_id,
                    chunk_index=idx,
                    content=p.content,
                    page_start=p.page_start,
                    page_end=p.page_end,
                    char_start=p.char_start,
                    char_end=p.char_end,
                    embedding=v,
                )
                for idx, (p, v) in enumerate(zip(pieces, vectors, strict=True))
            )
            await session.execute(
                update(Document)
                .where(Document.id == document_id)
                .values(status="ready", page_count=page_count, error=None)
            )
        log.info("ingested document_id=%s chunks=%d", document_id, len(pieces))
    except NoTextLayerError as e:
        log.warning("no text layer: document_id=%s", document_id)
        # NoTextLayerError carries a deliberately user-facing message; safe
        # to surface verbatim. Other exception paths are sanitised below.
        await _set_failed(document_id, str(e))
    except Exception:
        log.exception("ingestion failed: document_id=%s", document_id)
        await _set_failed(
            document_id,
            "Ingestion failed. Try deleting and re-uploading the document.",
        )
