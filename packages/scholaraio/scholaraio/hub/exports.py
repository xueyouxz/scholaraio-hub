"""Take references out of the library, and check a draft's citations against it.

Both work on the same selection the rest of the browser uses: the papers the
user ticked, or the open project, or the whole library.
"""
from __future__ import annotations

from datetime import datetime, timezone

from scholaraio.hub.errors import InvalidRequest
from scholaraio.hub.projects import ProjectService
from scholaraio.hub.runtime import LibraryRuntime

FORMATS = {
    "bibtex": (".bib", "application/x-bibtex"),
    "ris": (".ris", "application/x-research-info-systems"),
    "markdown": (".md", "text/markdown"),
}
STYLES = ("apa", "vancouver", "chicago-author-date", "mla")


class ExportService:
    def __init__(self, runtime: LibraryRuntime, projects: ProjectService):
        self.runtime = runtime
        self.projects = projects

    def directories(self, paper_ids: list[str], project_id: str | None) -> list[str] | None:
        """Resolve a selection to paper directory names; None means the whole library."""
        scoped = self.projects.scope(project_id, paper_ids)
        if scoped is None:
            return None
        if not scoped:
            raise InvalidRequest("没有可导出的文献")
        return [self.runtime.papers.find(paper_id).directory.name for paper_id in scoped]

    def export(
        self,
        paper_ids: list[str],
        project_id: str | None = None,
        fmt: str = "bibtex",
        style: str = "apa",
    ) -> dict:
        from scholaraio.services.export import export_bibtex, export_markdown_refs, export_ris

        if fmt not in FORMATS:
            raise InvalidRequest(f"不支持的导出格式：{fmt}")
        if style not in STYLES:
            raise InvalidRequest(f"不支持的引用格式：{style}")
        with self.runtime.lock:
            names = self.directories(paper_ids, project_id)
            papers_dir = self.runtime.cfg.papers_dir
            if fmt == "bibtex":
                content = export_bibtex(papers_dir, paper_ids=names)
            elif fmt == "ris":
                content = export_ris(papers_dir, paper_ids=names)
            else:
                content = export_markdown_refs(papers_dir, cfg=self.runtime.cfg, paper_ids=names, style=style)
        if not content.strip():
            raise InvalidRequest("没有可导出的文献")
        suffix, content_type = FORMATS[fmt]
        stamp = datetime.now(timezone.utc).strftime("%Y%m%d")
        return {
            "filename": f"{project_id or 'library'}-{stamp}{suffix}",
            "contentType": content_type,
            "content": content,
        }

    def check(self, text: str, project_id: str | None = None) -> dict:
        """Report which of a draft's citations the library can actually back."""
        from scholaraio.services.citation_check import check_citations, extract_citations

        if not text.strip():
            raise InvalidRequest("请粘贴要核查的正文")
        citations = extract_citations(text)
        if not citations:
            return {"citations": [], "verified": 0, "missing": 0, "ambiguous": 0}
        with self.runtime.lock:
            results = check_citations(
                citations,
                self.runtime.cfg.index_db,
                paper_ids=self.projects.scope_set(project_id),
            )
        return {
            "citations": [
                {
                    "raw": entry.get("raw", ""),
                    "author": entry.get("author", ""),
                    "year": entry.get("year", ""),
                    "status": entry["status"],
                    "matches": [
                        {"paperId": str(match.get("paper_id") or ""), "title": match.get("title", "")}
                        for match in entry.get("matches", [])
                    ],
                }
                for entry in results
            ],
            "verified": sum(1 for entry in results if entry["status"] == "VERIFIED"),
            "missing": sum(1 for entry in results if entry["status"] == "NOT_IN_LIBRARY"),
            "ambiguous": sum(1 for entry in results if entry["status"] == "AMBIGUOUS"),
        }


__all__ = ["FORMATS", "STYLES", "ExportService"]
