"""The library Hub owns: every service, wired once, with one lifecycle.

This is the composition root. Each service receives the shared runtime and the
sibling services it uses; nothing below here constructs its own collaborators
or looks them up through this object.
"""
from __future__ import annotations

from collections.abc import Callable
from pathlib import Path

from scholaraio.hub.acquire import AcquireService
from scholaraio.hub.analytics import AnalyticsService
from scholaraio.hub.artifacts import AnalysisArtifacts
from scholaraio.hub.bundles import BundleService
from scholaraio.hub.citations import CitationService
from scholaraio.hub.collections import CollectionService
from scholaraio.hub.directories import DirectoryService
from scholaraio.hub.discover import DiscoverService
from scholaraio.hub.events import EventBus
from scholaraio.hub.exports import ExportService
from scholaraio.hub.imports import ImportQueue
from scholaraio.hub.library_reader import LibraryReader
from scholaraio.hub.maintenance import MaintenanceJobs
from scholaraio.hub.metadata import MetadataService
from scholaraio.hub.papers import PaperService
from scholaraio.hub.retrieval import RetrievalService
from scholaraio.hub.runtime import LibraryRuntime
from scholaraio.hub.runtime_install import RuntimeInstaller
from scholaraio.hub.search import SearchService
from scholaraio.hub.settings import SettingsService
from scholaraio.hub.status import LibraryStatus
from scholaraio.hub.tasks import TaskRunner
from scholaraio.hub.watcher import CollectionWatcher


class HubLibrary:
    def __init__(self, root: Path, request_restart: Callable[[], None] = lambda: None):
        """``request_restart`` asks whoever runs the library for a new process."""
        self.runtime = runtime = LibraryRuntime(root)
        artifacts = AnalysisArtifacts(runtime.cfg.state_root, runtime.root)
        tasks_root = runtime.cfg.state_root / "tasks"

        # Queries and edits, answered on the request thread.
        self.collections = CollectionService(runtime)
        self.papers = PaperService(runtime)
        self.search = SearchService(runtime, self.collections)
        self.retrieval = RetrievalService(runtime, self.collections, self.search)
        self.reader = LibraryReader(runtime, self.collections, self.search, self.retrieval)
        self.analytics = AnalyticsService(runtime, artifacts)
        self.citations = CitationService(runtime, self.collections)
        self.metadata = MetadataService(runtime)
        self.bundles = BundleService(runtime)
        self.exports = ExportService(runtime, self.collections)
        self.settings = SettingsService(runtime)
        self.discover = DiscoverService(runtime)
        self.directories = DirectoryService(runtime)
        self.installer = RuntimeInstaller(runtime, request_restart)

        # Background work, each on its own single worker thread.
        self.imports = ImportQueue(runtime, self.collections)
        self.acquire = AcquireService(runtime, self.imports)
        jobs = MaintenanceJobs(runtime, artifacts, model_dir=tasks_root / "topic-model")
        self.tasks = TaskRunner(runtime, jobs.registry(), root=tasks_root, lanes=jobs.lanes())
        self.status = LibraryStatus(runtime, self.tasks, artifacts)
        self.watcher = CollectionWatcher(self.collections.root, runtime.events)

        runtime.reindex()

    def close(self) -> None:
        self.installer.close()
        self.watcher.close()
        self.imports.close()
        self.tasks.close()

    @property
    def events(self) -> EventBus:
        """The bus the ``/events`` stream subscribes to."""
        return self.runtime.events


__all__ = ["HubLibrary"]
