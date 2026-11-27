"""What the HTTP layer promises every caller, whatever the route."""
from __future__ import annotations

import json
import re
from io import BytesIO
from pathlib import Path
from zipfile import ZipFile

import pytest
import yaml
from scholaraio.interfaces.api.app import create_app
from tests.hub_client import hub_client

@pytest.fixture
def client(tmp_path):
    with hub_client(tmp_path / "app", raise_server_exceptions=False) as client:
        yield client


def test_a_missing_resource_is_a_404_that_names_it(client):
    paper = client.get("/papers/unknown")
    assert paper.status_code == 404
    assert paper.json()["message"] == "Paper not found: unknown"

    job = client.post("/imports/unknown/retry")
    assert job.status_code == 404
    assert "unknown" in job.json()["message"]


def test_a_refused_request_is_a_422_with_the_reason(client):
    response = client.post("/tasks/unknown")
    assert response.status_code == 422
    assert response.json()["message"] == "Unknown task type: unknown"


def test_a_bug_is_a_500_not_a_missing_resource(client, monkeypatch):
    def broken():
        return {}["title"]

    monkeypatch.setattr(client.app.state.library.papers, "list", broken)

    response = client.get("/papers")
    assert response.status_code == 500
    assert response.json()["message"] == "Internal library service error. Check the service logs."


def test_a_failure_the_caller_did_not_cause_is_logged_with_its_traceback(client, monkeypatch, caplog):
    def unreadable():
        raise RuntimeError("index unreadable")

    monkeypatch.setattr(client.app.state.library.papers, "list", unreadable)

    with caplog.at_level("ERROR", logger="scholaraio.api"):
        assert client.get("/papers").status_code == 500
    assert "GET /papers requestId=" in caplog.text
    assert "index unreadable" in caplog.text


def test_invalid_input_answers_in_the_same_shape_as_every_other_failure(client):
    response = client.put("/papers/unknown/position", json={"page": "not a number"})
    assert response.status_code == 422
    assert set(response.json()) == {"id", "code", "message", "data"}


def test_an_unreadable_settings_overlay_is_a_storage_fault(client):
    library = client.app.state.library
    library.settings.path.write_text("- not\n- a mapping\n", encoding="utf-8")

    response = client.patch("/settings", json={"extractor": "regex"})

    assert response.status_code == 500
    assert response.json()["code"] == "INTERNAL_ERROR"


def test_request_bodies_use_the_browsers_field_names(client):
    library = client.app.state.library

    response = client.patch("/settings", json={"llmModel": "model-a", "pdfParser": "mineru"})

    assert response.status_code == 200
    assert response.json()["data"]["llmModel"] == "model-a"
    stored = yaml.safe_load(library.settings.path.read_text(encoding="utf-8"))
    assert stored["llm"]["model"] == "model-a"


def test_a_query_scoped_to_a_collection_uses_its_camel_case_name(client):
    assert client.post("/collections", json={"name": "empty"}).status_code == 201

    search = {"q": "anything", "mode": "keyword"}
    assert client.get("/search", params={**search, "collectionId": "empty"}).json()["data"] == {"results": []}
    assert client.get("/search", params={**search, "collectionId": "missing"}).status_code == 404


def test_an_upload_for_a_missing_collection_is_a_404(client):
    response = client.post(
        "/imports",
        files=[("files", ("paper.pdf", b"%PDF-1.4\n", "application/pdf"))],
        data={"collectionId": "Nowhere"},
    )
    assert response.status_code == 404
    assert "Nowhere" in response.json()["message"]


def test_settings_check_names_what_it_checked(client):
    response = client.post("/settings/check", json={"target": "embed"})
    assert response.status_code == 200
    assert response.json()["data"]["target"] == "embed"
    assert client.post("/settings/check", json={"target": "disk"}).status_code == 422


