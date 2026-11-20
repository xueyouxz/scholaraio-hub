"""Finding papers: the keyword search the browser runs as the user types, and
the library's original search modes."""

from __future__ import annotations

import re
from dataclasses import asdict
from typing import Any

from scholaraio.hub.collections import CollectionService
from scholaraio.hub.errors import InvalidRequest
from scholaraio.hub.runtime import LibraryRuntime
from scholaraio.hub.views import paper_row
from scholaraio.services import index
from scholaraio.services.chunks import chunk_search, iter_paper_chunks

MODES = ("unified", "keyword", "author", "semantic")
MAX_LIMIT = 200
# Chunks shown under each keyword hit.
MATCHES_PER_PAPER = 3


def clamp_limit(limit: int) -> int:
    return min(max(limit, 1), MAX_LIMIT)


def has_cjk(text: str) -> bool:
    return any("㐀" <= c <= "鿿" for c in text)


class SearchService:
    def __init__(self, runtime: LibraryRuntime, collections: CollectionService):
        self.runtime = runtime
        self.collections = collections

    def query(self, text: str, mode: str, *, limit: int = 50, collection_id: str | None = None) -> dict:
        """One search request as the browser makes it."""
        scope = self.collections.scope_set(collection_id)
        return self.browse(text, mode, clamp_limit(limit), scope)

    def keyword(self, text: str, limit: int = 50, paper_ids: set[str] | None = None) -> list[dict[str, Any]]:
        """Papers whose metadata or full text matches every word."""
        if not text.strip():
            return [{"paper": row, "matches": []} for row in self._rows(paper_ids)][:limit]
        query = " ".join(re.findall(r"\w+", text.casefold()))
        if not query:
            return []
        cfg = self.runtime.cfg
        with self.runtime.lock:
            metadata = index.search(query, cfg.index_db, top_k=limit, paper_ids=paper_ids)
            chunks = chunk_search(query, cfg.index_db, top_k=limit, paper_ids=paper_ids)
        matches: dict[str, list] = {row["paper_id"]: [] for row in metadata}
        for chunk in chunks:
            matches.setdefault(chunk["paper_id"], []).append(chunk)
        # unicode61 does not segment CJK. Substring matching also covers author/DOI.
        records = {}
        for record in self.runtime.papers:
            if paper_ids is not None and record.id not in paper_ids:
                continue
            records[record.id] = record
            self._match_literally(record, query, matches)
        return [
            {"paper": paper_row(records[pid]), "matches": parts[:MATCHES_PER_PAPER]}
            for pid, parts in list(matches.items())[:limit]
            if pid in records
        ]

    def _match_literally(self, record, query: str, matches: dict[str, list]) -> None:
        meta = record.meta
        if query in " ".join(str(meta.get(k) or "") for k in ("title", "authors", "doi", "abstract")).casefold():
            matches.setdefault(record.id, [])
        if not has_cjk(query):
            return
        for chunk in iter_paper_chunks(record.directory, meta=meta):
            if query in chunk.text.casefold():
                existing = matches.setdefault(record.id, [])
                if not any(c["chunk_id"] == chunk.chunk_id for c in existing):
                    existing.append(asdict(chunk))

    def browse(self, text: str, mode: str, limit: int, paper_ids: set[str] | None = None) -> dict:
        """Original Library search modes, scoped before ranking and limiting."""
        if mode not in MODES:
            raise InvalidRequest("Unknown search mode")
        if not text.strip() or paper_ids == set():
            return {"results": []}
        if mode == "keyword":
            return {"results": self.keyword(text, limit, paper_ids)}
        if mode == "author":
            return {"results": self._by_author(text, limit, paper_ids)}
        if mode == "semantic":
            return self._semantic(text, limit, paper_ids)
        return self._unified(text, limit, paper_ids)

    def _by_author(self, text: str, limit: int, paper_ids: set[str] | None) -> list[dict]:
        # Literal matching also supports CJK author names without FTS tokenization.
        needle = text.casefold()
        rows = [row for row in self._rows(paper_ids) if needle in row["authors"].casefold()]
        return [{"paper": row, "matches": []} for row in rows[:limit]]

    def _semantic(self, text: str, limit: int, paper_ids: set[str] | None) -> dict:
        from scholaraio.services import vectors

        cfg = self.runtime.cfg
        # Semantic search has three distinct ways of not being ready, and the
        # browser offers a different remedy for each, so say which one it is
        # rather than handing back one opaque failure.
        if vectors.embedding_provider(cfg) != "openai-compat" and not vectors.runtime_available():
            return {
                "results": [],
                "unavailable": "runtime_missing",
                "notice": "Semantic search runtime is not installed.",
            }
        if vectors.embedding_provider(cfg) == "none":
            return {
                "results": [],
                "unavailable": "provider_none",
                "notice": "Vector embeddings are disabled in the configuration.",
            }
        try:
            ranked = vectors.vsearch(text, cfg.index_db, top_k=limit, cfg=cfg, paper_ids=paper_ids)
        except (ImportError, FileNotFoundError, RuntimeError, ValueError) as error:
            return {"results": [], "unavailable": "no_vectors", "notice": f"Semantic search is unavailable: {error}"}
        return {"results": self._ranked(ranked, paper_ids), "notice": None}

    def _unified(self, text: str, limit: int, paper_ids: set[str] | None) -> dict:
        cfg = self.runtime.cfg
        ranked, diagnostics = index.unified_search(
            text, cfg.index_db, top_k=limit, cfg=cfg, paper_ids=paper_ids, return_diagnostics=True
        )
        notice = (
            "Semantic index is unavailable. Combined search is using keyword results."
            if diagnostics["vector_degraded"]
            else None
        )
        if not ranked:
            return {"results": self.keyword(text, limit, paper_ids), "notice": notice}
        return {"results": self._ranked(ranked, paper_ids), "notice": notice}

    def _ranked(self, ranked: list[dict], paper_ids: set[str] | None) -> list[dict]:
        """Rows for ranked hits, dropping any the library no longer holds."""
        rows = {row["id"]: row for row in self._rows(paper_ids)}
        return [{"paper": rows[hit["paper_id"]], "matches": []} for hit in ranked if hit["paper_id"] in rows]

    def _rows(self, paper_ids: set[str] | None) -> list[dict]:
        return [paper_row(record) for record in self.runtime.papers if paper_ids is None or record.id in paper_ids]


__all__ = ["MODES", "SearchService", "clamp_limit"]
