"""Who may call the library service: the Hub's page, the Hub server and its agents."""
from __future__ import annotations

from pathlib import Path

import pytest

from scholaraio.hub.directories import DirectoryService
from scholaraio.hub.runtime import LibraryRuntime
from scholaraio.interfaces.api.security import CSRF_HEADER, CSRF_VALUE, AccessPolicy
from tests.hub_client import hub_client

HUB_PAGE = "http://localhost:3400"
PREFLIGHT = {"access-control-request-method": "POST", "access-control-request-headers": CSRF_HEADER}


@pytest.fixture
def client(tmp_path):
    with hub_client(tmp_path / "app", AccessPolicy.parse("", hub_port=3400)) as client:
        yield client


def test_a_rebinding_host_is_refused(client):
    response = client.get("/health", headers={"host": "attacker.example:3401"})
    assert response.status_code == 403
    assert "ALLOWED_HOSTS" in response.json()["message"]
    assert client.get("/health", headers={"host": "127.0.0.1:3401"}).status_code == 200
    assert client.get("/health", headers={"host": "[::1]:3401"}).status_code == 200


def test_allowed_hosts_widen_the_loopback_names(tmp_path):
    with hub_client(tmp_path / "app", AccessPolicy.parse("hub.lan", hub_port=3400)) as client:
        assert client.get("/health", headers={"host": "hub.lan:3401"}).status_code == 200
        assert client.get("/health", headers={"host": "other.lan:3401"}).status_code == 403
    assert AccessPolicy.parse("*", hub_port=3400).host_allowed("anything:1")


def test_a_mutation_needs_the_csrf_header(client):
    del client.headers[CSRF_HEADER]
    refused = client.post("/projects", json={"name": "p"})
    assert refused.status_code == 403
    assert refused.json()["message"] == "Request is missing a required header."
    assert client.get("/projects").status_code == 200
    assert client.post("/projects", json={"name": "p"}, headers={CSRF_HEADER: CSRF_VALUE}).status_code == 201


def test_only_the_hub_page_passes_the_preflight(client):
    granted = client.options("/projects", headers={"origin": HUB_PAGE, **PREFLIGHT})
    assert granted.status_code == 200
    assert granted.headers["access-control-allow-origin"] == HUB_PAGE
    assert CSRF_HEADER.lower() in granted.headers["access-control-allow-headers"].lower()
    for origin in ("http://evil.example", "http://localhost:9999", "http://localhost:3400.evil.example"):
        refused = client.options("/projects", headers={"origin": origin, **PREFLIGHT})
        assert refused.status_code == 403
        assert refused.json()["code"] == "CORS_REJECTED"
        assert "access-control-allow-origin" not in refused.headers


def test_the_hub_page_can_read_range_responses_and_refusals(client):
    answer = client.get("/health", headers={"origin": HUB_PAGE})
    assert answer.headers["access-control-allow-origin"] == HUB_PAGE
    assert "content-range" in answer.headers["access-control-expose-headers"].lower()
    refusal = client.post("/projects", json={"name": "p"}, headers={"origin": HUB_PAGE, CSRF_HEADER: "no"})
    assert refusal.status_code == 403
    assert refusal.headers["access-control-allow-origin"] == HUB_PAGE


def test_without_a_hub_port_no_page_may_call_across_origins(tmp_path):
    with hub_client(tmp_path / "app") as client:
        response = client.options("/projects", headers={"origin": HUB_PAGE, **PREFLIGHT})
        assert "access-control-allow-origin" not in response.headers


def test_reveal_opens_only_the_library_s_own_directories(tmp_path):
    opened: list[Path] = []
    runtime = LibraryRuntime(tmp_path / "app")
    directories = DirectoryService(runtime, opener=opened.append)
    assert directories.reveal("data") == {"opened": True, "path": str(runtime.root)}
    directories.reveal("papers")
    assert opened == [runtime.root, runtime.cfg.papers_dir.resolve()]
    with hub_client(tmp_path / "other") as client:
        assert client.post("/directories/elsewhere/reveal").status_code == 422
