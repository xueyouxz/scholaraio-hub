"""Citation views over the library index, scoped the way the browser asks.

The relations themselves come from the ingest pipeline: a paper's references and
citation counts are written during ingestion, so these views are only useful for
papers that went through it.
"""
from __future__ import annotations

from scholaraio.hub.errors import InvalidRequest
from scholaraio.hub.projects import ProjectService
from scholaraio.hub.runtime import LibraryRuntime
from scholaraio.hub.views import paper_row
from scholaraio.services import index

# Papers one shared-references request may compare.
SHARED_LIMIT = 100


class CitationService:
    def __init__(self, runtime: LibraryRuntime, projects: ProjectService):
        self.runtime = runtime
        self.projects = projects

    def row(self, paper_id: str | None) -> dict | None:
        """Describe a paper that is in the library, or None for an outside one."""
        record = self.runtime.papers.get(paper_id) if paper_id else None
        return paper_row(record) if record else None

    def references(self, paper_id: str, project_id: str | None = None):
        """What this paper cites; entries the library does not hold keep their DOI."""
        with self.runtime.lock:
            self.runtime.papers.find(paper_id)
            rows = index.get_references(
                paper_id, self.runtime.cfg.index_db, paper_ids=self.projects.scope_set(project_id)
            )
            return {
                "references": [
                    {"doi": row.get("target_doi") or "", "paper": self.row(row.get("target_id")),
                     "title": row.get("title") or "", "year": str(row.get("year") or "")}
                    for row in rows
                ]
            }

    def citing(self, paper_id: str, project_id: str | None = None):
        """Papers in the library that cite this one."""
        with self.runtime.lock:
            self.runtime.papers.find(paper_id)
            rows = index.get_citing_papers(
                paper_id, self.runtime.cfg.index_db, paper_ids=self.projects.scope_set(project_id)
            )
            papers = [self.row(row.get("source_id")) for row in rows]
            return {"citing": [paper for paper in papers if paper]}

    def shared(self, paper_ids: list[str], project_id: str | None = None, min_shared: int = 2):
        """References cited by several of the selected papers."""
        paper_ids = paper_ids[:SHARED_LIMIT]
        if len(paper_ids) < 2:
            raise InvalidRequest("共同参考文献至少需要两篇论文")
        min_shared = max(min(min_shared, len(paper_ids)), 2)
        with self.runtime.lock:
            for paper_id in paper_ids:
                self.runtime.papers.find(paper_id)
            rows = index.get_shared_references(
                paper_ids, self.runtime.cfg.index_db, min_shared, paper_ids=self.projects.scope_set(project_id)
            )
            return {
                "shared": [
                    {"doi": row.get("target_doi") or "", "sharedCount": int(row.get("shared_count") or 0),
                     "paper": self.row(row.get("target_id")), "title": row.get("title") or ""}
                    for row in rows
                ]
            }

    def most_cited(self, limit: int = 20, project_id: str | None = None):
        with self.runtime.lock:
            try:
                rows = index.top_cited(
                    self.runtime.cfg.index_db, top_k=limit, paper_ids=self.projects.scope_set(project_id)
                )
            except FileNotFoundError:
                return {"papers": []}
            papers = [
                {"paper": self.row(row.get("id")), "citationCount": row.get("citation_count")}
                for row in rows
            ]
            return {"papers": [entry for entry in papers if entry["paper"]]}


__all__ = ["CitationService"]
