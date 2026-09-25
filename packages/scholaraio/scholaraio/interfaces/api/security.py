"""Who may call this service.

The library service is local and single-user, like the Hub server beside it,
and has no login. It is called by the Hub's page in the browser (another origin:
the Hub's port), by the Hub server and by the ``scholaraio`` CLI of the agents
the Hub starts. Three checks keep every other web page out:

- the Host header must name this machine (or a host the user allowed), which
  stops DNS rebinding: another site resolving its own name to 127.0.0.1;
- a mutating request must carry the Hub's custom header, which another origin
  can only send after a CORS preflight;
- CORS grants that preflight only to the Hub's own page.

These are the Hub server's own rules (``packages/server/src/middleware/security.ts``);
the header name and value are those of ``packages/shared/src/csrf.ts``.
"""
from __future__ import annotations

import re
from dataclasses import dataclass

from fastapi import FastAPI
from starlette.middleware.cors import CORSMiddleware
from starlette.types import ASGIApp, Receive, Scope, Send

from scholaraio.interfaces.api.errors import error_response

CSRF_HEADER = "ScholarAIO-Hub"
CSRF_VALUE = "true"
LOOPBACK_HOSTS = ("localhost", "127.0.0.1", "::1")
SAFE_METHODS = frozenset({"GET", "HEAD", "OPTIONS"})

# What the Hub's page sends and reads across origins: the CSRF header, JSON
# bodies, and the conditional and range requests of the PDF reader.
ALLOWED_HEADERS = [CSRF_HEADER, "content-type", "range", "if-range", "if-none-match", "if-modified-since"]
EXPOSED_HEADERS = ["content-range", "accept-ranges", "content-length", "etag", "last-modified", "content-disposition"]


@dataclass(frozen=True)
class AccessPolicy:
    """Which hosts this service answers, and which page may call it from the browser.

    ``allowed_hosts`` of ``None`` answers any Host (``ALLOWED_HOSTS=*``). Without a
    ``hub_port`` no page may call it cross-origin: the strictest setting, which
    tests and the OpenAPI export use.
    """

    allowed_hosts: frozenset[str] | None = frozenset(LOOPBACK_HOSTS)
    hub_port: int | None = None

    @classmethod
    def parse(cls, allowed_hosts: str | None, hub_port: int | None) -> AccessPolicy:
        """``allowed_hosts`` as ``ALLOWED_HOSTS`` spells it: comma-separated names, or "*"."""
        raw = (allowed_hosts or "").strip()
        if raw == "*":
            return cls(allowed_hosts=None, hub_port=hub_port)
        extra = {host.strip().lower() for host in raw.split(",") if host.strip()}
        return cls(allowed_hosts=frozenset({*LOOPBACK_HOSTS, *extra}), hub_port=hub_port)

    def host_allowed(self, host: str | None) -> bool:
        # A request without a Host is not a browser's, so it carries no rebinding risk.
        if not host or self.allowed_hosts is None:
            return True
        if host.startswith("["):
            close = host.find("]")
            if close == -1:
                return False
            name = host[1:close]
        else:
            name = re.sub(r":\d+$", "", host)
        return name.lower() in self.allowed_hosts

    def origin_pattern(self) -> str | None:
        """The origins of the Hub's page: an allowed host on the Hub's port."""
        if self.hub_port is None:
            return None
        if self.allowed_hosts is None:
            hosts = r"[^/:]+|\[[0-9a-fA-F:]+\]"
        else:
            hosts = "|".join(
                re.escape(f"[{host}]" if ":" in host else host) for host in sorted(self.allowed_hosts)
            )
        return rf"https?://({hosts}):{self.hub_port}"


class AccessGuard:
    """Refuse a disallowed Host, and a mutating request without the CSRF header."""

    def __init__(self, app: ASGIApp, policy: AccessPolicy):
        self.app = app
        self.policy = policy

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        headers = {name.decode("latin-1"): value.decode("latin-1") for name, value in scope["headers"]}
        if not self.policy.host_allowed(headers.get("host")):
            response = error_response(403, f"不允许的主机名：{headers.get('host')}（可加入 ALLOWED_HOSTS）")
        elif scope["method"] not in SAFE_METHODS and headers.get(CSRF_HEADER.lower()) != CSRF_VALUE:
            response = error_response(403, "请求缺少必需的请求头")
        else:
            await self.app(scope, receive, send)
            return
        await response(scope, receive, send)


def install_access_policy(app: FastAPI, policy: AccessPolicy) -> None:
    # Added last, CORS runs first: it answers preflights, and puts its headers on
    # the guard's refusals too, so the page can read why it was refused.
    app.add_middleware(AccessGuard, policy=policy)
    pattern = policy.origin_pattern()
    if pattern:
        app.add_middleware(
            CORSMiddleware,
            allow_origin_regex=pattern,
            allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE"],
            allow_headers=ALLOWED_HEADERS,
            expose_headers=EXPOSED_HEADERS,
            max_age=600,
        )


__all__ = ["CSRF_HEADER", "CSRF_VALUE", "AccessPolicy", "install_access_policy"]
