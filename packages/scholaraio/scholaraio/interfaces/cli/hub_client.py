"""Client used by the CLI when it runs inside a Hub session.

The Hub's library service owns every write to the library: it holds the locks,
serializes long jobs and notifies the browser. A CLI run started by an agent
shares that data directory, so it must ask the service instead of writing the
files itself. The Hub server gives the agent the service's address.

Read commands are unaffected and keep reading the data directory directly.
"""

from __future__ import annotations

import json
import os
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.request import ProxyHandler, Request, build_opener

# Set by the Hub server for the agent's child process: the library service's address.
ENDPOINT_VARIABLE = "SCHOLARAIO_LIBRARY_API"
# The library service requires this header on mutating requests.
CSRF_HEADER = "ScholarAIO-Hub"
TIMEOUT_SECONDS = 60


class HubUnavailable(RuntimeError):
    """The Hub service could not be reached or refused the request."""


def endpoint() -> str | None:
    """Return the library service's base URL when this CLI runs inside a Hub session."""
    value = os.environ.get(ENDPOINT_VARIABLE, "").strip()
    return value.rstrip("/") or None


def active() -> bool:
    return endpoint() is not None


def request(method: str, path: str, payload: dict | None = None) -> Any:
    """调用文献服务并返回统一响应中的业务数据。"""
    base = endpoint()
    if base is None:
        raise HubUnavailable("Write operations through Hub require an active Hub session")
    body = None if payload is None else json.dumps(payload).encode("utf-8")
    call = Request(f"{base}{path}", data=body, method=method)
    call.add_header(CSRF_HEADER, "true")
    if body is not None:
        call.add_header("content-type", "application/json")
    # Localhost must not be routed through a configured proxy.
    opener = build_opener(ProxyHandler({}))
    try:
        with opener.open(call, timeout=TIMEOUT_SECONDS) as response:
            text = response.read().decode("utf-8")
    except HTTPError as error:
        raise HubUnavailable(_error_message(error)) from error
    except (URLError, TimeoutError) as error:
        raise HubUnavailable(f"Unable to connect to Hub ({base}): {error}") from error
    if not text:
        return None
    result = json.loads(text)
    if not isinstance(result, dict) or result.get("code") != "success" or "data" not in result:
        raise HubUnavailable("Invalid library service response format")
    return result["data"]


def _error_message(error: HTTPError) -> str:
    detail = ""
    try:
        payload = json.loads(error.read().decode("utf-8"))
        if isinstance(payload, dict):
            detail = str(payload.get("message") or "")
    except (ValueError, OSError):
        detail = ""
    return f"Hub rejected the request ({error.code}): {detail or error.reason}"
