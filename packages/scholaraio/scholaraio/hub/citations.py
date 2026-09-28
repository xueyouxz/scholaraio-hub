"""Citation views over the library index, scoped the way the browser asks.

The relations themselves come from the ingest pipeline: a paper's references and
citation counts are written during ingestion, so these views are only useful for
papers that went through it.
"""
from __future__ import annotations

from scholaraio.hub.collections import CollectionService
from scholaraio.hub.runtime import LibraryRuntime
from scholaraio.hub.views import paper_row
from scholaraio.services import index


class CitationService:
    def __init__(self, runtime: LibraryRuntime, collections: CollectionService):
        self.runtime = runtime
        self.collections = collections

    def row(self, paper_id: str | None) -> dict | None:
        """Describe a paper that is in the library, or None for an outside one."""
        record = self.runtime.papers.get(paper_id) if paper_id else None
        return paper_row(record) if record else None

    def references(self, paper_id: str, collection_id: str | None = None):
        """What this paper cites; entries the library does not hold keep their DOI."""
        with self.runtime.lock:
            self.runtime.papers.find(paper_id)
            rows = index.get_references(
                paper_id, self.runtime.cfg.index_db, paper_ids=self.collections.scope_set(collection_id)
            )
            return {
                "references": [
                    {"doi": row.get("target_doi") or "", "paper": self.row(row.get("target_id")),
                     "title": row.get("title") or "", "year": str(row.get("year") or "")}
                    for row in rows
                ]
            }

    def citing(self, paper_id: str, collection_id: str | None = None):
        """Papers in the library that cite this one."""
        with self.runtime.lock:
            self.runtime.papers.find(paper_id)
            rows = index.get_citing_papers(
                paper_id, self.runtime.cfg.index_db, paper_ids=self.collections.scope_set(collection_id)
            )
            papers = [self.row(row.get("source_id")) for row in rows]
            return {"citing": [paper for paper in papers if paper]}


__all__ = ["CitationService"]
