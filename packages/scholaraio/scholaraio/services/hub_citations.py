"""Citation views over the library index, scoped the way the browser asks.

The relations themselves come from the ingest pipeline: a paper's references and
citation counts are written during ingestion, so these views are only useful for
papers that went through it.
"""
from __future__ import annotations

from scholaraio.services.index import (
    get_citing_papers,
    get_references,
    get_shared_references,
    top_cited,
)


class HubCitations:
    def __init__(self, library):
        self.library = library

    def scope(self, project_id: str | None) -> set[str] | None:
        ids = self.library.projects.scope(project_id, []) if project_id else None
        return set(ids) if ids is not None else None

    def row(self, paper_id: str | None) -> dict | None:
        """Describe a paper that is in the library, or None for an outside one."""
        if not paper_id:
            return None
        try:
            directory, meta = self.library.find(paper_id)
        except KeyError:
            return None
        return self.library.row(directory, meta)

    def references(self, paper_id: str, project_id: str | None = None):
        """What this paper cites; entries the library does not hold keep their DOI."""
        with self.library.lock:
            self.library.find(paper_id)
            rows = get_references(paper_id, self.library.cfg.index_db, paper_ids=self.scope(project_id))
            return {
                "references": [
                    {"doi": row.get("target_doi") or "", "paper": self.row(row.get("target_id")),
                     "title": row.get("title") or "", "year": str(row.get("year") or "")}
                    for row in rows
                ]
            }

    def citing(self, paper_id: str, project_id: str | None = None):
        """Papers in the library that cite this one."""
        with self.library.lock:
            self.library.find(paper_id)
            rows = get_citing_papers(paper_id, self.library.cfg.index_db, paper_ids=self.scope(project_id))
            papers = [self.row(row.get("source_id")) for row in rows]
            return {"citing": [paper for paper in papers if paper]}

    def shared(self, paper_ids: list[str], project_id: str | None = None, min_shared: int = 2):
        """References cited by several of the selected papers."""
        with self.library.lock:
            for paper_id in paper_ids:
                self.library.find(paper_id)
            rows = get_shared_references(
                paper_ids, self.library.cfg.index_db, min_shared, paper_ids=self.scope(project_id)
            )
            return {
                "shared": [
                    {"doi": row.get("target_doi") or "", "sharedCount": int(row.get("shared_count") or 0),
                     "paper": self.row(row.get("target_id")), "title": row.get("title") or ""}
                    for row in rows
                ]
            }

    def most_cited(self, limit: int = 20, project_id: str | None = None):
        with self.library.lock:
            try:
                rows = top_cited(self.library.cfg.index_db, top_k=limit, paper_ids=self.scope(project_id))
            except FileNotFoundError:
                return {"papers": []}
            papers = [
                {"paper": self.row(row.get("id")), "citationCount": row.get("citation_count")}
                for row in rows
            ]
            return {"papers": [entry for entry in papers if entry["paper"]]}
