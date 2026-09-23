"""What the HTTP layer promises every caller, whatever the route."""
from __future__ import annotations

import pytest
import yaml
from fastapi.testclient import TestClient

from scholaraio.interfaces.api.app import create_app

TOKEN = "contract-token"


@pytest.fixture
def client(tmp_path):
    app = create_app(tmp_path / "app", TOKEN)
    with TestClient(app, headers={"x-hub-token": TOKEN}, raise_server_exceptions=False) as client:
        yield client


def test_a_missing_resource_is_a_404_that_names_it(client):
    paper = client.get("/papers/unknown")
    assert paper.status_code == 404
    assert paper.json() == {"error": "文献不存在：unknown"}

    job = client.post("/imports/unknown/retry")
    assert job.status_code == 404
    assert "unknown" in job.json()["error"]


def test_a_refused_request_is_a_400_with_the_reason(client):
    response = client.post("/tasks/unknown")
    assert response.status_code == 400
    assert response.json() == {"error": "未知的任务类型：unknown"}


def test_a_bug_is_a_500_not_a_missing_resource(client, monkeypatch):
    def broken():
        return {}["title"]

    monkeypatch.setattr(client.app.state.library.papers, "list", broken)

    assert client.get("/papers").status_code == 500


def test_an_unreadable_settings_overlay_is_a_storage_fault(client):
    library = client.app.state.library
    library.settings.path.write_text("- not\n- a mapping\n", encoding="utf-8")

    response = client.patch("/settings", json={"extractor": "regex"})

    assert response.status_code == 500
    assert "config.local.yaml" in response.json()["error"]


def test_request_bodies_use_the_browsers_field_names(client):
    library = client.app.state.library

    response = client.patch("/settings", json={"llmModel": "model-a", "pdfParser": "mineru"})

    assert response.status_code == 200
    assert response.json()["llmModel"] == "model-a"
    stored = yaml.safe_load(library.settings.path.read_text(encoding="utf-8"))
    assert stored["llm"]["model"] == "model-a"


def test_a_query_scoped_to_a_project_uses_its_camel_case_name(client):
    assert client.post("/projects", json={"name": "empty"}).status_code == 201

    assert client.get("/search", params={"q": "", "projectId": "empty"}).json() == {"results": []}
    assert client.get("/search", params={"q": "", "projectId": "missing"}).status_code == 404
