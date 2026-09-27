"""The browser can prepare semantic search, and stop it part-way."""
from __future__ import annotations

import json
import time

import pytest

from scholaraio.hub import HubLibrary
from scholaraio.services import vectors


@pytest.fixture
def library(tmp_path):
    library = HubLibrary(tmp_path / "app")
    try:
        yield library
    finally:
        library.close()


@pytest.fixture(autouse=True)
def embedding_runtime(monkeypatch):
    """The optional embedding packages are absent here; assume them installed."""
    monkeypatch.setattr(vectors, "runtime_available", lambda: True)


def wait_for(library, kind: str, *, timeout: float = 10.0) -> dict:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        task = next(t for t in library.tasks.list() if t["kind"] == kind)
        if task["status"] not in ("queued", "running"):
            return task
        time.sleep(0.01)
    raise AssertionError(f"{kind} task did not finish in time")


def paper(library, title: str = "Spectroscopy") -> None:
    directory = library.runtime.cfg.papers_dir / title.lower()
    directory.mkdir(parents=True, exist_ok=True)
    (directory / "meta.json").write_text(json.dumps({"id": title.lower(), "title": title}), encoding="utf-8")
    (directory / "paper.md").write_text(f"# {title}\n\nText.\n", encoding="utf-8")


def test_preparing_semantic_search_downloads_the_model_then_embeds(library, monkeypatch):
    downloads = []
    monkeypatch.setattr(vectors, "prepare_model", lambda cfg=None: downloads.append(cfg.embed.model))
    monkeypatch.setattr(
        vectors,
        "build_vectors",
        lambda papers, db, cfg=None, on_progress=None, should_stop=None: (on_progress(2, 2), 2)[1],
    )

    library.tasks.start("semantic")
    task = wait_for(library, "semantic")

    assert downloads == [library.runtime.cfg.embed.model]
    assert task["status"] == "completed"
    assert task["summary"] == "Added embeddings for 2 papers"
    assert (task["done"], task["total"]) == (2, 2)


def test_a_running_task_stops_where_it_is_and_keeps_its_work(library, monkeypatch):
    started = __import__("threading").Event()

    def build(papers, db, cfg=None, on_progress=None, should_stop=None):
        on_progress(1, 10)
        started.set()
        while not should_stop():
            time.sleep(0.01)
        return 1

    monkeypatch.setattr(vectors, "prepare_model", lambda cfg=None: None)
    monkeypatch.setattr(vectors, "build_vectors", build)

    library.tasks.start("semantic")
    assert started.wait(5)
    library.tasks.cancel("semantic")
    task = wait_for(library, "semantic")

    assert task["status"] == "cancelled"
    assert task["done"] == 1  # what it embedded before stopping is kept


def test_one_task_of_a_kind_runs_at_a_time(library, monkeypatch):
    monkeypatch.setattr(vectors, "prepare_model", lambda cfg=None: time.sleep(0.2))
    monkeypatch.setattr(vectors, "build_vectors", lambda *a, **k: 0)

    library.tasks.start("semantic")
    with pytest.raises(ValueError, match="already running"):
        library.tasks.start("semantic")
    wait_for(library, "semantic")


def test_a_failed_task_reports_why(library, monkeypatch):
    monkeypatch.setattr(vectors, "embedding_provider", lambda cfg=None: "none")

    library.tasks.start("semantic")
    task = wait_for(library, "semantic")

    assert task["status"] == "failed"
    assert "embed.provider=none" in task["error"]


def test_semantic_search_says_when_its_packages_are_missing(library, monkeypatch):
    monkeypatch.setattr(vectors, "runtime_available", lambda: False)

    library.tasks.start("semantic")
    task = wait_for(library, "semantic")

    assert task["status"] == "failed"
    assert "Vector dependencies" in task["error"]
    assert library.status.readiness()["vectorRuntimeReady"] is False


def test_deep_processing_needs_a_key_and_counts_what_is_pending(library, monkeypatch):
    paper(library)
    monkeypatch.setattr(type(library.runtime.cfg), "resolved_api_key", lambda _self: "")

    assert library.status.readiness()["deepPending"] == 1
    assert library.status.readiness()["llmConfigured"] is False

    library.tasks.start("deep")
    task = wait_for(library, "deep")
    assert task["status"] == "failed"
    assert "LLM API key" in task["error"]


