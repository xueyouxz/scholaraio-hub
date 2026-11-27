"""What the library can do right now."""
from __future__ import annotations

from scholaraio.hub.artifacts import AnalysisArtifacts
from scholaraio.hub.maintenance import has_abstract, needs_deep
from scholaraio.hub.runtime import LibraryRuntime
from scholaraio.hub.tasks import TaskRunner


class LibraryStatus:
    def __init__(self, runtime: LibraryRuntime, tasks: TaskRunner, artifacts: AnalysisArtifacts):
        self.runtime = runtime
        self.tasks = tasks
        self.artifacts = artifacts

    def readiness(self) -> dict:
        """What the library can do right now, and what it would take to do more."""
        from scholaraio.services import vectors

        cfg = self.runtime.cfg
        with self.runtime.lock:
            directories = self.runtime.papers.directories()
            vector_count = vectors.vector_count(cfg.index_db)
            return {
                "papers": len(directories),
                "vectors": vector_count,
                "embedProvider": vectors.embedding_provider(cfg),
                "embedModel": cfg.embed.model,
                "modelReady": vectors.model_available(cfg),
                "vectorRuntimeReady": vectors.runtime_available(),
                "semanticReady": vector_count > 0 and vectors.index_matches_config(cfg.index_db, cfg),
                "topicsBuilt": self.artifacts.topics_built(),
                # How many papers the stored map places; fewer than papers means it is behind.
                "mappedPapers": self.artifacts.mapped_count(),
                "deepPending": sum(1 for directory in directories if needs_deep(directory)),
                "missingAbstracts": sum(1 for directory in directories if not has_abstract(directory)),
                "llmConfigured": bool(cfg.resolved_api_key()),
                "mineruConfigured": bool(cfg.resolved_mineru_api_key()),
                "tasks": self.tasks.list(),
            }


__all__ = ["LibraryStatus"]
