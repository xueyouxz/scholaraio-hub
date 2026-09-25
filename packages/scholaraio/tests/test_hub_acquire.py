"""Fetching a paper the library does not have yet, by whatever the user can name."""
from __future__ import annotations

from pathlib import Path

import pytest

from scholaraio.hub import HubLibrary
from scholaraio.hub import acquire as hub_acquire


@pytest.fixture
def library(tmp_path):
    library = HubLibrary(tmp_path / "app")
    try:
        yield library
    finally:
        library.close()


def test_an_arxiv_identifier_is_recognised_in_either_form():
    assert hub_acquire.arxiv_id("arXiv:2401.12345") == "2401.12345"
    assert hub_acquire.arxiv_id("https://arxiv.org/abs/2401.12345v2") == "2401.12345v2"
    assert hub_acquire.arxiv_id("10.1000/xyz") == ""


def test_a_patent_number_is_told_apart_from_a_doi():
    assert hub_acquire.is_patent("US20240176406A1") is True
    assert hub_acquire.is_patent("https://patents.google.com/patent/US20240176406A1") is True
    assert hub_acquire.is_patent("10.1038/s41586-021-03819-2") is False


def test_an_arxiv_link_is_downloaded_and_queued_for_import(library, monkeypatch, tmp_path):
    asked = {}

    def download(locator: str, work: Path) -> Path:
        asked["locator"] = locator
        path = work / "2401.12345.pdf"
        path.write_bytes(b"%PDF-1.4\n")
        return path

    monkeypatch.setattr(hub_acquire.AcquireService, "download_url", lambda self, locator, work: download(locator, work))

    job = library.acquire.fetch(" arXiv:2401.12345 ")

    assert asked["locator"] == "https://arxiv.org/pdf/2401.12345"
    assert job["source"] == "arxiv"
    assert [item["name"] for item in job["items"]] == ["2401.12345.pdf"]
    staged = Path(job["items"][0]["source"])
    assert staged.is_relative_to(library.runtime.cfg.state_root)


def test_a_locator_that_yields_no_pdf_says_so(library, monkeypatch):
    from scholaraio.services.pdf_fetch import PdfFetchError

    def refuse(*_args, **_kwargs):
        raise PdfFetchError("no PDF link found")

    monkeypatch.setattr("scholaraio.services.pdf_fetch.fetch_pdf", refuse)

    with pytest.raises(ValueError, match="未能获取 PDF"):
        library.acquire.fetch("10.1038/unreachable")


def test_an_empty_locator_is_refused_before_any_request(library):
    with pytest.raises(ValueError, match="请填写"):
        library.acquire.fetch("   ")


def test_a_fetched_paper_is_listed_by_the_title_it_was_found_under(library, monkeypatch):
    def download(self, locator: str, work: Path) -> Path:
        path = work / "200201671.pdf"
        path.write_bytes(b"%PDF-1.4\n")
        return path

    monkeypatch.setattr(hub_acquire.AcquireService, "download_url", download)
    project = library.projects.create("Drag review")

    job = library.acquire.fetch("10.1/abc", "Drag review", "Model-based design of riblets")

    # The job keeps the project's id, whatever name it was asked by.
    assert job["projectId"] == project["id"]
    assert job["items"][0]["name"] == "200201671.pdf"
    assert job["items"][0]["title"] == "Model-based design of riblets"
