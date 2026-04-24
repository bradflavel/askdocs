from collections.abc import Iterable

from openai import AsyncOpenAI

from app.config import get_settings


def _client() -> AsyncOpenAI:
    settings = get_settings()
    return AsyncOpenAI(api_key=settings.openai_api_key)


def _batched(items: list[str], n: int) -> Iterable[list[str]]:
    for i in range(0, len(items), n):
        yield items[i : i + n]


async def embed_all(texts: list[str], batch_size: int = 100) -> list[list[float]]:
    if not texts:
        return []
    settings = get_settings()
    client = _client()
    results: list[list[float]] = []
    for batch in _batched(texts, batch_size):
        resp = await client.embeddings.create(model=settings.embedding_model, input=batch)
        results.extend(d.embedding for d in resp.data)
    return results
