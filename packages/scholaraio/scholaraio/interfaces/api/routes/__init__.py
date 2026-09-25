"""HTTP routes, one module per library domain. Each only translates a request
into a service call; the work happens in :mod:`scholaraio.hub`."""
from __future__ import annotations

from scholaraio.interfaces.api.routes import (
    analytics,
    citations,
    directories,
    imports,
    papers,
    projects,
    search,
    settings,
    system,
    tasks,
)

ROUTERS = [
    system.router,
    papers.router,
    search.router,
    analytics.router,
    citations.router,
    projects.router,
    imports.router,
    tasks.router,
    settings.router,
    directories.router,
]

__all__ = ["ROUTERS"]
