"""Long-running library work the browser starts, watches and stops.

Importing a paper makes it searchable by keyword straight away. Semantic
search, the topic map and LLM-written summaries each cost minutes of model
time, so they run here as named tasks with progress and a stop button rather
than inside an import. One task runs at a time; each kind keeps its last run.
"""
from __future__ import annotations

import json
import threading
import uuid
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from pathlib import Path

from scholaraio.stores.papers import iter_paper_dirs, read_meta

KINDS = ("semantic", "topics", "deep")
ACTIVE = ("queued", "running")


def now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def needs_deep(directory: Path) -> bool:
    """Whether this paper still lacks the LLM-written table of contents or conclusion."""
    if not (directory / "paper.md").exists():
        return False
    meta = read_meta(directory)
    return not meta.get("toc") or not (meta.get("l3_conclusion") or "").strip()


class MaintenanceTasks:
    """Serial runner for the library's optional, expensive work."""

    def __init__(self, library):
        self.library = library
        self.root = library.cfg.state_root / "tasks"
        self.root.mkdir(parents=True, exist_ok=True)
        self.executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="library-task")
        self.stops: dict[str, threading.Event] = {}
        self.tasks: dict[str, dict] = {}
        for kind in KINDS:
            path = self.root / f"{kind}.json"
            if not path.exists():
                continue
            record = json.loads(path.read_text(encoding="utf-8"))
            if record.get("status") in ACTIVE:
                # The process that was running it is gone; the work is restartable.
                record.update(status="failed", error="任务被中断，可重新开始", phase=None, finishedAt=now())
            self.tasks[kind] = record

    def close(self) -> None:
        for stop in self.stops.values():
            stop.set()
        self.executor.shutdown(wait=True, cancel_futures=True)

    # ---- records -------------------------------------------------------

    def save(self, record: dict) -> None:
        from scholaraio.services.hub_library import atomic_json

        atomic_json(self.root / f'{record["kind"]}.json', record)

    def update(self, record: dict, **fields) -> None:
        with self.library.lock:
            record.update(fields)
            self.save(record)

    def list(self) -> list[dict]:
        with self.library.lock:
            return [dict(self.tasks[kind]) for kind in KINDS if kind in self.tasks]

    def start(self, kind: str) -> dict:
        if kind not in KINDS:
            raise ValueError(f"未知的任务类型：{kind}")
        with self.library.lock:
            current = self.tasks.get(kind)
            if current and current["status"] in ACTIVE:
                raise ValueError("该任务已在运行")
            stop = threading.Event()
            self.stops[kind] = stop
            record = {
                "id": uuid.uuid4().hex,
                "kind": kind,
                "status": "queued",
                "phase": None,
                "done": 0,
                "total": 0,
                "summary": None,
                "error": None,
                "startedAt": now(),
                "finishedAt": None,
            }
            self.tasks[kind] = record
            self.save(record)
            self.executor.submit(self.run, kind, record, stop)
            return dict(record)

    def cancel(self, kind: str) -> dict:
        with self.library.lock:
            record = self.tasks.get(kind)
            if not record or record["status"] not in ACTIVE:
                raise ValueError("该任务没有在运行")
            self.stops[kind].set()
            record["phase"] = "stopping"
            self.save(record)
            return dict(record)

    # ---- execution -----------------------------------------------------

    def run(self, kind: str, record: dict, stop: threading.Event) -> None:
        runner = {"semantic": self.run_semantic, "topics": self.run_topics, "deep": self.run_deep}[kind]
        self.update(record, status="running", phase="preparing", error=None)
        try:
            summary = runner(record, stop)
        except Exception as exc:  # the browser shows the reason and offers a restart
            self.update(record, status="failed", phase=None, error=str(exc), finishedAt=now())
            return
        self.update(
            record,
            status="cancelled" if stop.is_set() else "completed",
            phase=None,
            summary=summary,
            error=None,
            finishedAt=now(),
        )

    def run_semantic(self, record: dict, stop: threading.Event) -> str:
        """Make semantic search usable: fetch the model, then embed every paper."""
        from scholaraio.services import vectors

        cfg = self.library.cfg
        if vectors.embedding_provider(cfg) == "none":
            raise ValueError("当前配置关闭了向量嵌入（embed.provider=none）")
        self.update(record, phase="model")
        vectors.prepare_model(cfg)
        if stop.is_set():
            return "已在下载模型后停止"
        self.update(record, phase="embed")
        count = vectors.build_vectors(
            cfg.papers_dir,
            cfg.index_db,
            cfg=cfg,
            on_progress=lambda done, total: self.update(record, done=done, total=total),
            should_stop=stop.is_set,
        )
        return f"新增 {count} 篇论文的向量"

    def run_topics(self, record: dict, stop: threading.Event) -> str:
        """Cluster the existing vectors into topics and write what the dashboard reads."""
        from scholaraio.services.topics import build_topics

        cfg = self.library.cfg
        self.update(record, phase="cluster")
        model = build_topics(cfg.index_db, cfg.papers_dir, cfg=cfg, save_path=self.root / "topic-model")
        if stop.is_set():
            return "已在建模后停止"
        self.update(record, phase="artifacts")
        count = self.write_topic_artifacts(model)
        return f"{count} 个主题"

    def run_deep(self, record: dict, stop: threading.Event) -> str:
        """Ask the LLM for a table of contents and a conclusion, paper by paper."""
        from scholaraio.services.ingest import steps
        from scholaraio.services.ingest.types import StepResult

        cfg = self.library.cfg
        if not cfg.resolved_api_key():
            raise ValueError("深度解析需要先配置 LLM API Key")
        pending = [directory for directory in iter_paper_dirs(cfg.papers_dir) if needs_deep(directory)]
        self.update(record, phase="deep", done=0, total=len(pending))
        done = 0
        failed = 0
        for directory in pending:
            if stop.is_set():
                break
            meta_path = directory / "meta.json"
            results = [steps.step_toc(meta_path, cfg, {}), steps.step_l3(meta_path, cfg, {})]
            failed += 1 if any(result == StepResult.FAIL for result in results) else 0
            done += 1
            self.update(record, done=done)
        if done:
            self.library.reindex()
        return f"处理 {done} 篇" + (f"，其中 {failed} 篇未能完成" if failed else "")

    # ---- topic artifacts ----------------------------------------------

    def write_topic_artifacts(self, model) -> int:
        from scholaraio.services.hub_library import atomic_json
        from scholaraio.services.topics import get_topic_overview

        state = self.library.cfg.state_root
        stamp = now()
        topics = [
            {
                "id": int(topic["topic_id"]),
                "name": topic["name"],
                "keywords": topic["keywords"],
                "paperCount": int(topic["count"]),
            }
            for topic in get_topic_overview(model)
        ]
        points = projection_points(model)
        atomic_json(
            state / "topics/overview.json",
            {"built": True, "topicCount": len(topics), "topics": topics, "computedAt": stamp},
        )
        atomic_json(
            state / "projection/projection.json",
            {"built": True, "vectorCount": len(points), "points": points, "computedAt": stamp},
        )
        atomic_json(
            state / "topics/similarity.json",
            {
                "built": True,
                "topicCount": len(topics),
                "topics": topics,
                "matrix": topic_similarity(model, [topic["id"] for topic in topics]),
                "computedAt": stamp,
            },
        )
        return len(topics)

    # ---- readiness -----------------------------------------------------

    def status(self) -> dict:
        """What the library can do right now, and what it would take to do more."""
        from scholaraio.services import vectors

        cfg = self.library.cfg
        with self.library.lock:
            directories = list(iter_paper_dirs(cfg.papers_dir))
            vector_count = vectors.vector_count(cfg.index_db)
            topics_built = (cfg.state_root / "topics/overview.json").exists()
            return {
                "papers": len(directories),
                "vectors": vector_count,
                "embedProvider": vectors.embedding_provider(cfg),
                "embedModel": cfg.embed.model,
                "modelReady": vectors.model_available(cfg),
                "semanticReady": vector_count > 0,
                "topicsBuilt": topics_built,
                "deepPending": sum(1 for directory in directories if needs_deep(directory)),
                "llmConfigured": bool(cfg.resolved_api_key()),
                "mineruConfigured": bool(cfg.resolved_mineru_api_key()),
                "tasks": self.list(),
            }


