"""The topic dashboard, cut to the papers the user is looking at."""
from __future__ import annotations

from collections import Counter

from scholaraio.hub.artifacts import PROJECTION, SIMILARITY, TOPICS, AnalysisArtifacts
from scholaraio.hub.projects import ProjectService
from scholaraio.hub.runtime import LibraryRuntime


class AnalyticsService:
    """Reads existing analysis artifacts without loading or rebuilding ML models."""

    def __init__(self, runtime: LibraryRuntime, projects: ProjectService, artifacts: AnalysisArtifacts):
        self.runtime = runtime
        self.projects = projects
        self.artifacts = artifacts

    def overview(self, project_id: str | None = None) -> dict:
        with self.runtime.lock:
            ids = self.projects.scope(project_id, [])
            available = set(ids) if ids is not None else self.runtime.papers.ids()
            projection = self.artifacts.read(PROJECTION, {"built": False, "points": []})
            points = [p for p in projection.get("points", []) if p.get("id") in available]
            projection = {**projection, "points": points, "stale": len({p["id"] for p in points}) != len(available)}
            topics = self.artifacts.read(TOPICS, {"built": False, "topics": []})
            if project_id:
                counts = Counter(point["topicId"] for point in points)
                scoped = [{**t, "paperCount": counts[t["id"]]} for t in topics.get("topics", []) if counts[t["id"]]]
                topics = {**topics, "topics": scoped, "topicCount": len(scoped)}
            similarity = self.artifacts.read(SIMILARITY, {"built": False, "topics": [], "matrix": []})
            return {"topics": topics, "projection": projection, "similarity": similarity}


__all__ = ["AnalyticsService"]