def test_all_json_routes_describe_the_response_envelope(tmp_path):
    """检查文献 JSON 接口的生成契约包含统一响应结构。"""
    doc = create_app(tmp_path / "app").openapi()
    for operations in doc["paths"].values():
        for operation in operations.values():
            for status, response in operation["responses"].items():
                schema = response.get("content", {}).get("application/json", {}).get("schema", {})
                reference = schema.get("$ref")
                if reference and status.startswith("2"):
                    model = doc["components"]["schemas"][reference.rsplit("/", 1)[-1]]
                    assert set(model["properties"]) == {"id", "code", "message", "data"}
                    assert set(model["required"]) == {"id", "code", "message", "data"}


def test_request_identifier_matches_headers_and_is_not_the_resource_id(client):
    response = client.post("/collections", json={"name": "contract"})
    payload = response.json()
    assert response.status_code == 201
    assert set(payload) == {"id", "code", "message", "data"}
    assert payload["code"] == "success"
    assert payload["message"] == "success"
    assert payload["id"] == response.headers["x-request-id"]
    assert payload["id"] != payload["data"]["id"]
    assert client.get("/collections").json()["id"] != payload["id"]


@pytest.mark.parametrize("path,method,status,code", [
    ("/unknown", "get", 404, "ROUTE_NOT_FOUND"),
    ("/health", "delete", 405, "METHOD_NOT_ALLOWED"),
    ("/papers/unknown", "get", 404, "PAPER_NOT_FOUND"),
    ("/collections/unknown", "get", 404, "COLLECTION_NOT_FOUND"),
])
def test_framework_and_domain_errors_follow_one_contract(client, path, method, status, code):
    response = getattr(client, method)(path)
    assert response.status_code == status
    assert response.json()["code"] == code
    assert response.json()["id"] == response.headers["x-request-id"]
    if status == 405:
        assert "GET" in response.headers["allow"]


def test_json_syntax_and_field_validation_are_distinct(client):
    malformed = client.post("/collections", content="{", headers={"content-type": "application/json"})
    assert malformed.status_code == 400
    assert malformed.json()["code"] == "INVALID_JSON"
    invalid = client.post("/collections", json={"name": ""})
    assert invalid.status_code == 422
    assert invalid.json()["code"] == "VALIDATION_FAILED"
    assert invalid.json()["data"]["issues"][0]["path"] == ["name"]
    unsupported = client.post("/collections", content='{"name":"plain"}', headers={"content-type": "text/plain"})
    assert unsupported.status_code == 415
    assert unsupported.json()["code"] == "UNSUPPORTED_MEDIA_TYPE"


def test_python_and_typescript_declare_the_same_error_codes():
    from scholaraio.interfaces.api.responses import ApiFailure
    contract = Path(__file__).resolve().parents[2] / "shared" / "src" / "http.ts"
    source = contract.read_text(encoding="utf-8").split("} as const;")[0]
    typescript_codes = set(re.findall(r"^  ([A-Z_]+): \d+", source, re.MULTILINE))
    python_codes = set(ApiFailure.model_json_schema()["properties"]["code"]["enum"])
    assert python_codes == typescript_codes


def test_upload_plain_papers_zip_without_manifest(client):
    payload = BytesIO()
    with ZipFile(payload, "w") as archive:
        archive.writestr("papers/alice-2026-example/meta.json", json.dumps({
            "id": "plain-paper", "title": "Example paper", "authors": ["Alice"],
        }))
        archive.writestr("papers/alice-2026-example/paper.md", "# Example paper\nSpectroscopy")
    upload = {"file": ("papers.zip", payload.getvalue(), "application/zip")}

    response = client.post("/documents/import", files=upload)

    assert response.status_code == 200
    assert response.json()["data"] == {"imported": 1, "skipped": 0, "vectors": 0}
    papers = client.get("/papers").json()["data"]["papers"]
    assert any(paper["id"] == "plain-paper" and paper["hasMarkdown"] for paper in papers)
    repeated = client.post("/documents/import", files=upload)
    assert repeated.status_code == 200
    assert repeated.json()["data"] == {"imported": 0, "skipped": 1, "vectors": 0}
