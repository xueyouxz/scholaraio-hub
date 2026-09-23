"""Local library operations owned by Hub, built on ScholarAIO stores and indexes."""
from __future__ import annotations

import hashlib
import json
import os
import re
import threading
import uuid
from dataclasses import asdict
from itertools import zip_longest
from pathlib import Path

from scholaraio.services.chunks import build_chunk_index, chunk_search, iter_paper_chunks
from scholaraio.services.hub_acquire import HubAcquire
from scholaraio.services.hub_citations import HubCitations
from scholaraio.services.hub_config import ensure_config
from scholaraio.services.hub_events import HubEvents, ProjectWatcher
from scholaraio.services.hub_export import HubExport
from scholaraio.services.hub_import import ImportQueue
from scholaraio.services.hub_metadata import HubMetadata
from scholaraio.services.hub_projects import HubProjects
from scholaraio.services.hub_settings import HubSettings
from scholaraio.services.hub_tasks import MaintenanceTasks
from scholaraio.services.index import build_index, search
from scholaraio.stores.papers import authors_text, find_pdf, iter_paper_dirs, read_meta


def atomic_json(path: Path, value: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(f".{path.name}.{uuid.uuid4().hex}.tmp")
    try:
        with temporary.open("x", encoding="utf-8") as output:
            temporary.chmod(0o600)
            output.write(json.dumps(value, ensure_ascii=False, indent=2))
            output.flush()
            os.fsync(output.fileno())
        temporary.replace(path)
    finally:
        temporary.unlink(missing_ok=True)


def content_hash(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as file:
        for block in iter(lambda: file.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


class HubLibrary:
    def __init__(self, root: Path):
        self.root = root.resolve()
        # Explicit root: never discover config from the code checkout or caller cwd.
        # The file is also what an agent's CLI run resolves through SCHOLARAIO_CONFIG.
        self.cfg = ensure_config(self.root)
        for directory in (self.cfg.papers_dir, self.cfg.state_root, self.cfg.inbox_dir, self.cfg.index_db.parent):
            if not directory.is_relative_to(self.root):
                raise ValueError(f"Library path is outside the application data directory: {directory}")
            directory.mkdir(parents=True, exist_ok=True)
        self.lock = threading.RLock()
        self.events = HubEvents()
        self.projects = HubProjects(self)
        self.citations = HubCitations(self)
        self.metadata = HubMetadata(self)
        self.imports = ImportQueue(self)
        self.tasks = MaintenanceTasks(self)
        self.settings = HubSettings(self)
        self.acquire = HubAcquire(self)
        self.exports = HubExport(self)
        self.watcher = ProjectWatcher(self)
        self.reindex()

    def close(self):
        self.watcher.close()
        self.imports.close()
        self.tasks.close()

    def reload_config(self):
        """Re-read the configuration after a settings change.

        Only keys, models and extraction choices are editable, so every path
        the library and its workers resolved at start-up still holds.
        """
        with self.lock:
            self.cfg = ensure_config(self.root)
            return self.cfg

    def reindex(self):
        with self.lock:
            build_index(self.cfg.papers_dir, self.cfg.index_db)
            build_chunk_index(self.cfg.papers_dir, self.cfg.index_db)

    def find(self, paper_id: str):
        for directory in iter_paper_dirs(self.cfg.papers_dir):
            meta = read_meta(directory)
            if paper_id == str(meta.get("id") or directory.name):
                return directory, meta
        raise KeyError(paper_id)

    def row(self, directory: Path, meta: dict):
        hub = meta.get("hub", {})
        images = directory / "images"
        cover = next((p for p in sorted(images.iterdir()) if p.suffix.lower() in {".png", ".jpg", ".jpeg", ".webp"}), None) if images.is_dir() else None
        return {
            "id": str(meta.get("id") or directory.name),
            "title": meta.get("title") or directory.name,
            "authors": authors_text(meta.get("authors", [])),
            "year": str(meta.get("year") or ""), "doi": meta.get("doi") or "",
            "journal": meta.get("journal") or "", "abstract": meta.get("abstract") or "",
            "hasPdf": find_pdf(directory) is not None,
            "hasMarkdown": (directory / "paper.md").exists(),
            "parseStatus": hub.get("parseStatus", "ready" if (directory / "paper.md").exists() else "pending"),
            "error": hub.get("error"),
            "coverImage": f"images/{cover.name}" if cover else None,
            "citationCount": meta.get("citation_count") if isinstance(meta.get("citation_count"), int) else None,
            "citationCounts": {key: value for key, value in meta.get("citation_count", {}).items() if isinstance(value, int)} if isinstance(meta.get("citation_count"), dict) else None,
            "paperType": meta.get("paper_type") or "",
            "metadataStatus": meta.get("metadata_status") or "complete",
            "missingMetadata": list(meta.get("missing_metadata") or []),
        }

    def analytics(self, project_id: str | None = None):
        """Read existing analysis artifacts without loading or rebuilding ML models."""
        def artifact(relative, fallback):
            path = (self.cfg.state_root / relative).resolve()
            if not path.is_relative_to(self.root):
                raise ValueError("分析数据超出应用目录")
            if not path.exists():
                return fallback
            data = json.loads(path.read_text(encoding="utf-8"))
            if not isinstance(data, dict):
                raise ValueError("分析数据格式无效")
            return data

        with self.lock:
            ids = self.projects.scope(project_id, [])
            available = set(ids) if ids is not None else {p["id"] for p in self.papers()}
            projection = artifact("projection/projection.json", {"built": False, "points": []})
            points = [p for p in projection.get("points", []) if p.get("id") in available]
            projection = {**projection, "points": points, "stale": len({p["id"] for p in points}) != len(available)}
            topics = artifact("topics/overview.json", {"built": False, "topics": []})
            if project_id:
                counts = {}
                for point in points:
                    counts[point["topicId"]] = counts.get(point["topicId"], 0) + 1
                scoped = [{**t, "paperCount": counts[t["id"]]} for t in topics.get("topics", []) if counts.get(t["id"], 0)]
                topics = {**topics, "topics": scoped, "topicCount": len(scoped)}
            similarity = artifact("topics/similarity.json", {"built": False, "topics": [], "matrix": []})
            return {"topics": topics, "projection": projection, "similarity": similarity}

    def papers(self):
        return [self.row(d, read_meta(d)) for d in iter_paper_dirs(self.cfg.papers_dir)]

    def detail(self, paper_id: str):
        directory, meta = self.find(paper_id)
        md = directory / "paper.md"
        return {**self.row(directory, meta), "markdown": md.read_text(encoding="utf-8") if md.exists() else "",
                "l3Conclusion": meta.get("l3_conclusion") if isinstance(meta.get("l3_conclusion"), str) else "",
                "chunks": [asdict(c) for c in iter_paper_chunks(directory, meta=meta)]}

    def images(self, paper_id: str):
        directory, _ = self.find(paper_id)
        images = directory / "images"
        if not images.resolve().is_relative_to(directory.resolve()) or not images.is_dir():
            return []
        return [p.name for p in sorted(images.iterdir()) if p.is_file()
                and p.resolve().is_relative_to(directory.resolve())
                and p.suffix.lower() in {".png", ".jpg", ".jpeg", ".webp", ".gif"}]

    def search(self, query: str, limit: int = 50, paper_ids: set[str] | None = None):
        if not query.strip():
            return [{"paper": paper, "matches": []} for paper in self.papers() if paper_ids is None or paper["id"] in paper_ids][:limit]
        query = " ".join(re.findall(r"\w+", query.casefold()))
        if not query:
            return []
        with self.lock:
            metadata = search(query, self.cfg.index_db, top_k=limit, paper_ids=paper_ids)
            chunks = chunk_search(query, self.cfg.index_db, top_k=limit, paper_ids=paper_ids)
        matches: dict[str, list] = {row["paper_id"]: [] for row in metadata}
        for chunk in chunks:
            matches.setdefault(chunk["paper_id"], []).append(chunk)
        # unicode61 does not segment CJK. Substring matching also covers author/DOI.
        query_lower = query.casefold()
        rows = {}
        for directory in iter_paper_dirs(self.cfg.papers_dir):
            meta = read_meta(directory)
            pid = str(meta.get("id") or directory.name)
            if paper_ids is not None and pid not in paper_ids:
                continue
            rows[pid] = (directory, meta)
            if query_lower in " ".join(str(meta.get(k) or "") for k in ("title", "authors", "doi", "abstract")).casefold():
                matches.setdefault(pid, [])
            if any('\u3400' <= c <= '\u9fff' for c in query):
                for chunk in iter_paper_chunks(directory, meta=meta):
                    if query_lower in chunk.text.casefold():
                        existing = matches.setdefault(pid, [])
                        if not any(c["chunk_id"] == chunk.chunk_id for c in existing):
                            existing.append(asdict(chunk))
        return [{"paper": self.row(*rows[pid]), "matches": parts[:3]} for pid, parts in list(matches.items())[:limit] if pid in rows]

    def browse_search(self, query: str, mode: str, limit: int, paper_ids: set[str] | None = None):
        """Original Library search modes, scoped before ranking and limiting."""
        from scholaraio.services.index import unified_search

        if mode not in {"unified", "keyword", "author", "semantic"}:
            raise ValueError("Unknown search mode")
        if not query.strip() or paper_ids == set():
            return {"results": []}
        if mode == "keyword":
            return {"results": self.search(query, limit, paper_ids)}
        notice = None
        if mode == "author":
            # Literal matching also supports CJK author names without FTS tokenization.
            results = [p for p in self.papers() if (paper_ids is None or p["id"] in paper_ids)
                       and query.casefold() in p["authors"].casefold()]
            return {"results": [{"paper": p, "matches": []} for p in results[:limit]]}
        if mode == "semantic":
            from scholaraio.services import vectors

            # Semantic search has three distinct ways of not being ready, and the
            # browser offers a different remedy for each, so say which one it is
            # rather than handing back one opaque failure.
            if not vectors.runtime_available():
                return {"results": [], "unavailable": "runtime_missing",
                        "notice": "语义检索运行时尚未安装。"}
            if vectors.embedding_provider(self.cfg) == "none":
                return {"results": [], "unavailable": "provider_none",
                        "notice": "配置中关闭了向量嵌入。"}
            try:
                ranked = vectors.vsearch(query, self.cfg.index_db, top_k=limit, cfg=self.cfg, paper_ids=paper_ids)
            except (ImportError, FileNotFoundError, RuntimeError, ValueError) as error:
                return {"results": [], "unavailable": "no_vectors",
                        "notice": f"语义检索不可用：{error}"}
        else:
            ranked, diagnostics = unified_search(query, self.cfg.index_db, top_k=limit,
                                                  cfg=self.cfg, paper_ids=paper_ids, return_diagnostics=True)
            if diagnostics["vector_degraded"]:
                notice = "语义索引暂不可用，本次综合检索使用关键词结果。"
            if not ranked:
                return {"results": self.search(query, limit, paper_ids), "notice": notice}
        rows = {p["id"]: p for p in self.papers()}
        return {"results": [{"paper": rows[r["paper_id"]], "matches": []} for r in ranked
                            if r["paper_id"] in rows and (paper_ids is None or r["paper_id"] in paper_ids)],
                "notice": notice}

    def context(self, query: str, paper_ids: list[str], project_id: str | None = None):
        scoped = self.projects.scope(project_id, paper_ids)
        if scoped == []:
            return {"citations": [], "truncated": False}
        paper_ids = scoped or []
        selected = set(paper_ids)
        results = self.search(query, 100, set(scoped) if scoped is not None else None)
        chunks = []
        seen = set()
        for result in results:
            pid = result["paper"]["id"]
            if selected and pid not in selected:
                continue
            for match in result["matches"]:
                if match["chunk_id"] not in seen:
                    seen.add(match["chunk_id"])
                    chunks.append(match)
        # Natural questions rarely match every word. Fall back to OR-ranked
        # keyword chunks, while explicit paper selection stays authoritative.
        if not chunks:
            terms = re.findall(r"[a-zA-Z][a-zA-Z0-9_-]{2,}", query.casefold())
            stopwords = {"the", "and", "what", "does", "how", "this", "that", "are", "can", "with", "from", "about", "please"}
            keywords = " ".join(term for term in terms if term not in stopwords)[:500]
            if keywords:
                with self.lock:
                    candidates = chunk_search(keywords, self.cfg.index_db, top_k=100, match_any=True, paper_ids=set(scoped) if scoped is not None else None)
                for chunk in candidates:
                    if (not selected or chunk["paper_id"] in selected) and chunk["chunk_id"] not in seen:
                        chunks.append(chunk)
                        seen.add(chunk["chunk_id"])
        # Round-robin selected papers for broad requests such as summaries.
        groups = []
        for pid in paper_ids:
            directory, meta = self.find(pid)
            groups.append(iter_paper_chunks(directory, meta=meta))
        for group in zip_longest(*groups):
            for chunk in group:
                if chunk and chunk.chunk_id not in seen:
                    chunks.append(asdict(chunk))
                    seen.add(chunk.chunk_id)
        budget = 24000
        citations = []
        truncated = False
        for chunk in chunks:
            text = chunk["text"][:min(4800, budget)]
            if not text:
                truncated = True
                break
            truncated |= len(text) < len(chunk["text"])
            citations.append({"id": f"ref-{len(citations) + 1}", "paperId": chunk["paper_id"],
                              "chunkId": chunk["chunk_id"], "title": chunk["title"],
                              "startLine": int(chunk["start_line"]), "endLine": int(chunk["end_line"]), "text": text})
            budget -= len(text)
        return {"citations": citations, "truncated": truncated}

    def list_jobs(self):
        return self.imports.list()

    def enqueue(self, files: list[tuple[Path, str]]):
        return self.imports.enqueue(files)

    def retry(self, job_id):
        return self.imports.retry(job_id)
