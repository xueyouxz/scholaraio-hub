"""Finding papers the library does not hold yet, by searching the open web.

The browser types a topic, a title or an author; this asks OpenAlex and arXiv
at the same time and answers with one list. Every result carries the locator
the import queue already understands (a DOI, an arXiv id or an open-access
link), so adding a result is the same fetch a pasted identifier would start.
"""
from __future__ import annotations

import logging
import re
from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor

from scholaraio.hub.errors import InvalidRequest
from scholaraio.hub.imports import lookups_disabled
from scholaraio.hub.runtime import LibraryRuntime

_log = logging.getLogger("scholaraio.hub.discover")

OPENALEX_WORKS = "https://api.openalex.org/works"
MAX_LIMIT = 30
TIMEOUT_SECONDS = 12
QUERY_LIMIT = 300
SOURCE_NAMES = {"openalex": "OpenAlex", "arxiv": "arXiv"}


def normalize_doi(doi: str) -> str:
    text = (doi or "").strip().lower()
    return re.sub(r"^(?:https?://(?:dx\.)?doi\.org/|doi:)", "", text)


class DiscoverService:
    def __init__(self, runtime: LibraryRuntime):
        self.runtime = runtime

    def search(self, text: str, *, limit: int = 20) -> dict:
        """Search the web sources together; one failing does not hide the other."""
        query = " ".join(text.split())
        if not query:
            return {"results": [], "errors": []}
        if len(query) > QUERY_LIMIT:
            raise InvalidRequest(f"检索词不能超过 {QUERY_LIMIT} 个字符")
        if lookups_disabled():
            return {"results": [], "errors": [{"source": "web", "error": "当前实例关闭了外部检索"}]}
        limit = min(max(limit, 1), MAX_LIMIT)
        sources: dict[str, Callable[[str, int], list[dict]]] = {
            "openalex": self.openalex,
            "arxiv": self.arxiv,
        }
        results: list[dict] = []
        errors: list[dict] = []
        with ThreadPoolExecutor(max_workers=len(sources), thread_name_prefix="discover") as pool:
            futures = {name: pool.submit(run, query, limit) for name, run in sources.items()}
            for name, future in futures.items():
                try:
                    results.extend(future.result())
                except Exception as error:  # a source being down is reported, not raised
                    _log.warning("web search via %s failed: %s", name, error)
                    errors.append({"source": SOURCE_NAMES[name], "error": str(error) or type(error).__name__})
        return {"results": self.mark_held(merge(results))[: limit * 2], "errors": errors}

    def openalex(self, query: str, limit: int) -> list[dict]:
        import requests

        params: dict[str, str | int] = {
            "search": query,
            "per_page": limit,
            "select": "id,title,publication_year,doi,authorships,primary_location,open_access,cited_by_count",
        }
        api_key = (self.runtime.cfg.openalex.api_key or "").strip()
        if api_key:
            params["api_key"] = api_key
        response = requests.get(OPENALEX_WORKS, params=params, timeout=TIMEOUT_SECONDS)
        response.raise_for_status()
        return [row for item in response.json().get("results", []) if (row := openalex_row(item))]

    def arxiv(self, query: str, limit: int) -> list[dict]:
        from scholaraio.providers.arxiv import search_arxiv

        return [row for item in search_arxiv(query, top_k=limit) if (row := arxiv_row(item))]

    def mark_held(self, rows: list[dict]) -> list[dict]:
        """Say which results the library already holds, so they are not fetched twice."""
        held_doi: dict[str, str] = {}
        held_arxiv: dict[str, str] = {}
        for record in self.runtime.papers:
            doi = normalize_doi(str(record.meta.get("doi") or ""))
            if doi:
                held_doi[doi] = record.id
            arxiv = str((record.meta.get("ids") or {}).get("arxiv") or record.meta.get("arxiv_id") or "")
            if arxiv:
                held_arxiv[arxiv.split("v")[0]] = record.id
        for row in rows:
            row["paperId"] = held_doi.get(row["doi"]) or held_arxiv.get(row["arxivId"].split("v")[0]) or None
        return rows


def openalex_row(item: dict) -> dict | None:
    title = re.sub(r"<[^>]+>", "", item.get("title") or "").strip()
    doi = normalize_doi(item.get("doi") or "")
    access = item.get("open_access") or {}
    location = item.get("primary_location") or {}
    source = location.get("source") or {}
    arxiv = ""
    match = re.match(r"10\.48550/arxiv\.(.+)$", doi)
    if match:
        arxiv = match.group(1)
    # A DOI is the locator the fetcher resolves best; an open-access link is
    # the fallback for works that have none.
    locator = doi or access.get("oa_url") or location.get("pdf_url") or ""
    if not title or not locator:
        return None
    return {
        "id": item.get("id") or locator,
        "title": title,
        "authors": [
            name for a in item.get("authorships") or [] if (name := (a.get("author") or {}).get("display_name"))
        ],
        "year": item.get("publication_year"),
        "venue": source.get("display_name") or "",
        "doi": doi,
        "arxivId": arxiv,
        "locator": locator,
        "openAccess": bool(access.get("is_oa")),
        "citations": item.get("cited_by_count"),
        "source": "openalex",
    }


def arxiv_row(item: dict) -> dict | None:
    identifier = (item.get("arxiv_id") or "").strip()
    title = " ".join((item.get("title") or "").split())
    if not identifier or not title:
        return None
    authors = item.get("authors") or []
    return {
        "id": f"arxiv:{identifier}",
        "title": title,
        "authors": authors if isinstance(authors, list) else [str(authors)],
        "year": int(item["year"]) if str(item.get("year") or "").isdigit() else None,
        "venue": "arXiv",
        "doi": normalize_doi(item.get("doi") or ""),
        "arxivId": identifier,
        "locator": f"arXiv:{identifier}",
        "openAccess": True,
        "citations": None,
        "source": "arxiv",
    }


def merge(rows: list[dict]) -> list[dict]:
    """One row per work, interleaving the sources so neither buries the other.

    arXiv's copy of a preprint wins over OpenAlex's: it always has a PDF.
    """
    by_source: dict[str, list[dict]] = {}
    for row in rows:
        by_source.setdefault(row["source"], []).append(row)
    ordered: list[dict] = []
    queues = [by_source.get("arxiv", []), by_source.get("openalex", [])]
    while any(queues):
        for queue in queues:
            if queue:
                ordered.append(queue.pop(0))
    seen: dict[str, dict] = {}
    merged: list[dict] = []
    for row in ordered:
        keys = [key for key in (row["doi"], row["arxivId"].split("v")[0] if row["arxivId"] else "") if key]
        keys.append(re.sub(r"\W+", "", row["title"].casefold()))
        if any(key in seen for key in keys):
            continue
        for key in keys:
            seen[key] = row
        merged.append(row)
    return merged


__all__ = ["DiscoverService", "merge", "normalize_doi"]
