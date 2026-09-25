"""Corrections to stored paper metadata, made through the Hub.

Ingestion records what it could establish; a paper that arrived without a DOI
stays marked incomplete until someone fills the gap here or an API lookup does.
Both paths end the same way: write the metadata, then rebuild the index so
search and the citation views agree with it.
"""
from __future__ import annotations

from typing import Any

from scholaraio.hub.errors import InvalidRequest
from scholaraio.hub.repository import PaperRecord
from scholaraio.hub.runtime import LibraryRuntime
from scholaraio.hub.views import paper_row

# Fields a person may correct by hand. Identifiers the pipeline derives
# (citation counts, API sources, references) are not edited here.
EDITABLE = ("title", "doi", "authors", "year", "journal", "abstract", "paper_type")
# What a complete record needs before the "incomplete" mark is cleared.
REQUIRED = ("title", "doi")


class MetadataService:
    def __init__(self, runtime: LibraryRuntime):
        self.runtime = runtime

    def update(self, paper_id: str, fields: dict[str, Any]):
        if not fields:
            raise InvalidRequest("没有要修改的字段")
        unknown = set(fields) - set(EDITABLE)
        if unknown:
            raise InvalidRequest(f"不可修改的字段：{', '.join(sorted(unknown))}")
        with self.runtime.lock:
            record = self.runtime.papers.find(paper_id)
            for field, value in fields.items():
                record.meta[field] = normalize(field, value)
            return paper_row(self._commit(record))

    def refetch(self, paper_id: str):
        """Ask the external APIs again for everything a DOI can resolve."""
        from scholaraio.services.ingest_metadata import refetch_metadata

        with self.runtime.lock:
            record = self.runtime.papers.find(paper_id)
            if not (record.meta.get("doi") or "").strip():
                raise InvalidRequest("该文献没有 DOI，请先补充 DOI 再重新查询")
            changed = refetch_metadata(record.directory / "meta.json")
            record = self._commit(self.runtime.papers.reload(record))
            return {"changed": bool(changed), "paper": paper_row(record)}

    def _commit(self, record: PaperRecord) -> PaperRecord:
        mark_completeness(record.meta)
        self.runtime.papers.save(record)
        self.runtime.reindex()
        return self.runtime.papers.reload(record)


def normalize(field: str, value: Any):
    if field == "authors":
        if not isinstance(value, list) or any(not isinstance(item, str) for item in value):
            raise InvalidRequest("作者必须是字符串列表")
        return [item.strip() for item in value if item.strip()]
    if field == "year":
        if value in (None, ""):
            return None
        try:
            return int(value)
        except (TypeError, ValueError) as error:
            raise InvalidRequest("年份必须是数字") from error
    if not isinstance(value, str):
        raise InvalidRequest(f"{field} 必须是字符串")
    return value.strip()


def mark_completeness(meta: dict) -> None:
    missing = [field for field in REQUIRED if not str(meta.get(field) or "").strip()]
    if missing:
        meta["metadata_status"] = "incomplete"
        meta["missing_metadata"] = missing
        return
    meta.pop("metadata_status", None)
    meta.pop("missing_metadata", None)


__all__ = ["EDITABLE", "MetadataService"]
