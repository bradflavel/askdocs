from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Chunk


async def search_vector(
    session: AsyncSession,
    document_id: int,
    embedding: list[float],
    k: int = 20,
) -> list[int]:
    """Return up to k chunk ids for the document, ordered by cosine distance ascending.

    Cosine distance `<=>` is the pgvector operator paired with the HNSW index
    built in the initial migration.
    """
    stmt = (
        select(Chunk.id)
        .where(Chunk.document_id == document_id)
        .order_by(Chunk.embedding.cosine_distance(embedding))
        .limit(k)
    )
    result = await session.execute(stmt)
    return [row[0] for row in result.all()]
