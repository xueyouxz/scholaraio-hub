"""How failures reach the caller: always ``{"error": message}`` with a status.

Hub services raise :class:`~scholaraio.hub.errors.HubError` subclasses, which
carry their own status. The upstream stores keep their own convention, honoured
here: ``ValueError`` for a request they refuse, ``RuntimeError`` for data on disk
they cannot read. Anything else is a bug and stays a plain 500.
"""
from __future__ import annotations

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

from scholaraio.hub.errors import HubError


def error_response(status_code: int, message: str) -> JSONResponse:
    return JSONResponse({"error": message}, status_code=status_code)


def install_error_handlers(app: FastAPI) -> None:
    @app.exception_handler(HubError)
    async def hub_error(_request: Request, exc: HubError):
        return error_response(exc.status_code, str(exc))

    @app.exception_handler(ValueError)
    async def refused(_request: Request, exc: ValueError):
        return error_response(400, str(exc))

    @app.exception_handler(RuntimeError)
    async def unreadable(_request: Request, exc: RuntimeError):
        return error_response(500, str(exc))


__all__ = ["error_response", "install_error_handlers"]
