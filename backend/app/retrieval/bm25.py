from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Chunk


async def search_bm25(
    session: AsyncSession,
    document_id: int,
    question: str,
    k: int = 20,
) -> list[int]:
    """Return up to k chunk ids for the document ordered by ts_rank descending.

    Uses Postgres' 'english' text-search config against the GIN index on
    chunks.tsv. If the question contains only stop-words or punctuation,
    plainto_tsquery returns an empty tsquery that never matches — returns
    an empty list, which RRF handles as a single-list case gracefully.
    """
    tsq = func.plainto_tsquery("english", question)
    stmt = (
        select(Chunk.id)
        .where(
            Chunk.document_id == document_id,
            Chunk.tsv.op("@@")(tsq),
        )
        .order_by(func.ts_rank(Chunk.tsv, tsq).desc())
        .limit(k)
    )
    result = await session.execute(stmt)
    return [row[0] for row in result.all()]
