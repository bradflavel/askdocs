from dataclasses import dataclass

from langchain_text_splitters import RecursiveCharacterTextSplitter


@dataclass
class ChunkPiece:
    content: str
    page_start: int
    page_end: int
    char_start: int
    char_end: int


def _concat_with_page_ranges(
    pages: list[tuple[int, str]],
) -> tuple[str, list[tuple[int, int, int]]]:
    parts: list[str] = []
    ranges: list[tuple[int, int, int]] = []
    cursor = 0
    for page_no, text in pages:
        start = cursor
        parts.append(text)
        cursor += len(text)
        ranges.append((page_no, start, cursor))
        parts.append("\n\n")
        cursor += 2
    return "".join(parts), ranges


def _page_range_for(
    char_start: int,
    char_end: int,
    ranges: list[tuple[int, int, int]],
) -> tuple[int, int]:
    if not ranges:
        return 1, 1
    start_page = ranges[0][0]
    end_page = start_page
    for page_no, p_start, p_end in ranges:
        if p_start <= char_start < p_end:
            start_page = page_no
        if p_start < char_end <= p_end:
            end_page = page_no
    if end_page < start_page:
        end_page = start_page
    return start_page, end_page


def token_aware_split(
    pages: list[tuple[int, str]],
    size: int = 500,
    overlap: int = 50,
) -> list[ChunkPiece]:
    full_text, ranges = _concat_with_page_ranges(pages)
    splitter = RecursiveCharacterTextSplitter.from_tiktoken_encoder(
        chunk_size=size,
        chunk_overlap=overlap,
    )
    pieces = splitter.split_text(full_text)

    out: list[ChunkPiece] = []
    pos = 0
    for piece in pieces:
        idx = full_text.find(piece, pos)
        if idx == -1:
            idx = full_text.find(piece)
        if idx == -1:
            idx = pos
        end = idx + len(piece)
        start_page, end_page = _page_range_for(idx, end, ranges)
        out.append(
            ChunkPiece(
                content=piece,
                page_start=start_page,
                page_end=end_page,
                char_start=idx,
                char_end=end,
            )
        )
        pos = idx + 1
    return out
