"""Take references out of the library.

An export works on the same selection the rest of the browser uses: the papers
the user ticked, or the open collection, or the whole library.
"""

from __future__ import annotations

from datetime import datetime, timezone

from scholaraio.hub.collections import CollectionService
from scholaraio.hub.errors import InvalidRequest
from scholaraio.hub.runtime import LibraryRuntime

FORMATS = {
    "bibtex": (".bib", "application/x-bibtex"),
    "ris": (".ris", "application/x-research-info-systems"),
    "markdown": (".md", "text/markdown"),
}
STYLES = ("apa", "vancouver", "chicago-author-date", "mla")


class ExportService:
    def __init__(self, runtime: LibraryRuntime, collections: CollectionService):
        self.runtime = runtime
        self.collections = collections

    def directories(self, paper_ids: list[str], collection_id: str | None) -> list[str] | None:
        """Resolve a selection to paper directory names; None means the whole library."""
        scoped = self.collections.scope([collection_id] if collection_id else [], paper_ids)
        if scoped is None:
            return None
        if not scoped:
            raise InvalidRequest("No papers to export")
        return [self.runtime.papers.find(paper_id).directory.name for paper_id in scoped]

    def export(
        self,
        paper_ids: list[str],
        collection_id: str | None = None,
        fmt: str = "bibtex",
        style: str = "apa",
    ) -> dict:
        from scholaraio.services.export import export_bibtex, export_markdown_refs, export_ris

        if fmt not in FORMATS:
            raise InvalidRequest(f"Unsupported export format: {fmt}")
        if style not in STYLES:
            raise InvalidRequest(f"Unsupported citation style: {style}")
        with self.runtime.lock:
            names = self.directories(paper_ids, collection_id)
            papers_dir = self.runtime.cfg.papers_dir
            if fmt == "bibtex":
                content = export_bibtex(papers_dir, paper_ids=names)
            elif fmt == "ris":
                content = export_ris(papers_dir, paper_ids=names)
            else:
                content = export_markdown_refs(papers_dir, cfg=self.runtime.cfg, paper_ids=names, style=style)
        if not content.strip():
            raise InvalidRequest("No papers to export")
        suffix, content_type = FORMATS[fmt]
        stamp = datetime.now(timezone.utc).strftime("%Y%m%d")
        return {
            "filename": f"{self.collections.get(collection_id)['name'] if collection_id else 'library'}-{stamp}{suffix}",
            "contentType": content_type,
            "content": content,
        }


__all__ = ["FORMATS", "STYLES", "ExportService"]
