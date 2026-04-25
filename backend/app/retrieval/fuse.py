def rrf(ranked_lists: list[list[int]], k: int = 60) -> list[tuple[int, float]]:
    """Reciprocal rank fusion across multiple ranked lists of ids.

    ranked_lists[i] is a list of chunk ids ordered best-first from source i.
    Returns (id, score) pairs sorted by score descending. k=60 is the
    Cormack/Clarke/Buettcher default and works well without tuning.
    """
    scores: dict[int, float] = {}
    for lst in ranked_lists:
        for rank, chunk_id in enumerate(lst):
            scores[chunk_id] = scores.get(chunk_id, 0.0) + 1.0 / (k + rank + 1)
    return sorted(scores.items(), key=lambda x: x[1], reverse=True)
