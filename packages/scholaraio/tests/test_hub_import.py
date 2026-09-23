"""The browser's import queue runs the real ingest pipeline."""
from __future__ import annotations

import time
from pathlib import Path

import pymupdf
import pytest

from scholaraio.services.hub_library import HubLibrary
from scholaraio.services.ingest import identifiers


def paper_pdf(path: Path, title: str = "Spectroscopy of Molecular Transitions") -> None:
    with pymupdf.open() as pdf:
        page = pdf.new_page()
        page.insert_text((72, 72), title, fontsize=18)
        page.insert_text((72, 110), "Ada Lovelace", fontsize=11)
        page.insert_text((72, 140), "Abstract", fontsize=13)
        page.insert_text((72, 165), "Spectroscopy detects molecular transitions.", fontsize=11)
        pdf.save(path)


@pytest.fixture
def library(tmp_path):
    library = HubLibrary(tmp_path / "app")
    try:
        yield library
    finally:
        library.close()


def wait_for_job(library, job_id: str, *, timeout: float = 60.0) -> dict:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        job = next(j for j in library.list_jobs() if j["id"] == job_id)
        if all(item["status"] not in ("queued", "running") for item in job["items"]):
            return job
        time.sleep(0.02)
    raise AssertionError("Import did not finish in time")


def staged(library, source: Path, name: str) -> tuple[Path, str]:
    """Copy a file into the queue's staging area the way an upload does."""
    destination = library.imports.stage(name)
    destination.write_bytes(source.read_bytes())
    return destination, name


def test_uploads_are_staged_outside_every_scanned_inbox(library, tmp_path):
    source = tmp_path / "paper.pdf"
    paper_pdf(source)
    destination, _ = staged(library, source, "paper.pdf")

    assert destination.is_relative_to(library.cfg.state_root)
    assert not destination.is_relative_to(library.cfg.inbox_dir)


def test_a_batch_reports_each_file_and_leaves_the_library_searchable(library, tmp_path, monkeypatch):
    # The pipeline's external metadata lookups are not part of this test.
    monkeypatch.setattr(
        "scholaraio.services.ingest_metadata.enrich_metadata", lambda meta: meta, raising=False
    )
    good = tmp_path / "good.pdf"
    paper_pdf(good)
    broken = tmp_path / "broken.pdf"
    broken.write_bytes(b"not a pdf")

    job = library.imports.enqueue(
        [staged(library, good, "Spectroscopy.pdf"), staged(library, broken, "Broken.pdf")]
    )
    finished = wait_for_job(library, job["id"])
    results = {item["name"]: item for item in finished["items"]}

    assert results["Spectroscopy.pdf"]["status"] in ("completed", "completed_incomplete")
    assert results["Spectroscopy.pdf"]["paperId"]
    assert results["Broken.pdf"]["status"] == "failed"
    assert results["Broken.pdf"]["error"]
    # A finished import is immediately searchable: the batch reindexed once.
    assert library.search("spectroscopy")[0]["paper"]["id"] == results["Spectroscopy.pdf"]["paperId"]
    # Progress fields are cleared once an item stops running.
    assert all(item.get("step") is None for item in finished["items"])


def test_a_failed_item_can_be_retried_from_its_kept_file(library, tmp_path):
    broken = tmp_path / "broken.pdf"
    broken.write_bytes(b"not a pdf")

    job = library.imports.enqueue([staged(library, broken, "Broken.pdf")])
    finished = wait_for_job(library, job["id"])
    kept = Path(finished["items"][0]["source"])
    assert kept.exists()

    retried = wait_for_job(library, library.imports.retry(job["id"])["id"])
    assert retried["items"][0]["status"] == "failed"
    assert Path(retried["items"][0]["source"]).exists()


def test_the_same_file_is_recognised_without_a_doi(library, tmp_path):
    source = tmp_path / "paper.pdf"
    paper_pdf(source)

    first = library.imports.import_file(source, "Paper.pdf", no_api=True)
    again = library.imports.import_file(source, "Copy of Paper.pdf", no_api=True)

    assert first["status"] == "completed_incomplete"
    assert again == {"status": "duplicate", "paperId": first["paperId"], "error": None}


def test_extraction_falls_back_to_regex_without_an_llm_key(library, monkeypatch):
    library.cfg.ingest.extractor = "robust"
    monkeypatch.setattr(type(library.cfg), "resolved_api_key", lambda _self: "")
    assert library.imports.extraction_config().ingest.extractor == "regex"

    monkeypatch.setattr(type(library.cfg), "resolved_api_key", lambda _self: "key")
    assert library.imports.extraction_config().ingest.extractor == "robust"


def test_papers_ingested_here_are_visible_to_the_pipeline_dedup(library, tmp_path):
    source = tmp_path / "paper.pdf"
    paper_pdf(source)
    library.imports.import_file(source, "Paper.pdf", no_api=True)

    dois, pub_nums, arxiv_ids = identifiers.collect_existing_ids(library.cfg.papers_dir)
    assert (dois, pub_nums, arxiv_ids) == ({}, {}, {})  # no DOI was found, and none was invented
    assert len(library.papers()) == 1
