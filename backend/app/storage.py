import os
import uuid
from pathlib import Path

from app.config import get_settings


def _base_dir() -> Path:
    settings = get_settings()
    base = Path(settings.storage_dir)
    base.mkdir(parents=True, exist_ok=True)
    return base


def temp_upload_path(user_id: int) -> Path:
    tmp_dir = _base_dir() / "tmp" / str(user_id)
    tmp_dir.mkdir(parents=True, exist_ok=True)
    return tmp_dir / f"{uuid.uuid4().hex}.part"


def document_dir(user_id: int, document_id: int) -> Path:
    return _base_dir() / str(user_id) / str(document_id)


def final_document_path(user_id: int, document_id: int, filename: str) -> Path:
    doc_dir = document_dir(user_id, document_id)
    doc_dir.mkdir(parents=True, exist_ok=True)
    return doc_dir / filename


def move_to_final(tmp: Path, user_id: int, document_id: int, filename: str) -> Path:
    final = final_document_path(user_id, document_id, filename)
    os.replace(tmp, final)
    return final
