from datetime import datetime

from pydantic import BaseModel, Field


class ConversationOut(BaseModel):
    id: int
    document_id: int
    title: str | None
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class CreateConversationRequest(BaseModel):
    document_id: int
    title: str | None = Field(default=None, max_length=200)


class RenameConversationRequest(BaseModel):
    title: str = Field(min_length=1, max_length=200)


class MessageOut(BaseModel):
    id: int
    role: str
    content: str
    cited_chunk_ids: list[int]
    created_at: datetime

    model_config = {"from_attributes": True}
