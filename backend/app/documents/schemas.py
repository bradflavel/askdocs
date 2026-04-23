from datetime import datetime

from pydantic import BaseModel


class DocumentOut(BaseModel):
    id: int
    filename: str
    page_count: int | None
    status: str
    uploaded_at: datetime
    error: str | None = None

    model_config = {"from_attributes": True}


class UploadResponse(BaseModel):
    id: int
    status: str
    duplicate: bool
