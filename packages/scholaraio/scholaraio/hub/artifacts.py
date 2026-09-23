"""The topic map files the dashboard reads.

Building topics costs minutes of model time, so the topics task writes its
results here once and the dashboard only ever reads them. Both sides use the
paths below; nothing else knows where the files live.
"""
from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from scholaraio.hub.errors import InvalidRequest
from scholaraio.hub.storage import atomic_json

TOPICS = "topics/overview.json"
PROJECTION = "projection/projection.json"
SIMILARITY = "topics/similarity.json"


class AnalysisArtifacts:
    def __init__(self, state_root: Path, app_root: Path):
        self.state_root = state_root
        self.app_root = app_root

    def path(self, relative: str) -> Path:
        path = (self.state_root / relative).resolve()
        if not path.is_relative_to(self.app_root):
            raise InvalidRequest("分析数据超出应用目录")
        return path

    def topics_built(self) -> bool:
        return self.path(TOPICS).exists()

    def read(self, relative: str, fallback: dict[str, Any]) -> dict[str, Any]:
        """The stored artifact, or ``fallback`` when it was never built."""
        path = self.path(relative)
        if not path.exists():
            return fallback
        data = json.loads(path.read_text(encoding="utf-8"))
        if not isinstance(data, dict):
            # Exists but unreadable: a storage fault, not an empty result.
            raise RuntimeError(f"分析数据格式无效：{path}")
        return data

    def write(self, model) -> int:
        """Store what the dashboard needs from a fitted topic model; returns the topic count."""
        from scholaraio.services.topics import get_topic_overview

        stamp = datetime.now(timezone.utc).isoformat(timespec="seconds")
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
            self.path(TOPICS),
            {"built": True, "topicCount": len(topics), "topics": topics, "computedAt": stamp},
        )
        atomic_json(
            self.path(PROJECTION),
            {"built": True, "vectorCount": len(points), "points": points, "computedAt": stamp},
        )
        atomic_json(
            self.path(SIMILARITY),
            {
                "built": True,
                "topicCount": len(topics),
                "topics": topics,
                "matrix": topic_similarity(model, [topic["id"] for topic in topics]),
                "computedAt": stamp,
            },
        )
        return len(topics)


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


__all__ = ["PROJECTION", "SIMILARITY", "TOPICS", "AnalysisArtifacts"]
