"""The Hub library service as a FastAPI application."""
from __future__ import annotations

from collections.abc import Callable
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI

from scholaraio.hub import HubLibrary
from scholaraio.interfaces.api.errors import install_error_handlers
from scholaraio.interfaces.api.routes import ROUTERS
from scholaraio.interfaces.api.security import AccessPolicy, install_access_policy


def create_app(
    root: Path, policy: AccessPolicy | None = None, request_restart: Callable[[], None] = lambda: None
) -> FastAPI:
    """The service for the library at ``root``; ``policy`` says who may call it,
    ``request_restart`` asks the process to exit for a restart."""
    @asynccontextmanager
    async def lifespan(app: FastAPI):
        library = HubLibrary(root, request_restart)
        app.state.library = library
        try:
            yield
        finally:
            library.close()

    app = FastAPI(title="ScholarAIO library", lifespan=lifespan)
    install_access_policy(app, policy or AccessPolicy())
    install_error_handlers(app)
    for router in ROUTERS:
        app.include_router(router)
    return app


__all__ = ["create_app"]
