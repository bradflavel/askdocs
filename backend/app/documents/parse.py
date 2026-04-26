import logging
from pathlib import Path

from pypdf import PdfReader

log = logging.getLogger(__name__)

EMPTY_PAGE_RATIO = 0.30
MIN_CHARS_PER_PAGE = 100


class NoTextLayerError(ValueError):
    """Raised when a PDF has no extractable text — scanned doc, no OCR at MVP."""


def parse_pdf(path: Path) -> list[tuple[int, str]]:
    reader = PdfReader(str(path))
    pages: list[tuple[int, str]] = []
    for i, page in enumerate(reader.pages, start=1):
        try:
            text = page.extract_text() or ""
        except Exception:
            text = ""
        pages.append((i, text))
    return pages


def parse_docx(path: Path) -> list[tuple[int, str]]:
    from docx import Document as DocxDocument

    doc = DocxDocument(str(path))
    text = "\n".join(p.text for p in doc.paragraphs if p.text)
    return [(1, text)]


def should_fallback_to_unstructured(pages: list[tuple[int, str]]) -> bool:
    if not pages:
        return True
    empty = sum(1 for _, t in pages if not t.strip())
    if empty / len(pages) > EMPTY_PAGE_RATIO:
        return True
    avg = sum(len(t) for _, t in pages) / len(pages)
    if avg < MIN_CHARS_PER_PAGE:
        return True
    return False


def parse_pdf_unstructured(path: Path) -> list[tuple[int, str]]:
    try:
        from unstructured.partition.pdf import partition_pdf
    except ImportError as e:
        raise RuntimeError(
            "This PDF needs the unstructured fallback parser, which is not "
            "installed in this image. Install with the [fallback-parser] "
            "extras to enable it."
        ) from e

    elements = partition_pdf(str(path))
    by_page: dict[int, list[str]] = {}
    for el in elements:
        page = getattr(el.metadata, "page_number", None) or 1
        txt = str(el).strip()
        if txt:
            by_page.setdefault(page, []).append(txt)
    return [(p, "\n".join(parts)) for p, parts in sorted(by_page.items())]


def parse_document(path: Path) -> list[tuple[int, str]]:
    suffix = path.suffix.lower()
    if suffix == ".pdf":
        pages = parse_pdf(path)
        if should_fallback_to_unstructured(pages):
            log.info("falling back to unstructured parser for %s", path)
            pages = parse_pdf_unstructured(path)
        if all(not t.strip() for _, t in pages):
            raise NoTextLayerError(
                "This PDF has no text layer. OCR support is on the roadmap."
            )
        return pages
    if suffix == ".docx":
        return parse_docx(path)
    raise ValueError(f"unsupported file type: {suffix}")
