from pathlib import Path
import json

import pymupdf
from fastapi.testclient import TestClient

from scholaraio.interfaces.api.__main__ import create_app
from scholaraio.services.hub_library import HubLibrary


def test_existing_analysis_artifacts_are_scoped_without_rebuilding(tmp_path):
    root = tmp_path / "app"
    source = tmp_path / "paper.pdf"
    pdf_file(source)
    library = HubLibrary(root)
    try:
        pid, _ = library.import_pdf(source, "Analysis.pdf")
        directory, meta = library.find(pid)
        meta["citation_count"] = {"crossref": 3, "semantic_scholar": 6}
        meta["l3_conclusion"] = "Saved original conclusion"
        (directory / "meta.json").write_text(json.dumps(meta))
        row = library.detail(pid)
        assert row["citationCount"] is None
        assert row["citationCounts"] == meta["citation_count"]
        assert row["l3Conclusion"] == "Saved original conclusion"
        state = library.cfg.state_root
        (state / "topics").mkdir(parents=True, exist_ok=True)
        (state / "projection").mkdir(parents=True, exist_ok=True)
        overview = {"built": True, "topicCount": 1, "topics": [{"id": 1, "paperCount": 2, "keywords": ["visualization"], "name": "Visualization"}]}
        projection = {"built": True, "points": [{"id": pid, "x": 1, "y": 2, "topicId": 1, "year": 2025, "title": "Analysis"}, {"id": "deleted", "topicId": 1}]}
        (state / "topics/overview.json").write_text(json.dumps(overview))
        (state / "projection/projection.json").write_text(json.dumps(projection))
        result = library.analytics()
        assert len(result["projection"]["points"]) == 1
        assert not result["similarity"]["built"]
        library.projects.create("empty")
        assert library.analytics("empty")["projection"]["points"] == []
        assert library.analytics("empty")["topics"]["topics"] == []
        library.projects.update_papers("empty", [pid], "add")
        assert library.analytics("empty")["topics"]["topics"][0]["paperCount"] == 1
        assert json.loads((state / "projection/projection.json").read_text()) == projection
    finally:
        library.close()


def pdf_file(path: Path):
    with pymupdf.open() as pdf:
        page = pdf.new_page()
        page.insert_text((72, 72), "Spectroscopy detects molecular transitions in local literature.")
        pdf.save(path)


def test_import_search_duplicate_and_context(tmp_path):
    source = tmp_path / "source.pdf"
    pdf_file(source)
    library = HubLibrary(tmp_path / "app")
    try:
        pid, duplicate = library.import_pdf(source, "Research.pdf")
        assert not duplicate
        assert library.import_pdf(source, "Another.pdf") == (pid, True)
        results = library.search("molecular")
        assert results[0]["paper"]["id"] == pid
        assert results[0]["matches"][0]["start_line"] >= 1
        assert library.context("Summarize", [pid])["citations"][0]["paperId"] == pid
        assert library.detail(pid)["hasPdf"]
        assert library.context("What does spectroscopy detect?", [])["citations"][0]["paperId"] == pid
        assert library.search("???") == []
        assert library.search("OR") == []
    finally:
        library.close()


def test_pdf_range_position_and_auth(tmp_path):
    source = tmp_path / "source.pdf"
    pdf_file(source)
    with TestClient(create_app(tmp_path / "app", "test-secret")) as client:
        assert client.get("/papers").status_code == 401
        client.headers["x-hub-token"] = "test-secret"
        pid, _ = client.app.state.library.import_pdf(source, "Paper.pdf")
        response = client.get(f"/papers/{pid}/pdf", headers={"Range": "bytes=0-19"})
        assert response.status_code == 206
        assert len(response.content) == 20
        assert client.put(f"/papers/{pid}/position", json={"page": 2, "line": 3, "mode": "markdown"}).status_code == 200
        assert client.get(f"/papers/{pid}/position").json()["page"] == 2
        assert client.get("/papers/unknown").status_code == 404


def test_corrupt_pdf_preserved_for_retry(tmp_path):
    import pytest
    source = tmp_path / "bad.pdf"
    source.write_bytes(b"bad pdf")
    library = HubLibrary(tmp_path / "app")
    try:
        with pytest.raises(Exception):
            library.import_pdf(source, "bad.pdf")
        paper = library.papers()[0]
        assert paper["hasPdf"]
        assert paper["parseStatus"] == "failed"
    finally:
        library.close()


