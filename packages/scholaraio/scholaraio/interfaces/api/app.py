"""The Hub library service as a FastAPI application."""
from __future__ import annotations

from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI

from scholaraio.hub import HubLibrary
from scholaraio.interfaces.api.errors import install_error_handlers
from scholaraio.interfaces.api.routes import ROUTERS
from scholaraio.interfaces.api.security import require_token


def create_app(root: Path, token: str) -> FastAPI:
    @asynccontextmanager
    async def lifespan(app: FastAPI):
        library = HubLibrary(root)
        app.state.library = library
        try:
            yield
        finally:
            library.close()

    app = FastAPI(title="ScholarAIO library", lifespan=lifespan)
    require_token(app, token)
    install_error_handlers(app)
    for router in ROUTERS:
        app.include_router(router)
    return app


__all__ = ["create_app"]
