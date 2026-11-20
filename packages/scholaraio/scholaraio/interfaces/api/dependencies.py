"""Services a route may ask for, resolved from the library the app started.

Routes declare the one service they use (``papers: Papers``) instead of reaching
into ``app.state``. Every service resolves through :func:`library`, so
``app.dependency_overrides[library]`` swaps them all at once.
"""
from __future__ import annotations

from typing import Annotated

from fastapi import Depends, Request

from scholaraio.hub import HubLibrary
from scholaraio.hub.acquire import AcquireService
from scholaraio.hub.analytics import AnalyticsService
from scholaraio.hub.bundles import BundleService
from scholaraio.hub.citations import CitationService
from scholaraio.hub.collections import CollectionService
from scholaraio.hub.directories import DirectoryService
from scholaraio.hub.discover import DiscoverService
from scholaraio.hub.events import EventBus
from scholaraio.hub.exports import ExportService
from scholaraio.hub.imports import ImportQueue
from scholaraio.hub.metadata import MetadataService
from scholaraio.hub.papers import PaperService
from scholaraio.hub.retrieval import RetrievalService
from scholaraio.hub.runtime_install import RuntimeInstaller
from scholaraio.hub.search import SearchService
from scholaraio.hub.settings import SettingsService
from scholaraio.hub.status import LibraryStatus
from scholaraio.hub.tasks import TaskRunner


def library(request: Request) -> HubLibrary:
    return request.app.state.library


Library = Annotated[HubLibrary, Depends(library)]


def _service(name: str):
    def resolve(library: Library):
        return getattr(library, name)

    resolve.__name__ = f"get_{name}"
    return Depends(resolve)


Acquire = Annotated[AcquireService, _service("acquire")]
Analytics = Annotated[AnalyticsService, _service("analytics")]
Bundles = Annotated[BundleService, _service("bundles")]
Citations = Annotated[CitationService, _service("citations")]
Collections = Annotated[CollectionService, _service("collections")]
Directories = Annotated[DirectoryService, _service("directories")]
Discover = Annotated[DiscoverService, _service("discover")]
Events = Annotated[EventBus, _service("events")]
Exports = Annotated[ExportService, _service("exports")]
Imports = Annotated[ImportQueue, _service("imports")]
Installer = Annotated[RuntimeInstaller, _service("installer")]
Metadata = Annotated[MetadataService, _service("metadata")]
Papers = Annotated[PaperService, _service("papers")]
Retrieval = Annotated[RetrievalService, _service("retrieval")]
Search = Annotated[SearchService, _service("search")]
Settings = Annotated[SettingsService, _service("settings")]
Status = Annotated[LibraryStatus, _service("status")]
Tasks = Annotated[TaskRunner, _service("tasks")]
