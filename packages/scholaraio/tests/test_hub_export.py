"""Exporting references, and checking a draft's citations against the library."""
from __future__ import annotations

import json

import pytest

from scholaraio.hub import HubLibrary


@pytest.fixture
def library(tmp_path):
    library = HubLibrary(tmp_path / "app")
    try:
        yield library
    finally:
        library.close()


def paper(library, paper_id: str, title: str, author: str, year: int) -> None:
    directory = library.cfg.papers_dir / paper_id
    directory.mkdir(parents=True, exist_ok=True)
    (directory / "meta.json").write_text(
        json.dumps(
            {
                "id": paper_id,
                "title": title,
                "authors": [author],
                "year": year,
                "journal": "Nature",
                "doi": f"10.1000/{paper_id}",
            }
        ),
        encoding="utf-8",
    )
    (directory / "paper.md").write_text(f"# {title}\n", encoding="utf-8")


def test_a_selection_exports_as_bibtex(library):
    paper(library, "alpha", "Spectroscopy of Molecules", "Ada Lovelace", 2024)
    paper(library, "beta", "Unrelated Work", "Grace Hopper", 2019)
    library.reindex()

    result = library.exports.export(["alpha"], None, "bibtex")

    assert result["filename"].endswith(".bib")
    assert "Spectroscopy of Molecules" in result["content"]
    assert "Unrelated Work" not in result["content"]


def test_a_project_exports_as_a_markdown_reference_list(library):
    paper(library, "alpha", "Spectroscopy of Molecules", "Ada Lovelace", 2024)
    library.reindex()
    library.projects.create("综述")
    library.projects.update_papers("综述", ["alpha"], "add")

    result = library.exports.export([], "综述", "markdown", "apa")

    assert result["filename"].startswith("综述-")
    assert "Lovelace" in result["content"]


def test_an_unknown_format_is_refused(library):
    with pytest.raises(ValueError, match="导出格式"):
        library.exports.export([], None, "docx")


def test_a_draft_reports_which_citations_the_library_backs(library):
    paper(library, "alpha", "Spectroscopy of Molecules", "Lovelace", 2024)
    library.reindex()

    result = library.exports.check("As shown by Lovelace (2024), and by Babbage (1850), …")

    statuses = {entry["author"]: entry["status"] for entry in result["citations"]}
    assert statuses["Lovelace"] == "VERIFIED"
    assert statuses["Babbage"] == "NOT_IN_LIBRARY"
    assert (result["verified"], result["missing"]) == (1, 1)


def test_a_draft_without_citations_is_not_an_error(library):
    assert library.exports.check("没有任何引用的正文。")["citations"] == []
