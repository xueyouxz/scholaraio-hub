"""API embedding works through settings, jobs and MCP without local model packages."""
from __future__ import annotations

import builtins
import json
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import pytest

from scholaraio.hub.storage import atomic_json
from scholaraio.services import vectors
from tests.hub_client import hub_client
from tests.test_hub_mcp import rpc


@pytest.fixture
def embedding_api():
    calls = []
    state = {"status": 200, "vectors": None}

    class Handler(BaseHTTPRequestHandler):
        def do_POST(self):
            body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
            calls.append({"path": self.path, "body": body, "key": self.headers.get("Authorization")})
            data = [{"index": i, "embedding": state["vectors"] if state["vectors"] is not None else
                     ([1.0, 0.0] if "alpha" in text.casefold() else [0.0, 1.0])}
                    for i, text in enumerate(body["input"])]
            self.send_response(state["status"])
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps({"data": list(reversed(data))}).encode())

        def log_message(self, *_args):
            pass

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        yield f"http://127.0.0.1:{server.server_port}/v1", calls, state
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=5)


def configure(client, address):
    response = client.patch("/settings", json={"embedProvider": "openai-compat", "embedApiBase": address,
                                              "embedModel": "test-embedding", "embedApiKey": "test-secret"})
    assert response.status_code == 200
    result = response.json()["data"]
    assert result["embedProvider"] == "openai-compat"
    assert result["embedApiBase"] == address
    assert result["embedApiConfigured"] and result["embedKeyLength"] == len("test-secret")
    assert "test-secret" not in response.text


def test_settings_job_search_and_mcp_without_local_dependencies(tmp_path, embedding_api, monkeypatch):
    address, calls, _ = embedding_api
    original_import = builtins.__import__

    def no_local_model(name, *args, **kwargs):
        if name.split(".")[0] in {"numpy", "torch", "sentence_transformers", "faiss"}:
            raise AssertionError(f"API mode must not import {name}")
        return original_import(name, *args, **kwargs)

    monkeypatch.setattr(builtins, "__import__", no_local_model)
    monkeypatch.setattr(vectors, "runtime_available", lambda: False)
    with hub_client(tmp_path) as client:
        configure(client, address)
        assert calls == []
        saved = client.patch("/settings", json={"embedModel": "test-embedding"}).json()["data"]
        assert saved["embedProvider"] == "openai-compat"
        assert client.post("/settings/check", json={"target": "embed"}).json()["data"]["level"] == "ok"
        assert len(calls) == 1
        assert calls[0]["path"] == "/v1/embeddings" and calls[0]["key"] == "Bearer test-secret"
        library = client.app.state.library
        for pid in ("alpha", "beta"):
            directory = library.runtime.cfg.papers_dir / pid
            directory.mkdir()
            atomic_json(directory / "meta.json", {"id": pid, "title": pid, "authors": [], "year": 2024})
            (directory / "paper.md").write_text(f"# {pid}\nPaper body", encoding="utf-8")
        library.runtime.reindex()
        assert client.post("/tasks/semantic").status_code == 202
        for _ in range(500):
            status = client.get("/tasks").json()["data"]
            task = next(t for t in status["tasks"] if t["kind"] == "semantic")
            if task["status"] not in {"queued", "running"}:
                break
            time.sleep(0.01)
        assert task["status"] == "completed", task
        assert status["semanticReady"] and status["vectors"] == 2
        assert not status["vectorRuntimeReady"]
        response = rpc(client, "tools/call", {"name": "search_papers", "arguments": {
            "query": "alpha relevant research", "mode": "semantic", "limit": 1}}).json()["result"]
        assert response["structuredContent"]["results"][0]["paper"]["id"] == "alpha"
        scoped = library.reader.find("alpha", ["beta"], None, "semantic", 1)
        assert scoped["results"][0]["paper"]["id"] == "beta"
        assert vectors.vsearch("alpha", library.runtime.cfg.index_db, cfg=library.runtime.cfg, year="2024")[0]["paper_id"] == "alpha"
        before = len(calls)
        assert vectors.vsearch("alpha", library.runtime.cfg.index_db, cfg=library.runtime.cfg, paper_ids=set()) == []
        assert len(calls) == before
        client.patch("/settings", json={"embedModel": "other-model"})
        assert not client.get("/tasks").json()["data"]["semanticReady"]
        blocked = library.reader.find("alpha", None, None, "semantic", 1)
        assert blocked["unavailable"] == "no_vectors"
        assert len(calls) == before
        assert library.runtime.papers.find("alpha").directory.joinpath("paper.md").exists()
        client.patch("/settings", json={"embedProvider": "local"})
        assert client.get("/settings").json()["data"]["embedProvider"] == "local"


@pytest.mark.parametrize("status,vector", [(401, None), (200, []), (200, ["bad"]), (200, [True])])
def test_api_check_reports_authentication_and_invalid_vectors(tmp_path, embedding_api, status, vector):
    address, calls, state = embedding_api
    state.update(status=status, vectors=vector)
    with hub_client(tmp_path) as client:
        configure(client, address)
        result = client.post("/settings/check", json={"target": "embed"}).json()["data"]
        assert result["level"] == "error" and not result["ok"]
        assert len(calls) == 1
        assert "test-secret" not in str(result)


@pytest.mark.parametrize("address", ["not a URL", "file:///tmp/embed", "https://example.org/v1?key=secret"])
def test_invalid_api_address_is_rejected(tmp_path, address):
    with hub_client(tmp_path) as client:
        assert client.patch("/settings", json={"embedApiBase": address}).status_code == 422
