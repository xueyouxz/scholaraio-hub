"""Searching the open web for papers the library could fetch."""
from __future__ import annotations

import pytest

from scholaraio.hub import HubLibrary
from scholaraio.hub import discover as hub_discover


@pytest.fixture
def library(tmp_path, monkeypatch):
    monkeypatch.delenv("SCHOLARAIO_HUB_NO_API", raising=False)
    library = HubLibrary(tmp_path / "app")
    try:
        yield library
    finally:
        library.close()


def openalex_item(doi: str, title: str, **extra) -> dict:
    return {
        "id": f"https://openalex.org/{doi}",
        "title": title,
        "doi": f"https://doi.org/{doi}",
        "publication_year": 2024,
        "authorships": [{"author": {"display_name": "Ada Lovelace"}}],
        "primary_location": {"source": {"display_name": "Nature"}},
        "open_access": {"is_oa": True, "oa_url": "https://example.org/paper.pdf"},
        "cited_by_count": 7,
        **extra,
    }


def test_results_carry_a_locator_the_import_queue_understands(library, monkeypatch):
    monkeypatch.setattr(
        hub_discover.DiscoverService, "openalex",
        lambda self, query, limit: [hub_discover.openalex_row(openalex_item("10.1/abc", "Turbulent <i>drag</i>"))],
    )
    monkeypatch.setattr(
        hub_discover.DiscoverService, "arxiv",
        lambda self, query, limit: [hub_discover.arxiv_row({"arxiv_id": "2401.12345", "title": "A preprint",
                                                            "authors": ["Grace Hopper"], "year": "2024"})],
    )

    results = library.discover.search("drag")["results"]

    by_locator = {row["locator"]: row for row in results}
    assert by_locator["10.1/abc"]["title"] == "Turbulent drag"
    assert by_locator["10.1/abc"]["authors"] == ["Ada Lovelace"]
    assert by_locator["arXiv:2401.12345"]["year"] == 2024
    assert all(row["paperId"] is None for row in results)


def test_one_source_failing_leaves_the_other_answering(library, monkeypatch):
    def down(self, query, limit):
        raise ConnectionError("OpenAlex unreachable")

    monkeypatch.setattr(hub_discover.DiscoverService, "openalex", down)
    monkeypatch.setattr(
        hub_discover.DiscoverService, "arxiv",
        lambda self, query, limit: [hub_discover.arxiv_row({"arxiv_id": "2401.12345", "title": "A preprint"})],
    )

    answer = library.discover.search("drag")

    assert [row["locator"] for row in answer["results"]] == ["arXiv:2401.12345"]
    assert answer["errors"] == [{"source": "OpenAlex", "error": "OpenAlex unreachable"}]


def test_a_work_listed_by_both_sources_appears_once():
    rows = [
        hub_discover.openalex_row(openalex_item("10.48550/arxiv.2401.12345", "A Preprint")),
        hub_discover.arxiv_row({"arxiv_id": "2401.12345v2", "title": "A preprint"}),
    ]

    merged = hub_discover.merge(rows)

    assert len(merged) == 1
    assert merged[0]["source"] == "arxiv"


def test_a_paper_the_library_holds_is_marked(library, monkeypatch):
    directory = library.runtime.cfg.papers_dir / "Lovelace-2024-Drag"
    directory.mkdir(parents=True)
    (directory / "meta.json").write_text('{"id": "p-1", "title": "Drag", "doi": "10.1/ABC"}', encoding="utf-8")
    monkeypatch.setattr(
        hub_discover.DiscoverService, "openalex",
        lambda self, query, limit: [hub_discover.openalex_row(openalex_item("10.1/abc", "Drag"))],
    )
    monkeypatch.setattr(hub_discover.DiscoverService, "arxiv", lambda self, query, limit: [])

    assert library.discover.search("drag")["results"][0]["paperId"] == "p-1"


def test_an_empty_query_asks_nothing(library, monkeypatch):
    def refuse(*_args):
        raise AssertionError("no source should be asked")

    monkeypatch.setattr(hub_discover.DiscoverService, "openalex", refuse)
    assert library.discover.search("   ") == {"results": [], "errors": []}