def test_index_failure_retry_repairs_same_paper(tmp_path):
    from unittest.mock import patch
    import pytest
    source = tmp_path / "source.pdf"
    pdf_file(source)
    library = HubLibrary(tmp_path / "app")
    try:
        with patch.object(library, "reindex", side_effect=RuntimeError("index failed")):
            with pytest.raises(RuntimeError):
                library.import_pdf(source, "Research.pdf")
        failed = library.papers()[0]
        assert failed["parseStatus"] == "failed"
        pid, duplicate = library.import_pdf(source, "Research.pdf")
        assert not duplicate and pid == failed["id"]
        assert library.search("molecular")[0]["paper"]["id"] == pid
        assert len(library.papers()) == 1
    finally:
        library.close()


def test_attachment_boundaries_and_batch_results(tmp_path):
    import time
    source = tmp_path / "source.pdf"
    pdf_file(source)
    with TestClient(create_app(tmp_path / "app", "test-secret")) as client:
        client.headers["x-hub-token"] = "test-secret"
        pid, _ = client.app.state.library.import_pdf(source, "Paper.pdf")
        directory, _ = client.app.state.library.find(pid)
        (directory / "images").mkdir()
        (directory / "images/a.png").write_bytes(b"image")
        assert client.get(f"/papers/{pid}/attachments/images/a.png").content == b"image"
        assert client.get(f"/papers/{pid}/attachments/meta.json").status_code == 400
        (directory / "images/outside.png").symlink_to(source)
        assert client.get(f"/papers/{pid}/attachments/images/outside.png").status_code == 404
        response = client.post("/imports", files=[("files", ("duplicate.pdf", source.read_bytes(), "application/pdf")), ("files", ("broken.pdf", b"broken", "application/pdf"))])
        assert response.status_code == 202
        for _ in range(100):
            jobs = client.get("/imports").json()["jobs"]
            job = next(j for j in jobs if j["id"] == response.json()["id"])
            if all(item["status"] in ("complete", "duplicate", "failed") for item in job["items"]):
                break
            time.sleep(0.02)
        assert {item["status"] for item in job["items"]} == {"duplicate", "failed"}


def test_projects_membership_scope_and_restart(tmp_path):
    root = tmp_path / "app"
    source = tmp_path / "source.pdf"
    pdf_file(source)
    headers = {"x-hub-token": "test"}
    with TestClient(create_app(root, "test"), headers=headers) as client:
        pid, _ = client.app.state.library.import_pdf(source, "Paper.pdf")
        assert client.post("/projects", json={"name": "文献项目"}).status_code == 201
        assert client.post("/projects", json={"name": "文献项目"}).status_code == 400
        assert client.post("/context", json={"query": "molecular", "projectId": "文献项目"}).json()["citations"] == []
        assert client.post("/scope", json={"query": "", "projectId": "文献项目", "paperIds": [pid]}).status_code == 400
        for _ in range(2):
            response = client.post("/projects/文献项目/papers", json={"paperIds": [pid], "action": "add"})
            assert response.status_code == 200
            assert response.json()["paperCount"] == 1
        refs = root / "workspace/文献项目/refs/papers.json"
        assert refs.exists()
        context = client.post("/context", json={"query": "总结", "projectId": "文献项目"}).json()
        assert {c["paperId"] for c in context["citations"]} == {pid}
        assert client.post("/scope", json={"query": "", "projectId": "missing"}).status_code == 404
    with TestClient(create_app(root, "test"), headers=headers) as client:
        assert client.get("/projects").json()["projects"][0]["paperIds"] == [pid]
        assert client.post("/projects/文献项目/papers", json={"paperIds": [pid], "action": "remove"}).json()["paperCount"] == 0
        assert client.post("/context", json={"query": "molecular", "projectId": "文献项目"}).json()["citations"] == []
        assert client.post("/context", json={"query": "molecular"}).json()["citations"]


