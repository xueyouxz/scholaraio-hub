"""The papers library on disk, addressed by the id the rest of Hub uses.

Every paper is a directory holding ``meta.json``. Upstream stores walk those
directories by name; Hub names a paper by its UUID. This module is the one
place that translates between the two.
"""

from __future__ import annotations

from collections.abc import Iterator
from pathlib import Path
from typing import Any, NamedTuple

from scholaraio.hub.errors import NotFound
from scholaraio.stores.papers import iter_paper_dirs, read_meta, write_meta


def paper_id(directory: Path, meta: dict[str, Any]) -> str:
    """The id a paper is known by: its UUID, or the directory name before it had one."""
    return str(meta.get("id") or directory.name)


class PaperRecord(NamedTuple):
    directory: Path
    meta: dict[str, Any]

    @property
    def id(self) -> str:
        return paper_id(self.directory, self.meta)


class PaperRepository:
    def __init__(self, papers_dir: Path):
        self.papers_dir = papers_dir

    def __iter__(self) -> Iterator[PaperRecord]:
        for directory in iter_paper_dirs(self.papers_dir):
            yield PaperRecord(directory, read_meta(directory))

    def directories(self) -> list[Path]:
        """Paper directories without reading their metadata."""
        return list(iter_paper_dirs(self.papers_dir))

    def ids(self) -> set[str]:
        return {record.id for record in self}

    def get(self, paper_id: str) -> PaperRecord | None:
        return next((record for record in self if record.id == paper_id), None)

    def find(self, paper_id: str) -> PaperRecord:
        record = self.get(paper_id)
        if record is None:
            raise NotFound(f"Paper not found: {paper_id}", code="PAPER_NOT_FOUND")
        return record

    def reload(self, record: PaperRecord) -> PaperRecord:
        return PaperRecord(record.directory, read_meta(record.directory))

    def save(self, record: PaperRecord) -> None:
        write_meta(record.directory, record.meta)

    def find_by_hash(self, fingerprint: str) -> str | None:
        """The paper already holding this exact file, if any."""
        return next((record.id for record in self if record.meta.get("hub", {}).get("sha256") == fingerprint), None)


__all__ = ["PaperRecord", "PaperRepository", "paper_id"]
