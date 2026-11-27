"""Local task protocol handles uploads, relative assets and parser failures."""
from __future__ import annotations

import io
from zipfile import ZipFile

import pytest

from scholaraio.providers.mineru_tasks import convert_task, task_url


class Response:
    def __init__(self, data=None, content=b"", status=200):
        self.data, self.content, self.status_code = data, content, status

    def json(self):
        return self.data

    def raise_for_status(self):
        assert self.status_code < 400

    def close(self):
        pass

    def __enter__(self):
        return self

    def __exit__(self, *_):
        pass

    def iter_content(self, _):
        yield self.content


def test_task_upload_and_assets(monkeypatch, tmp_path):
    content = io.BytesIO()
    with ZipFile(content, "w") as archive:
        archive.writestr("markdown.md", "# Parsed\n![figure](images/one.png)")
        archive.writestr("images/one.png", b"image-data")
    calls = []

    class Session:
        def __enter__(self):
            return self

        def __exit__(self, *_):
            pass

        def request(self, method, url, **kwargs):
            calls.append((method, url))
            assert kwargs["allow_redirects"] is False
            if method == "POST":
                assert kwargs["json"]["tier"] == "basic"
                return Response({"task_id": "test", "files": [{"upload": {"url": "/upload/test", "headers": {"X-Upload": "yes"}}}]})
            if method == "PUT":
                assert kwargs["data"].read() == b"fake-pdf"
                assert kwargs["headers"] == {"X-Upload": "yes"}
                return Response()
            if url.endswith("/v1/tasks/test"):
                return Response({"status": "completed", "files": [{"status": "completed", "result_url": "/result.zip"}]})
            return Response(content=content.getvalue())

    monkeypatch.setattr("scholaraio.providers.mineru_tasks.requests.Session", Session)
    pdf, md = tmp_path / "paper.pdf", tmp_path / "paper.md"
    pdf.write_bytes(b"fake-pdf")
    convert_task(pdf, md, base="http://parser:18000", tier="basic", mode="auto", timeout=5)
    assert "paper_assets/images/one.png" in md.read_text()
    assert (tmp_path / "paper_assets/images/one.png").read_bytes() == b"image-data"
    assert [method for method, _ in calls] == ["POST", "PUT", "GET", "GET"]


@pytest.mark.parametrize("url", ["http://external/result.zip", "//external/upload", "https://parser:18000/result"])
def test_cross_service_result_rejected(url):
    with pytest.raises(ValueError, match="outside"):
        task_url("http://parser:18000", url)


def test_failed_task_never_writes_markdown(monkeypatch, tmp_path):
    class Session:
        def __enter__(self):
            return self

        def __exit__(self, *_):
            pass

        def request(self, method, url, **kwargs):
            if method == "POST":
                return Response({"task_id": "test", "files": [{}]})
            return Response({"status": "failed", "files": [{"status": "failed", "error": "OCR failed"}]})

    monkeypatch.setattr("scholaraio.providers.mineru_tasks.requests.Session", Session)
    pdf, md = tmp_path / "paper.pdf", tmp_path / "paper.md"
    pdf.write_bytes(b"fake-pdf")
    with pytest.raises(ValueError, match="OCR failed"):
        convert_task(pdf, md, base="http://parser:18000", tier="basic", mode="auto", timeout=5)
    assert not md.exists()