def projection_points(model) -> list[dict]:
    """Place every embedded paper on a 2-D map, so the dashboard can plot it."""
    paper_ids = list(getattr(model, "_paper_ids", []))
    metas = list(getattr(model, "_metas", []))
    assigned = list(getattr(model, "_topics", []))
    embeddings = getattr(model, "_embeddings", None)
    if not paper_ids or embeddings is None:
        return []
    if len(paper_ids) < 4:
        # UMAP needs neighbours; a handful of papers is not a map.
        coordinates = [(0.0, 0.0)] * len(paper_ids)
    else:
        from umap import UMAP

        reducer = UMAP(
            n_components=2,
            n_neighbors=min(15, len(paper_ids) - 1),
            metric="cosine",
            random_state=42,
        )
        coordinates = [(float(x), float(y)) for x, y in reducer.fit_transform(embeddings)]
    points = []
    for index, paper_id in enumerate(paper_ids):
        meta = metas[index] if index < len(metas) else {}
        year = meta.get("year")
        points.append(
            {
                "id": paper_id,
                "x": coordinates[index][0],
                "y": coordinates[index][1],
                "topicId": int(assigned[index]) if index < len(assigned) else -1,
                "year": int(year) if isinstance(year, int) or str(year or "").isdigit() else 0,
                "title": meta.get("title") or "",
            }
        )
    return points


def topic_similarity(model, topic_ids: list[int]) -> list[list[float]]:
    """Cosine similarity between topic centres, averaged from member vectors.

    Averaging the papers themselves keeps this independent of how BERTopic
    happens to order its own topic embeddings.
    """
    import numpy as np

    embeddings = getattr(model, "_embeddings", None)
    assigned = list(getattr(model, "_topics", []))
    if embeddings is None or not topic_ids:
        return []
    centres = []
    for topic_id in topic_ids:
        members = [embeddings[i] for i, topic in enumerate(assigned) if int(topic) == topic_id]
        centres.append(np.mean(members, axis=0) if members else np.zeros(embeddings.shape[1]))
    matrix = np.array(centres, dtype="float32")
    norms = np.linalg.norm(matrix, axis=1, keepdims=True)
    matrix = matrix / np.where(norms == 0, 1, norms)
    return [[round(float(value), 4) for value in row] for row in matrix @ matrix.T]


__all__ = ["KINDS", "MaintenanceTasks"]
