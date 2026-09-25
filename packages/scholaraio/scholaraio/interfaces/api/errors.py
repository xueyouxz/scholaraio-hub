"""How failures reach the caller: always ``{"error": message}`` with a status.

Hub services raise :class:`~scholaraio.hub.errors.HubError` subclasses, which
carry their own status. The upstream stores keep their own convention, honoured
here: ``ValueError`` for a request they refuse, ``RuntimeError`` for data on disk
they cannot read. Anything else is a bug and stays a plain 500.

Every failure the caller did not cause is logged with its traceback; a builtin
``ValueError`` is logged too, since one raised by a bug looks just like a refusal.
"""
from __future__ import annotations

import logging

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

from scholaraio.hub.errors import HubError

_log = logging.getLogger("scholaraio.api")


def error_response(status_code: int, message: str) -> JSONResponse:
    return JSONResponse({"error": message}, status_code=status_code)


def _where(request: Request) -> str:
    return f"{request.method} {request.url.path}"


def install_error_handlers(app: FastAPI) -> None:
    @app.exception_handler(HubError)
    async def hub_error(request: Request, exc: HubError):
        if exc.status_code >= 500:
            _log.error("%s failed", _where(request), exc_info=exc)
        return error_response(exc.status_code, str(exc))

    @app.exception_handler(RequestValidationError)
    async def invalid(_request: Request, exc: RequestValidationError):
        fields = "; ".join(
            f"{'.'.join(str(part) for part in error['loc'][1:])}: {error['msg']}" for error in exc.errors()
        )
        return error_response(422, fields or "请求参数无效")

    @app.exception_handler(ValueError)
    async def refused(request: Request, exc: ValueError):
        _log.warning("%s refused with a builtin ValueError", _where(request), exc_info=exc)
        return error_response(400, str(exc))

    @app.exception_handler(RuntimeError)
    async def unreadable(request: Request, exc: RuntimeError):
        _log.error("%s failed", _where(request), exc_info=exc)
        return error_response(500, str(exc))

    # Starlette re-raises after this answer, and uvicorn logs the traceback.
    @app.exception_handler(Exception)
    async def unexpected(_request: Request, _exc: Exception):
        return error_response(500, "文献服务内部错误，详见服务日志。")


__all__ = ["error_response", "install_error_handlers"]
