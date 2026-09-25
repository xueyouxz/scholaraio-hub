"""Take references out of the library.

An export works on the same selection the rest of the browser uses: the papers
the user ticked, or the open project, or the whole library.
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
            "filename": f"{self.projects.get(project_id)['name'] if project_id else 'library'}-{stamp}{suffix}",
            "contentType": content_type,
            "content": content,
        }


__all__ = ["FORMATS", "STYLES", "ExportService"]
