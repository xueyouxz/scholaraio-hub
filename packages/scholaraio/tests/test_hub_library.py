from pathlib import Path

import pymupdf
from fastapi.testclient import TestClient

from scholaraio.interfaces.api.__main__ import create_app
from scholaraio.services.hub_library import HubLibrary


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
