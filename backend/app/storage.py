import os
import re
import uuid
from pathlib import Path

from app.config import get_settings

# Permissive whitelist for the on-disk filename. Anything outside this set —
# path separators, NUL, control chars, exotic punctuation — gets stripped.
# We keep dots (extensions), spaces, dashes, underscores, parentheses, and
# alphanumerics. Result is collapsed and trimmed.
_SAFE_FILENAME_RE = re.compile(r"[^A-Za-z0-9._\-() ]+")
_MAX_BASENAME_LENGTH = 200


def safe_basename(filename: str) -> str:
    """Return a filename safe to use as a path component.

    Strips directories (defends against `../etc/passwd.pdf`-style traversal),
    NUL and control bytes, and any character outside a permissive whitelist.
    Raises ValueError if the resulting name is empty or has no extension —
    callers should catch and return 400.
    """
    # Path(...).name strips any directory components from forward- or
    # back-slash-style paths (Windows clients send backslashes).
    base = Path(filename.replace("\\", "/")).name
    base = _SAFE_FILENAME_RE.sub("", base).strip(". ")
    if not base or "." not in base:
        raise ValueError("filename is empty or has no extension after sanitization")
    return base[:_MAX_BASENAME_LENGTH]


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
