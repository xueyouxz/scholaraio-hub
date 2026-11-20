"""How a stored paper is shown to the browser.

``meta.json`` keeps the pipeline's own field names and shapes; the browser reads
one flat camelCase row per paper. Every response that describes a paper builds
it here, so the two never drift apart.
"""
from __future__ import annotations

from pathlib import Path
from typing import Any

from scholaraio.hub.classification import category
from scholaraio.hub.repository import PaperRecord
from scholaraio.stores.papers import authors_text, find_pdf

COVER_SUFFIXES = frozenset({".png", ".jpg", ".jpeg", ".webp"})
GALLERY_SUFFIXES = COVER_SUFFIXES | {".gif"}


def cover_image(directory: Path) -> str | None:
    images = directory / "images"
    if not images.is_dir():
        return None
    cover = next((p for p in sorted(images.iterdir()) if p.suffix.lower() in COVER_SUFFIXES), None)
    return f"images/{cover.name}" if cover else None


def paper_row(record: PaperRecord) -> dict[str, Any]:
    directory, meta = record
    hub = meta.get("hub", {})
    has_markdown = (directory / "paper.md").exists()
    citation_count = meta.get("citation_count")
    return {
        **category(record),
        "id": record.id,
        "title": meta.get("title") or directory.name,
        "authors": authors_text(meta.get("authors", [])),
        "year": str(meta.get("year") or ""),
        "doi": meta.get("doi") or "",
        "journal": meta.get("journal") or "",
        "abstract": meta.get("abstract") or "",
        "hasPdf": find_pdf(directory) is not None,
        "hasMarkdown": has_markdown,
        "parseStatus": hub.get("parseStatus", "ready" if has_markdown else "pending"),
        "error": hub.get("error"),
        "coverImage": cover_image(directory),
        "citationCount": citation_count if isinstance(citation_count, int) else None,
        "citationCounts": (
            {key: value for key, value in citation_count.items() if isinstance(value, int)}
            if isinstance(citation_count, dict)
            else None
        ),
        "paperType": meta.get("paper_type") or "",
        "metadataStatus": meta.get("metadata_status") or "complete",
        "missingMetadata": list(meta.get("missing_metadata") or []),
    }


def paper_detail(record: PaperRecord) -> dict[str, Any]:
    directory, meta = record
    markdown = directory / "paper.md"
    conclusion = meta.get("l3_conclusion")
    return {
        **paper_row(record),
        "markdown": markdown.read_text(encoding="utf-8") if markdown.exists() else "",
        "l3Conclusion": conclusion if isinstance(conclusion, str) else "",
    }


__all__ = ["COVER_SUFFIXES", "GALLERY_SUFFIXES", "paper_detail", "paper_row"]
