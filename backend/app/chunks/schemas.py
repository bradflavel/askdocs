from pydantic import BaseModel


class ChunkOut(BaseModel):
    id: int
    document_id: int
    chunk_index: int
    content: str
    page_start: int | None
    page_end: int | None

    model_config = {"from_attributes": True}
