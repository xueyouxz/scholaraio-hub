"""The library Hub owns: every service, wired once, with one lifecycle.

This is the composition root. Each service receives the shared runtime and the
sibling services it uses; nothing below here constructs its own collaborators
or looks them up through this object.
"""
from __future__ import annotations

from pathlib import Path

from scholaraio.hub.acquire import AcquireService
from scholaraio.hub.analytics import AnalyticsService
from scholaraio.hub.artifacts import AnalysisArtifacts
from scholaraio.hub.citations import CitationService
from scholaraio.hub.discover import DiscoverService
from scholaraio.hub.events import EventBus
from scholaraio.hub.exports import ExportService
from scholaraio.hub.imports import ImportQueue
from scholaraio.hub.maintenance import MaintenanceJobs
from scholaraio.hub.metadata import MetadataService
from scholaraio.hub.papers import PaperService
from scholaraio.hub.projects import ProjectService
from scholaraio.hub.retrieval import RetrievalService
from scholaraio.hub.runtime import LibraryRuntime
from scholaraio.hub.search import SearchService
from scholaraio.hub.settings import SettingsService
from scholaraio.hub.status import LibraryStatus
from scholaraio.hub.tasks import TaskRunner
from scholaraio.hub.watcher import ProjectWatcher


class HubLibrary:
    def __init__(self, root: Path):
        self.runtime = runtime = LibraryRuntime(root)
        artifacts = AnalysisArtifacts(runtime.cfg.state_root, runtime.root)
        tasks_root = runtime.cfg.state_root / "tasks"

        # Queries and edits, answered on the request thread.
        self.projects = ProjectService(runtime)
        self.papers = PaperService(runtime)
        self.search = SearchService(runtime, self.projects)
        self.retrieval = RetrievalService(runtime, self.projects, self.search)
        self.analytics = AnalyticsService(runtime, artifacts)
        self.citations = CitationService(runtime, self.projects)
        self.metadata = MetadataService(runtime)
        self.exports = ExportService(runtime, self.projects)
        self.settings = SettingsService(runtime)
        self.discover = DiscoverService(runtime)

        # Background work, each on its own single worker thread.
        self.imports = ImportQueue(runtime, self.projects)
        self.acquire = AcquireService(runtime, self.imports)
        jobs = MaintenanceJobs(runtime, artifacts, model_dir=tasks_root / "topic-model")
        self.tasks = TaskRunner(runtime, jobs.registry(), root=tasks_root, lanes=jobs.lanes())
        self.status = LibraryStatus(runtime, self.tasks, artifacts)
        self.watcher = ProjectWatcher(self.projects.root, runtime.events)

        runtime.reindex()

    def close(self) -> None:
        self.watcher.close()
        self.imports.close()
        self.tasks.close()

    @property
    def events(self) -> EventBus:
        """The bus the ``/events`` stream subscribes to."""
        return self.runtime.events


__all__ = ["HubLibrary"]