def test_project_boundaries_and_invalid_indexes(tmp_path):
    import json
    from scholaraio.projects.workspace import create
    root = tmp_path / "app"
    with TestClient(create_app(root, "test"), headers={"x-hub-token": "test"}) as client:
        for name in ["../outside", "a/b", ".hidden", "C:drive", " invalid ", "\n"]:
            assert client.post("/projects", json={"name": name}).status_code == 400
        external = tmp_path / "external"
        create(external)
        ws_root = client.app.state.library.cfg.workspace_dir
        ws_root.mkdir(parents=True, exist_ok=True)
        (ws_root / "escape").symlink_to(external, target_is_directory=True)
        assert client.get("/projects/escape").status_code == 400
        (ws_root / "escape").unlink()
        legacy = ws_root / "legacy"
        legacy.mkdir()
        (legacy / "papers.json").write_text("[]")
        assert "refs/papers.json" in client.get("/projects").json()["error"]
        (legacy / "papers.json").unlink()
        assert client.post("/projects", json={"name": "valid"}).status_code == 201
        index = ws_root / "valid/refs/papers.json"
        index.write_text("{broken")
        assert client.get("/projects/valid").status_code == 500
        index.write_text(json.dumps(["old-paper-id"]))
        assert client.get("/projects/valid").json()["paperIds"] == ["old-paper-id"]
        # Missing papers in an otherwise valid project never broaden its scope.
        assert client.post("/context", json={"query": "molecular", "projectId": "valid"}).json()["citations"] == []
        index.unlink()
        index.symlink_to(external / "refs/papers.json")
        assert client.get("/projects/valid").status_code == 400


def test_original_search_modes_and_image_gallery_are_scoped(tmp_path, monkeypatch):
    source = tmp_path / "paper.pdf"
    pdf_file(source)
    library = HubLibrary(tmp_path / "app")
    try:
        pid, _ = library.import_pdf(source, "Research.pdf")
        directory, meta = library.find(pid)
        meta["authors"] = ["张三", "Alice Smith"]
        (directory / "meta.json").write_text(json.dumps(meta))
        images = directory / "images"
        images.mkdir(exist_ok=True)
        (images / "first.png").write_bytes(b"image")
        (images / "second.jpg").write_bytes(b"image")
        (images / "metadata.txt").write_text("not an image")
        (images / "outside.png").symlink_to(source)
        assert library.images(pid) == ["first.png", "second.jpg"]
        assert library.browse_search("张三", "author", 20)["results"][0]["paper"]["id"] == pid
        assert library.browse_search("molecular", "author", 20)["results"] == []
        assert library.browse_search("molecular", "keyword", 20)["results"][0]["paper"]["id"] == pid
        for mode in ("author", "keyword", "unified", "semantic"):
            assert library.browse_search("张三", mode, 20, set())["results"] == []
        def unified(query, db, **kwargs):
            assert kwargs["paper_ids"] == {pid}
            return [{"paper_id": pid}, {"paper_id": "deleted"}], {"vector_degraded": True}
        monkeypatch.setattr("scholaraio.services.index.unified_search", unified)
        result = library.browse_search("research", "unified", 20, {pid})
        assert [r["paper"]["id"] for r in result["results"]] == [pid]
        assert result["notice"]
    finally:
        library.close()


def test_cli_shares_the_application_library_through_the_generated_config(tmp_path, monkeypatch):
    """An agent's CLI run must resolve the same paths as the Hub service."""
    from scholaraio.core.config import load_config
    from scholaraio.services.hub_config import config_path

    root = tmp_path / "app"
    source = tmp_path / "source.pdf"
    pdf_file(source)
    library = HubLibrary(root)
    try:
        pid, _ = library.import_pdf(source, "Shared.pdf")
        assert config_path(root).exists()
        elsewhere = tmp_path / "unrelated-cwd"
        elsewhere.mkdir()
        monkeypatch.chdir(elsewhere)
        monkeypatch.setenv("SCHOLARAIO_CONFIG", str(config_path(root)))
        cli_cfg = load_config()
        assert cli_cfg.papers_dir == library.cfg.papers_dir
        assert cli_cfg.index_db == library.cfg.index_db
        assert cli_cfg.workspace_dir == library.cfg.workspace_dir
        assert (cli_cfg.papers_dir / library.find(pid)[0].name).is_dir()
    finally:
        library.close()


def test_an_existing_configuration_is_never_rewritten(tmp_path):
    from scholaraio.services.hub_config import config_path

    root = tmp_path / "app"
    root.mkdir()
    config_path(root).write_text("paths:\n  papers_dir: data/libraries/papers\n", encoding="utf-8")
    library = HubLibrary(root)
    try:
        assert config_path(root).read_text(encoding="utf-8").startswith("paths:")
    finally:
        library.close()
