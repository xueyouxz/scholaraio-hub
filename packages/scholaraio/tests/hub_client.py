"""A client of the library service as the Hub calls it."""
from __future__ import annotations

from pathlib import Path

from fastapi.testclient import TestClient

from scholaraio.interfaces.api.app import create_app
from scholaraio.interfaces.api.security import CSRF_HEADER, CSRF_VALUE, AccessPolicy


def hub_client(root: Path, policy: AccessPolicy | None = None, **kwargs) -> TestClient:
    """On this machine, with the CSRF header every mutating request needs."""
    return TestClient(
        create_app(root, policy), base_url="http://localhost", headers={CSRF_HEADER: CSRF_VALUE}, **kwargs
    )
