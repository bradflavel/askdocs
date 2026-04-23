import logging

log = logging.getLogger(__name__)


async def process_document(document_id: int, path: str) -> None:
    """Background ingestion task. Real parse/chunk/embed pipeline lands next commit."""
    log.info("ingest queued: document_id=%s path=%s", document_id, path)
