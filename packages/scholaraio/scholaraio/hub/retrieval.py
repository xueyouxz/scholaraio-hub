"""Passages an agent receives with a question, cited back to the papers.

Before a message goes to the model, Hub looks up what the selected papers (or
the open project, or the whole library) say about it and hands the text over
as numbered citations, within a fixed character budget.
"""
from __future__ import annotations

import re
from dataclasses import asdict
from itertools import zip_longest
from typing import Any

from scholaraio.hub.projects import ProjectService
from scholaraio.hub.runtime import LibraryRuntime
from scholaraio.hub.search import SearchService
from scholaraio.services.chunks import chunk_search, iter_paper_chunks

# Total characters of passage text one request may carry.
BUDGET = 24000
# No single passage may take more than this share of the budget.
PASSAGE_LIMIT = 4800
CANDIDATES = 100
STOPWORDS = frozenset({
    "the", "and", "what", "does", "how", "this", "that", "are", "can", "with", "from", "about", "please",
})


class RetrievalService:
    def __init__(self, runtime: LibraryRuntime, projects: ProjectService, search: SearchService):
        self.runtime = runtime
        self.projects = projects
        self.search = search

    def context(self, query: str, paper_ids: list[str], project_id: str | None = None) -> dict:
        scoped = self.projects.scope(project_id, paper_ids)
        if scoped == []:
            return {"citations": [], "truncated": False}
        scope = set(scoped) if scoped is not None else None
        selected = set(paper_ids)
        collector = _Passages()
        for result in self.search.keyword(query, CANDIDATES, scope):
            if not selected or result["paper"]["id"] in selected:
                collector.extend(result["matches"])
        # Natural questions rarely match every word. Fall back to OR-ranked
        # keyword chunks, while explicit paper selection stays authoritative.
        if not collector:
            collector.extend(c for c in self._any_word(query, scope) if not selected or c["paper_id"] in selected)
        # Round-robin selected papers for broad requests such as summaries.
        collector.extend(self._round_robin(scoped or []))
        return cite(collector.chunks)

    def _any_word(self, query: str, scope: set[str] | None) -> list[dict]:
        terms = re.findall(r"[a-zA-Z][a-zA-Z0-9_-]{2,}", query.casefold())
        keywords = " ".join(term for term in terms if term not in STOPWORDS)[:500]
        if not keywords:
            return []
        with self.runtime.lock:
            return chunk_search(keywords, self.runtime.cfg.index_db, top_k=CANDIDATES, match_any=True, paper_ids=scope)

    def _round_robin(self, paper_ids: list[str]):
        groups = []
        for pid in paper_ids:
            record = self.runtime.papers.find(pid)
            groups.append(iter_paper_chunks(record.directory, meta=record.meta))
        for group in zip_longest(*groups):
            for chunk in group:
                if chunk:
                    yield asdict(chunk)


class _Passages:
    """Chunks in the order found, each chunk once."""

    def __init__(self):
        self.chunks: list[dict[str, Any]] = []
        self.seen: set[str] = set()

    def __bool__(self) -> bool:
        return bool(self.chunks)

    def extend(self, chunks) -> None:
        for chunk in chunks:
            if chunk["chunk_id"] not in self.seen:
                self.seen.add(chunk["chunk_id"])
                self.chunks.append(chunk)


def cite(chunks: list[dict[str, Any]]) -> dict:
    """Number the passages and cut them to the budget."""
    budget = BUDGET
    citations = []
    truncated = False
    for chunk in chunks:
        text = chunk["text"][:min(PASSAGE_LIMIT, budget)]
        if not text:
            truncated = True
            break
        truncated |= len(text) < len(chunk["text"])
        citations.append({"id": f"ref-{len(citations) + 1}", "paperId": chunk["paper_id"],
                          "chunkId": chunk["chunk_id"], "title": chunk["title"],
                          "startLine": int(chunk["start_line"]), "endLine": int(chunk["end_line"]), "text": text})
        budget -= len(text)
    return {"citations": citations, "truncated": truncated}


__all__ = ["RetrievalService"]
