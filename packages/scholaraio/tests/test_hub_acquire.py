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
    assert staged.is_relative_to(library.cfg.state_root)


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


BIBTEX = """
@article{lovelace2024,
  title = {Spectroscopy of Molecules},
  doi = {10.1038/s41586-021-03819-2},
}
@inproceedings{hopper2019,
  title = {Compiling Programs},
  doi = {10.1000/xyz123},
}
@misc{preprint2024,
  title = {A Preprint},
  eprint = {arXiv:2401.12345},
  url = {https://arxiv.org/abs/2401.12345},
}
"""

RIS = """TY  - JOUR
TI  - Spectroscopy of Molecules
DO  - 10.1038/s41586-021-03819-2
ER  -
"""


def test_a_bibtex_export_yields_one_locator_per_entry():
    entries = hub_acquire.parse_references(BIBTEX)

    assert [entry["locator"] for entry in entries] == [
        "10.1038/s41586-021-03819-2",
        "10.1000/xyz123",
        "2401.12345",
    ]
    assert entries[0]["title"] == "Spectroscopy of Molecules"


def test_a_ris_export_is_read_the_same_way():
    assert hub_acquire.parse_references(RIS) == [
        {"locator": "10.1038/s41586-021-03819-2", "title": "Spectroscopy of Molecules"}
    ]


def test_entries_that_cannot_be_fetched_are_reported_not_hidden(library, monkeypatch):
    def download(self, locator, work):
        if locator == "10.1000/xyz123":
            raise ValueError("未能获取 PDF：paywalled")
        path = work / f"{locator.replace('/', '-')}.pdf"
        path.write_bytes(b"%PDF-1.4\n")
        return path, "doi"

    monkeypatch.setattr(hub_acquire.AcquireService, "download", download)

    result = library.acquire.import_references(BIBTEX)

    assert len(result["items"]) == 2
    assert [entry["title"] for entry in result["skipped"]] == ["Compiling Programs"]


def test_a_file_with_no_entries_says_so(library):
    with pytest.raises(ValueError, match="没有从该文件中解析出条目"):
        library.acquire.import_references("just some prose")
