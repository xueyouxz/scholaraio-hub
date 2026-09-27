"""The Hub library service as a FastAPI application."""
from __future__ import annotations

from collections.abc import Callable
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI

from scholaraio.hub import HubLibrary
from scholaraio.interfaces.api.errors import ERROR_RESPONSES, RequestContext, install_error_handlers
from scholaraio.interfaces.api.routes import ROUTERS
from scholaraio.interfaces.api.security import AccessPolicy, install_access_policy


def create_app(
    root: Path, policy: AccessPolicy | None = None, request_restart: Callable[[], None] = lambda: None
) -> FastAPI:
    """创建文献服务，装配资源生命周期、访问策略和领域路由。"""
    @asynccontextmanager
    async def lifespan(app: FastAPI):
        library = HubLibrary(root, request_restart)
        app.state.library = library
        try:
            yield
        finally:
            library.close()

    app = FastAPI(title="ScholarAIO library", lifespan=lifespan, responses=ERROR_RESPONSES)
    install_access_policy(app, policy or AccessPolicy())
    app.add_middleware(RequestContext)
    install_error_handlers(app)
    for router in ROUTERS:
        app.include_router(router)
    return app


__all__ = ["create_app"]
