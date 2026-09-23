"""Corrections to stored paper metadata, made through the Hub.

Ingestion records what it could establish; a paper that arrived without a DOI
stays marked incomplete until someone fills the gap here or an API lookup does.
Both paths end the same way: write the metadata, then rebuild the index so
search and the citation views agree with it.
"""
from __future__ import annotations

from typing import Any

from scholaraio.stores.papers import read_meta, write_meta

# Fields a person may correct by hand. Identifiers the pipeline derives
# (citation counts, API sources, references) are not edited here.
EDITABLE = ("title", "doi", "authors", "year", "journal", "abstract", "paper_type")
# What a complete record needs before the "incomplete" mark is cleared.
REQUIRED = ("title", "doi")


class HubMetadata:
    def __init__(self, library):
        self.library = library

    def update(self, paper_id: str, fields: dict[str, Any]):
        unknown = set(fields) - set(EDITABLE)
        if unknown:
            raise ValueError(f"不可修改的字段：{', '.join(sorted(unknown))}")
        with self.library.lock:
            directory, meta = self.library.find(paper_id)
            for field, value in fields.items():
                meta[field] = self.normalize(field, value)
            self.mark_completeness(meta)
            write_meta(directory, meta)
            self.library.reindex()
            return self.library.row(directory, read_meta(directory))

    def refetch(self, paper_id: str):
        """Ask the external APIs again for everything a DOI can resolve."""
        from scholaraio.services.ingest_metadata import refetch_metadata

        with self.library.lock:
            directory, meta = self.library.find(paper_id)
            if not (meta.get("doi") or "").strip():
                raise ValueError("该文献没有 DOI，请先补充 DOI 再重新查询")
            changed = refetch_metadata(directory / "meta.json")
            meta = read_meta(directory)
            self.mark_completeness(meta)
            write_meta(directory, meta)
            self.library.reindex()
            return {"changed": bool(changed), "paper": self.library.row(directory, meta)}

    def normalize(self, field: str, value: Any):
        if field == "authors":
            if not isinstance(value, list) or any(not isinstance(item, str) for item in value):
                raise ValueError("作者必须是字符串列表")
            return [item.strip() for item in value if item.strip()]
        if field == "year":
            if value in (None, ""):
                return None
            try:
                return int(value)
            except (TypeError, ValueError) as error:
                raise ValueError("年份必须是数字") from error
        if not isinstance(value, str):
            raise ValueError(f"{field} 必须是字符串")
        return value.strip()

    def mark_completeness(self, meta: dict) -> None:
        missing = [field for field in REQUIRED if not str(meta.get(field) or "").strip()]
        if missing:
            meta["metadata_status"] = "incomplete"
            meta["missing_metadata"] = missing
            return
        meta.pop("metadata_status", None)
        meta.pop("missing_metadata", None)