def test_status_describes_what_the_library_can_already_do(library, monkeypatch):
    paper(library)
    monkeypatch.setattr(vectors, "model_available", lambda cfg=None: False)
    library.runtime.reindex()

    status = library.status.readiness()

    assert status["papers"] == 1
    assert status["vectors"] == 0
    assert status["semanticReady"] is False
    assert status["modelReady"] is False
    assert status["topicsBuilt"] is False


def test_an_interrupted_task_is_restartable_after_a_restart(library, tmp_path):
    record = {"id": "x", "kind": "semantic", "status": "running", "phase": "embed",
              "done": 3, "total": 9, "summary": None, "error": None,
              "startedAt": "2026-01-01T00:00:00+00:00", "finishedAt": None}
    (library.runtime.cfg.state_root / "tasks").mkdir(parents=True, exist_ok=True)
    (library.runtime.cfg.state_root / "tasks/semantic.json").write_text(json.dumps(record), encoding="utf-8")

    restarted = HubLibrary(tmp_path / "app")
    try:
        task = next(t for t in restarted.tasks.list() if t["kind"] == "semantic")
    finally:
        restarted.close()

    assert task["status"] == "failed"
    assert "can be restarted" in task["error"]


def hold_semantic(monkeypatch) -> tuple:
    """Keep semantic preparation running until the test releases it."""
    threading = __import__("threading")
    started, release = threading.Event(), threading.Event()

    def prepare(cfg=None):
        started.set()
        release.wait(5)

    monkeypatch.setattr(vectors, "prepare_model", prepare)
    monkeypatch.setattr(vectors, "build_vectors", lambda *a, **k: 0)
    return started, release


def test_work_on_other_files_does_not_wait_behind_a_long_task(library, monkeypatch):
    started, release = hold_semantic(monkeypatch)
    library.tasks.start("semantic")
    assert started.wait(5)

    # Quality writes abstracts, not vectors: it runs while semantic is still going.
    library.tasks.start("quality")
    assert wait_for(library, "quality")["status"] == "completed"
    release.set()
    wait_for(library, "semantic")


def test_a_queued_task_says_what_it_waits_for_and_stops_at_once(library, monkeypatch):
    started, release = hold_semantic(monkeypatch)
    library.tasks.start("semantic")
    assert started.wait(5)

    library.tasks.start("topics")
    queued = next(t for t in library.tasks.list() if t["kind"] == "topics")
    assert (queued["status"], queued["waitingFor"]) == ("queued", "semantic")

    stopped = library.tasks.cancel("topics")
    assert stopped["status"] == "cancelled"
    release.set()
    wait_for(library, "semantic")
    time.sleep(0.05)
    # Its turn came after it was stopped: it never ran.
    assert next(t for t in library.tasks.list() if t["kind"] == "topics")["status"] == "cancelled"


def test_quality_fills_only_missing_abstracts_one_paper_at_a_time(library, monkeypatch):
    from scholaraio.services import ingest_metadata

    paper(library, "Missing")
    paper(library, "Present")
    present = library.runtime.cfg.papers_dir / "present" / "meta.json"
    present.write_text(json.dumps({"id": "present", "title": "Present", "abstract": "Kept.", "doi": "10.1/x"}))
    asked = []
    monkeypatch.setattr(ingest_metadata, "fetch_abstract_by_doi", lambda doi: asked.append(doi) or None)
    monkeypatch.setattr(ingest_metadata, "extract_abstract_from_md", lambda path, cfg=None: "From the text.")

    library.tasks.start("quality")
    task = wait_for(library, "quality")

    assert asked == []  # the paper that has an abstract is not fetched again
    assert (task["done"], task["total"]) == (1, 1)
    assert task["summary"] == "Completed 1 abstracts"
    assert json.loads((library.runtime.cfg.papers_dir / "missing" / "meta.json").read_text())["abstract"] == "From the text."
    assert json.loads(present.read_text())["abstract"] == "Kept."
