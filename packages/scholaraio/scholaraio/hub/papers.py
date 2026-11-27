"""Reading one paper, or the whole list: rows, full text, files and where the
reader left off."""
from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from scholaraio.hub.errors import InvalidRequest, NotFound
from scholaraio.hub.runtime import LibraryRuntime
from scholaraio.hub.storage import atomic_json
from scholaraio.hub.views import GALLERY_SUFFIXES, paper_detail, paper_row
from scholaraio.stores.papers import find_pdf

# What a paper directory may serve besides its PDF: figures and supplements.
ATTACHMENT_SUFFIXES = GALLERY_SUFFIXES | {".pdf"}
POSITION_FILE = "reading-position.json"
DEFAULT_POSITION = {"page": 1, "line": 1, "mode": "pdf"}


class PaperService:
    def __init__(self, runtime: LibraryRuntime):
        self.runtime = runtime
        self.repository = runtime.papers

    def list(self) -> list[dict[str, Any]]:
        return [paper_row(record) for record in self.repository]

    def categorize(self, paper_ids: list[str], category: str | None) -> dict:
        name = category.strip() if category else None
        if name and (len(name) > 120 or any(ord(char) < 32 for char in name)):
            raise InvalidRequest("Category must be 1–120 printable characters")
        with self.runtime.lock:
            records = [self.repository.find(pid) for pid in dict.fromkeys(paper_ids)]
            for record in records:
                hub = record.meta.setdefault("hub", {})
                if name:
                    hub["category"] = name
                else:
                    hub.pop("category", None)
                self.repository.save(record)
            self.runtime.events.publish("papers")
        return {"updated": len(records)}

    def detail(self, paper_id: str) -> dict[str, Any]:
        return paper_detail(self.repository.find(paper_id))

    def images(self, paper_id: str) -> list[str]:
        directory = self.repository.find(paper_id).directory.resolve()
        images = directory / "images"
        if not images.resolve().is_relative_to(directory) or not images.is_dir():
            return []
        return [p.name for p in sorted(images.iterdir()) if p.is_file()
                and p.resolve().is_relative_to(directory)
                and p.suffix.lower() in GALLERY_SUFFIXES]

    def pdf(self, paper_id: str) -> Path:
        file = find_pdf(self.repository.find(paper_id).directory)
        if file is None:
            raise NotFound("PDF unavailable")
        return file

    def attachment(self, paper_id: str, relative: str) -> Path:
        """A file inside the paper's directory, never one a link points out to."""
        directory = self.repository.find(paper_id).directory.resolve()
        file = (directory / relative).resolve()
        if not file.is_relative_to(directory) or not file.is_file():
            raise NotFound("Attachment unavailable")
        if file.suffix.lower() not in ATTACHMENT_SUFFIXES:
            raise InvalidRequest("Unsupported attachment type")
        return file

    def position(self, paper_id: str) -> dict[str, Any]:
        file = self.repository.find(paper_id).directory / POSITION_FILE
        return json.loads(file.read_text()) if file.exists() else dict(DEFAULT_POSITION)

    def save_position(self, paper_id: str, position: dict[str, Any]) -> dict[str, Any]:
        atomic_json(self.repository.find(paper_id).directory / POSITION_FILE, position)
        return position


__all__ = ["PaperService"]
