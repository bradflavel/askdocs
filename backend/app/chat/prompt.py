from dataclasses import dataclass

SYSTEM_INSTRUCTION = (
    "You are a research assistant. Answer the user's question using ONLY "
    "the information in the CONTEXT below. Cite sources inline using the "
    "format [chunk:ID] after each claim, where ID is one of the chunk ids "
    "shown. If the context does not contain the answer, reply exactly:\n"
    '"I don\'t know based on the provided documents."\n'
    "Do not invent facts, page numbers, or citations."
)


@dataclass
class ContextChunk:
    id: int
    content: str
    page_start: int
    page_end: int


def format_context(chunks: list[ContextChunk]) -> str:
    lines: list[str] = []
    for c in chunks:
        lines.append(f"[chunk:{c.id}] (pages {c.page_start}-{c.page_end})")
        lines.append(c.content)
        lines.append("")
    return "\n".join(lines).rstrip()


def build_messages(
    chunks: list[ContextChunk],
    history: list[dict],
    question: str,
) -> list[dict]:
    """Build the OpenAI chat.completions messages list.

    System message carries both the instruction and the context block so the
    model treats retrieved passages as grounding, not prior turns. History is
    passed as real user/assistant turns; the new question is the final user turn.
    """
    context_block = format_context(chunks)
    return [
        {
            "role": "system",
            "content": f"{SYSTEM_INSTRUCTION}\n\nCONTEXT:\n{context_block}",
        },
        *history,
        {"role": "user", "content": question},
    ]
