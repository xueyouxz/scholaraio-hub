"""统一请求标识、成功响应与异常到 HTTP 响应的转换。"""

from __future__ import annotations

import logging
from uuid import uuid4

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException
from starlette.types import ASGIApp, Receive, Scope, Send

from scholaraio.hub.errors import HubError
from scholaraio.interfaces.api.responses import ApiFailure

_log = logging.getLogger("scholaraio.api")
STATUS_CODES = {
    400: "INVALID_JSON",
    403: "CSRF_REJECTED",
    404: "RESOURCE_NOT_FOUND",
    405: "METHOD_NOT_ALLOWED",
    409: "STATE_CONFLICT",
    413: "PAYLOAD_TOO_LARGE",
    415: "UNSUPPORTED_MEDIA_TYPE",
    422: "VALIDATION_FAILED",
    429: "RATE_LIMITED",
    500: "INTERNAL_ERROR",
    502: "UPSTREAM_ERROR",
    503: "LIBRARY_UNAVAILABLE",
    504: "LIBRARY_TIMEOUT",
}


def success(request: Request, data: object) -> dict:
    """为业务数据添加请求标识和成功结果码。"""
    return {"id": request.state.request_id, "code": "success", "message": "success", "data": data}


def error_response(
    status_code: int,
    message: str,
    *,
    request_id: str | None = None,
    code: str | None = None,
    data: dict | None = None,
    headers: dict | None = None,
) -> JSONResponse:
    """生成包含业务错误码、提示和字段详情的失败响应。"""
    identifier = request_id or str(uuid4())
    return JSONResponse(
        {
            "id": identifier,
            "code": code or STATUS_CODES.get(status_code, "INTERNAL_ERROR"),
            "message": message,
            "data": data,
        },
        status_code=status_code,
        headers={**(headers or {}), "X-Request-ID": identifier},
    )


async def require_json(request: Request) -> None:
    """校验 JSON 请求的媒体类型。"""
    media = request.headers.get("content-type", "").split(";", 1)[0].strip().lower()
    if await request.body() and not (
        media == "application/json" or (media.startswith("application/") and media.endswith("+json"))
    ):
        raise HTTPException(415, "Request body must be JSON.")


async def require_multipart(request: Request) -> None:
    """校验文件上传请求的媒体类型。"""
    media = request.headers.get("content-type", "").split(";", 1)[0].strip().lower()
    if media != "multipart/form-data":
        raise HTTPException(415, "Upload request must use multipart form data.")


class RequestContext:
    """为每个 HTTP 请求分配关联标识，并将其写入响应头。"""

    def __init__(self, app: ASGIApp):
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        identifier = str(uuid4())
        scope.setdefault("state", {})["request_id"] = identifier

        async def send_response(message):
            if message["type"] == "http.response.start":
                headers = [(key, value) for key, value in message.get("headers", []) if key.lower() != b"x-request-id"]
                message = {**message, "headers": [*headers, (b"x-request-id", identifier.encode())]}
            await send(message)

        await self.app(scope, receive, send_response)


def install_error_handlers(app: FastAPI) -> None:
    """注册领域异常、请求校验和框架异常的统一处理器。"""

    def answer(request: Request, status: int, message: str, **kwargs):
        return error_response(status, message, request_id=request.state.request_id, **kwargs)

    @app.exception_handler(HubError)
    async def hub_error(request: Request, exc: HubError):
        return answer(request, exc.status_code, str(exc), code=exc.code)

    @app.exception_handler(RequestValidationError)
    async def invalid(request: Request, exc: RequestValidationError):
        errors = exc.errors()
        malformed = any(item["type"] == "json_invalid" for item in errors)
        issues = [
            {
                "location": str(item["loc"][0]) if item["loc"] else "body",
                "path": list(item["loc"][1:]),
                "code": item["type"],
                "message": item["msg"],
            }
            for item in errors
        ]
        return answer(
            request,
            400 if malformed else 422,
            "Invalid JSON request body." if malformed else "Invalid request parameters.",
            data={"issues": issues},
        )

    @app.exception_handler(HTTPException)
    async def framework_error(request: Request, exc: HTTPException):
        code = "ROUTE_NOT_FOUND" if exc.status_code == 404 else None
        if exc.status_code == 400 and "multipart/form-data" in request.headers.get("content-type", ""):
            code = "INVALID_MULTIPART"
        return answer(request, exc.status_code, str(exc.detail), code=code, headers=exc.headers)

    @app.exception_handler(ValueError)
    async def refused(request: Request, exc: ValueError):
        _log.warning("%s %s refused", request.method, request.url.path, exc_info=exc)
        return answer(request, 422, str(exc))

    @app.exception_handler(RuntimeError)
    @app.exception_handler(Exception)
    async def unexpected(request: Request, exc: Exception):
        _log.error(
            "%s %s requestId=%s failed", request.method, request.url.path, request.state.request_id, exc_info=exc
        )
        return answer(request, 500, "Internal library service error. Check the service logs.")


ERROR_RESPONSES = {status: {"model": ApiFailure} for status in STATUS_CODES}
