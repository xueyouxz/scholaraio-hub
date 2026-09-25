"""What the HTTP layer promises every caller, whatever the route."""
from __future__ import annotations

import re
from pathlib import Path

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

    response = client.get("/papers")
    assert response.status_code == 500
    assert response.json() == {"error": "文献服务内部错误，详见服务日志。"}


def test_a_failure_the_caller_did_not_cause_is_logged_with_its_traceback(client, monkeypatch, caplog):
    def unreadable():
        raise RuntimeError("index unreadable")

    monkeypatch.setattr(client.app.state.library.papers, "list", unreadable)

    with caplog.at_level("ERROR", logger="scholaraio.api"):
        assert client.get("/papers").status_code == 500
    assert "GET /papers failed" in caplog.text
    assert "index unreadable" in caplog.text


def test_invalid_input_answers_in_the_same_shape_as_every_other_failure(client):
    response = client.put("/papers/unknown/position", json={"page": "not a number"})
    assert response.status_code == 422
    assert set(response.json()) == {"error"}


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

    search = {"q": "anything", "mode": "keyword"}
    assert client.get("/search", params={**search, "projectId": "empty"}).json() == {"results": []}
    assert client.get("/search", params={**search, "projectId": "missing"}).status_code == 404


def test_an_upload_for_a_missing_workspace_is_a_404(client):
    response = client.post(
        "/imports",
        files=[("files", ("paper.pdf", b"%PDF-1.4\n", "application/pdf"))],
        data={"projectId": "Nowhere"},
    )
    assert response.status_code == 404
    assert "Nowhere" in response.json()["error"]


def test_settings_check_names_what_it_checked(client):
    response = client.post("/settings/check", json={"target": "embed"})
    assert response.status_code == 200
    assert response.json()["target"] == "embed"
    assert client.post("/settings/check", json={"target": "disk"}).status_code == 422


# The Node server calls these itself rather than proxying them: startup health,
# session scope and context, and project rename/archive (which also move the
# project's sessions; see server/src/routes/projects.ts).
SERVER_ONLY = {
    ("GET", "/health"),
    ("POST", "/scope"),
    ("POST", "/context"),
    ("POST", "/projects/{}/rename"),
    ("DELETE", "/projects/{}"),
}
PROXY = Path(__file__).resolve().parents[2] / "server" / "src" / "routes" / "library.ts"


def _shape(path: str) -> str:
    """A route with its parameters unnamed, so FastAPI and Hono paths compare."""
    return re.sub(r"\{[^}]+\}|:\w+|\*", "{}", path)


def test_every_route_is_proxied_or_called_by_the_server(tmp_path):
    """The Node proxy's allowlist and this API list the same routes.

    A route on neither side of that list is one nothing can reach; a proxied
    route this API lacks is a page that can only fail.
    """
    app = create_app(tmp_path / "app", TOKEN)
    served = {
        (method.upper(), _shape(path))
        for path, operations in app.openapi()["paths"].items()
        for method in operations
    }
    proxied = {
        (method, _shape(path))
        for method, path in re.findall(
            r'\["(GET|POST|PATCH|PUT|DELETE)", "([^"]+)"\]', PROXY.read_text(encoding="utf-8")
        )
    }
    assert proxied, "no routes found in the proxy allowlist"
    assert served - SERVER_ONLY == proxied
