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
