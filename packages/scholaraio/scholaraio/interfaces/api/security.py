"""Only the Node server that started this process may call it.

The service listens on a loopback port chosen at start-up; the token it was
handed through the environment is the only credential it accepts.
"""
from __future__ import annotations

import hmac

from fastapi import FastAPI, Request

from scholaraio.interfaces.api.errors import error_response

TOKEN_HEADER = "x-hub-token"
TOKEN_VARIABLE = "SCHOLARAIO_HUB_INTERNAL_TOKEN"


def require_token(app: FastAPI, token: str) -> None:
    @app.middleware("http")
    async def authenticate(request: Request, call_next):
        if not token or not hmac.compare_digest(request.headers.get(TOKEN_HEADER, ""), token):
            return error_response(401, "Unauthorized")
        return await call_next(request)


__all__ = ["TOKEN_HEADER", "TOKEN_VARIABLE", "require_token"]
