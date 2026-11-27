"""Bounded, read-only views of the shared papers for external research agents."""
from __future__ import annotations

from scholaraio.hub.collections import CollectionService
from scholaraio.hub.errors import InvalidRequest, NotFound
from scholaraio.hub.retrieval import RetrievalService
from scholaraio.hub.runtime import LibraryRuntime
from scholaraio.hub.search import SearchService
from scholaraio.hub.views import paper_row


class LibraryReader:
    def __init__(self, runtime: LibraryRuntime, collections: CollectionService,
                 search: SearchService, retrieval: RetrievalService):
        self.runtime = runtime
        self.collections = collections
        self.search = search
        self.retrieval = retrieval

    def papers(self, category: str | None = None, offset: int = 0, limit: int = 50) -> dict:
        rows = [paper_row(record) for record in self.runtime.papers]
        if category is not None:
            rows = [row for row in rows if row.get("category") == category]
        rows.sort(key=lambda row: (row["title"], row["id"]))
        return {"papers": rows[offset:offset + limit], "total": len(rows),
                "nextOffset": offset + limit if offset + limit < len(rows) else None}

    def collection_list(self) -> dict:
        return {"collections": [{key: row[key] for key in ("id", "name", "paperCount")}
                                for row in self.collections.list()]}

    def scope(self, paper_ids: list[str] | None, collection_ids: list[str] | None) -> set[str] | None:
        # Omitted means the whole shared library; an explicit [] means no papers.
        if paper_ids == [] and not collection_ids:
            return set()
        for pid in paper_ids or []:
            self.runtime.papers.find(pid)
        ids = self.collections.scope(collection_ids or [], paper_ids or [])
        return set(ids) if ids is not None else None

    def find(self, query: str, paper_ids: list[str] | None, collection_ids: list[str] | None,
             mode: str = "keyword", limit: int = 10) -> dict:
        if not query.strip():
            raise InvalidRequest("A search query is required")
        result = self.search.browse(query, mode, limit, self.scope(paper_ids, collection_ids))
        return {**result, "query": query}

    def passages(self, query: str, paper_ids: list[str] | None, collection_ids: list[str] | None) -> dict:
        scope = self.scope(paper_ids, collection_ids)
        if scope == set():
            return {"citations": [], "truncated": False}
        return self.retrieval.context(query, sorted(scope) if scope is not None else [])

    def read(self, paper_id: str, start_line: int = 1, max_lines: int = 200) -> dict:
        record = self.runtime.papers.find(paper_id)
        path = record.directory / "paper.md"
        if not path.is_file():
            raise NotFound("Paper has not been parsed yet")
        lines, size, next_line = [], 0, None
        with path.open(encoding="utf-8") as stream:
            for number, line in enumerate(stream, 1):
                if number < start_line:
                    continue
                if len(line) > 32000:
                    raise InvalidRequest("This document has a line over 32000 characters; download its Markdown")
                if len(lines) == max_lines or size + len(line) > 32000:
                    next_line = number
                    break
                lines.append(line.rstrip("\n"))
                size += len(line)
        end = start_line + len(lines) - 1
        return {"paper": paper_row(record), "startLine": start_line, "endLine": end,
                "text": "\n".join(f"{start_line + i}: {line}" for i, line in enumerate(lines)),
                "nextLine": next_line}
