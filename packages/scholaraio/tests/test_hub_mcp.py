"""Real MCP protocol, readonly surface, citation scoping and browser protections."""
from __future__ import annotations

import json

from fastapi.testclient import TestClient

from scholaraio.hub.storage import atomic_json
from scholaraio.interfaces.api.app import create_app


def seed(library, pid, title, text):
    directory = library.runtime.cfg.papers_dir / pid
    directory.mkdir()
    atomic_json(directory / "meta.json", {"id": pid, "title": title, "journal": "NeurIPS", "authors": []})
    (directory / "paper.md").write_text(text, encoding="utf-8")
    library.runtime.reindex()


def rpc(client, method, params=None, request_id=1, **kwargs):
    body = {"jsonrpc": "2.0", "id": request_id, "method": method}
    if params is not None:
        body["params"] = params
    return client.post("/mcp/", json=body,
                       headers={"Accept": "application/json, text/event-stream"}, **kwargs)


def test_real_protocol_is_readonly_scoped_and_paginated(tmp_path):
    with TestClient(create_app(tmp_path), base_url="http://localhost") as client:
        seed(client.app.state.library, "alpha", "Alpha", "# Alpha\nQuantum spectroscopy\nResult\nLast line")
        seed(client.app.state.library, "beta", "Beta", "# Beta\nPrivate unrelated optics")
        init = rpc(client, "initialize", {"protocolVersion": "2025-06-18", "capabilities": {},
                                         "clientInfo": {"name": "test", "version": "1"}})
        assert init.status_code == 200
        tools = rpc(client, "tools/list").json()["result"]["tools"]
        assert {tool["name"] for tool in tools} == {
            "list_papers", "list_collections", "search_papers", "read_paper", "retrieve_passages"}
        assert all(tool["annotations"]["readOnlyHint"] for tool in tools)
        def call(name, args):
            response = rpc(client, "tools/call", {"name": name, "arguments": args}).json()["result"]
            return response
        papers = call("list_papers", {"limit": 1})["structuredContent"]
        assert papers["total"] == 2 and papers["nextOffset"] == 1
        assert papers["papers"][0]["category"] == "NeurIPS"
        assert call("list_collections", {})["structuredContent"] == {"collections": []}
        hits = call("search_papers", {"query": "spectroscopy", "paper_ids": ["alpha"]})["structuredContent"]
        assert [hit["paper"]["id"] for hit in hits["results"]] == ["alpha"]
        assert call("search_papers", {"query": "spectroscopy", "paper_ids": []})["structuredContent"]["results"] == []
        passages = call("retrieve_passages", {"query": "optics", "paper_ids": ["alpha"]})["structuredContent"]
        assert all(citation["paperId"] == "alpha" for citation in passages["citations"])
        first = call("read_paper", {"paper_id": "alpha", "max_lines": 2})["structuredContent"]
        assert first["text"] == "1: # Alpha\n2: Quantum spectroscopy"
        assert first["nextLine"] == 3
        assert call("read_paper", {"paper_id": "../config.yaml"})["isError"]
        assert call("read_paper", {"paper_id": "alpha", "max_lines": 5000})["isError"]
        assert rpc(client, "resources/read", {"uri": "scholaraio://papers/alpha"}).status_code == 200
        assert client.post("/mcp/", json={}, headers={"Origin": "https://evil.example"}).status_code == 403
        assert client.post("/mcp/", json={}, headers={"Host": "evil.example"}).status_code == 403
        # Bypassing the web CSRF header is limited to the readonly protocol endpoint.
        assert client.patch("/settings", json={"llmModel": "oops"}).status_code == 403
