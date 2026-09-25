"""The topic dashboard."""
from __future__ import annotations

from scholaraio.hub.artifacts import PROJECTION, TOPICS, AnalysisArtifacts
from scholaraio.hub.runtime import LibraryRuntime


class AnalyticsService:
    """Reads existing analysis artifacts without loading or rebuilding ML models."""

    def __init__(self, runtime: LibraryRuntime, artifacts: AnalysisArtifacts):
        self.runtime = runtime
        self.artifacts = artifacts

    def overview(self) -> dict:
        with self.runtime.lock:
            available = self.runtime.papers.ids()
            projection = self.artifacts.read(PROJECTION, {"built": False, "points": []})
            # The map was built earlier; drop papers deleted since.
            points = [p for p in projection.get("points", []) if p.get("id") in available]
            projection = {**projection, "points": points}
            topics = self.artifacts.read(TOPICS, {"built": False, "topics": []})
            return {"topics": topics, "projection": projection}


__all__ = ["AnalyticsService"]
