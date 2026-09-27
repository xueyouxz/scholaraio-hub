import json
from pathlib import Path

import pymupdf

from scholaraio.hub import HubLibrary
from tests.hub_client import hub_client


def test_existing_analysis_artifacts_are_read_without_rebuilding(tmp_path):
    root = tmp_path / "app"
    source = tmp_path / "paper.pdf"
    pdf_file(source)
    library = HubLibrary(root)
    try:
        pid = ingest(library, source, "Analysis.pdf")["paperId"]
        directory, meta = library.runtime.papers.find(pid)
        meta["citation_count"] = {"crossref": 3, "semantic_scholar": 6}
        meta["l3_conclusion"] = "Saved original conclusion"
        (directory / "meta.json").write_text(json.dumps(meta))
        row = library.papers.detail(pid)
        assert row["citationCount"] is None
        assert row["citationCounts"] == meta["citation_count"]
        assert row["l3Conclusion"] == "Saved original conclusion"
        state = library.runtime.cfg.state_root
        (state / "topics").mkdir(parents=True, exist_ok=True)
        (state / "projection").mkdir(parents=True, exist_ok=True)
        overview = {"built": True, "topicCount": 1, "topics": [{"id": 1, "paperCount": 2, "keywords": ["visualization"], "name": "Visualization"}]}
        projection = {"built": True, "points": [{"id": pid, "x": 1, "y": 2, "topicId": 1, "year": 2025, "title": "Analysis"}, {"id": "deleted", "topicId": 1}]}
        (state / "topics/overview.json").write_text(json.dumps(overview))
        (state / "projection/projection.json").write_text(json.dumps(projection))
        result = library.analytics.overview()
        assert [point["id"] for point in result["projection"]["points"]] == [pid]
        assert result["topics"] == overview
        assert set(result) == {"topics", "projection"}
        assert json.loads((state / "projection/projection.json").read_text()) == projection
    finally:
        library.close()


def ingest(library, source: Path, name: str = "Research.pdf") -> dict:
    """Import one file the way the queue does, without external API lookups."""
    return library.imports.import_file(source, name, no_api=True)


def pdf_file(path: Path, title: str = "Spectroscopy of Molecular Transitions"):
    """A PDF shaped like a paper, so metadata extraction has something to read."""
    with pymupdf.open() as pdf:
        page = pdf.new_page()
        page.insert_text((72, 72), title, fontsize=18)
        page.insert_text((72, 110), "Ada Lovelace, Grace Hopper", fontsize=11)
        page.insert_text((72, 140), "Abstract", fontsize=13)
        page.insert_text((72, 165), "Spectroscopy detects molecular transitions in local literature.", fontsize=11)
        pdf.save(path)


def test_import_search_duplicate_and_context(tmp_path):
    source = tmp_path / "source.pdf"
    pdf_file(source)
    library = HubLibrary(tmp_path / "app")
    try:
        first = ingest(library, source)
        # No DOI and, without MinerU, no heading to read a title from: ingested
        # anyway, with both gaps recorded and the file name as the title.
        assert first["status"] == "completed_incomplete"
        assert first["missingMetadata"] == ["doi", "title"]
        pid = first["paperId"]
        assert library.papers.detail(pid)["title"] == "Research"
        assert library.papers.detail(pid)["metadataStatus"] == "incomplete"
        again = ingest(library, source, "Another.pdf")
        assert (again["status"], again["paperId"]) == ("duplicate", pid)
        library.runtime.reindex()
        results = library.search.keyword("molecular")
        assert results[0]["paper"]["id"] == pid
        assert results[0]["matches"][0]["start_line"] >= 1
        assert library.retrieval.context("Summarize", [pid])["citations"][0]["paperId"] == pid
        assert library.papers.detail(pid)["hasPdf"]
        assert library.retrieval.context("What does spectroscopy detect?", [])["citations"][0]["paperId"] == pid
        assert library.search.keyword("???") == []
        assert library.search.keyword("OR") == []
    finally:
        library.close()


def test_pdf_range_and_position(tmp_path):
    source = tmp_path / "source.pdf"
    pdf_file(source)
    with hub_client(tmp_path / "app") as client:
        pid = ingest(client.app.state.library, source, "Paper.pdf")["paperId"]
        response = client.get(f"/papers/{pid}/pdf", headers={"Range": "bytes=0-19"})
        assert response.status_code == 206
        assert len(response.content) == 20
        assert client.put(f"/papers/{pid}/position", json={"page": 2, "line": 3, "mode": "markdown"}).status_code == 200
        assert client.get(f"/papers/{pid}/position").json()["data"]["page"] == 2
        assert client.get("/papers/unknown").status_code == 404


def test_an_unparseable_pdf_is_kept_for_retry_and_not_half_ingested(tmp_path):
    source = tmp_path / "bad.pdf"
    source.write_bytes(b"bad pdf")
    library = HubLibrary(tmp_path / "app")
    try:
        result = ingest(library, source, "bad.pdf")
        assert result["status"] == "failed"
        assert result["error"]
        # Nothing half-written into the library, and the upload survives a retry.
        assert library.papers.list() == []
        assert Path(result["source"]).exists()
    finally:
        library.close()


def test_attachment_boundaries_and_batch_results(tmp_path):
    import time
    source = tmp_path / "source.pdf"
    pdf_file(source)
    with hub_client(tmp_path / "app") as client:
        pid = ingest(client.app.state.library, source, "Paper.pdf")["paperId"]
        directory, _ = client.app.state.library.runtime.papers.find(pid)
        (directory / "images").mkdir()
        (directory / "images/a.png").write_bytes(b"image")
        assert client.get(f"/papers/{pid}/attachments/images/a.png").content == b"image"
        assert client.get(f"/papers/{pid}/attachments/meta.json").status_code == 422
        (directory / "images/outside.png").symlink_to(source)
        assert client.get(f"/papers/{pid}/attachments/images/outside.png").status_code == 404
        response = client.post("/imports", files=[("files", ("duplicate.pdf", source.read_bytes(), "application/pdf")), ("files", ("broken.pdf", b"broken", "application/pdf"))])
        assert response.status_code == 202
        for _ in range(100):
            jobs = client.get("/imports").json()["data"]["jobs"]
            job = next(j for j in jobs if j["id"] == response.json()["data"]["id"])
            if all(item["status"] in ("complete", "duplicate", "failed") for item in job["items"]):
                break
            time.sleep(0.02)
        assert {item["status"] for item in job["items"]} == {"duplicate", "failed"}


def test_projects_membership_scope_and_restart(tmp_path):
    root = tmp_path / "app"
    source = tmp_path / "source.pdf"
    pdf_file(source)
    with hub_client(root) as client:
        pid = ingest(client.app.state.library, source, "Paper.pdf")["paperId"]
        assert client.post("/projects", json={"name": "文献项目"}).status_code == 201
        assert client.post("/projects", json={"name": "文献项目"}).status_code == 422
        assert client.post("/context", json={"query": "molecular", "projectId": "文献项目"}).json()["data"]["citations"] == []
        assert client.post("/scope", json={"projectId": "文献项目", "paperIds": [pid]}).status_code == 422
        for _ in range(2):
            response = client.post("/projects/文献项目/papers", json={"paperIds": [pid], "action": "add"})
            assert response.status_code == 200
            assert response.json()["data"]["paperCount"] == 1
        refs = root / "workspace/文献项目/refs/papers.json"
        assert refs.exists()
        context = client.post("/context", json={"query": "总结", "projectId": "文献项目"}).json()["data"]
        assert {c["paperId"] for c in context["citations"]} == {pid}
        assert client.post("/scope", json={"projectId": "missing"}).status_code == 404
    with hub_client(root) as client:
        assert client.get("/projects").json()["data"]["projects"][0]["paperIds"] == [pid]
        assert client.post("/projects/文献项目/papers", json={"paperIds": [pid], "action": "remove"}).json()["data"]["paperCount"] == 0
        assert client.post("/context", json={"query": "molecular", "projectId": "文献项目"}).json()["data"]["citations"] == []
        assert client.post("/context", json={"query": "molecular"}).json()["data"]["citations"]


def test_project_boundaries_and_invalid_indexes(tmp_path):
    import json

    from scholaraio.projects.workspace import create
    root = tmp_path / "app"
    with hub_client(root) as client:
        for name in ["../outside", "a/b", ".hidden", "C:drive", " invalid ", "\n"]:
            assert client.post("/projects", json={"name": name}).status_code == 422
        external = tmp_path / "external"
        create(external)
        ws_root = client.app.state.library.runtime.cfg.workspace_dir
        ws_root.mkdir(parents=True, exist_ok=True)
        (ws_root / "escape").symlink_to(external, target_is_directory=True)
        assert client.get("/projects/escape").status_code == 422
        (ws_root / "escape").unlink()
        legacy = ws_root / "legacy"
        legacy.mkdir()
        (legacy / "papers.json").write_text("[]")
        assert "refs/papers.json" in client.get("/projects").json()["message"]
        (legacy / "papers.json").unlink()
        assert client.post("/projects", json={"name": "valid"}).status_code == 201
        index = ws_root / "valid/refs/papers.json"
        index.write_text("{broken")
        assert client.get("/projects/valid").status_code == 500
        index.write_text(json.dumps(["old-paper-id"]))
        assert client.get("/projects/valid").json()["data"]["paperIds"] == ["old-paper-id"]
        # Missing papers in an otherwise valid project never broaden its scope.
        assert client.post("/context", json={"query": "molecular", "projectId": "valid"}).json()["data"]["citations"] == []
        index.unlink()
        index.symlink_to(external / "refs/papers.json")
        assert client.get("/projects/valid").status_code == 422


def test_original_search_modes_and_image_gallery_are_scoped(tmp_path, monkeypatch):
    source = tmp_path / "paper.pdf"
    pdf_file(source)
    library = HubLibrary(tmp_path / "app")
    try:
        pid = ingest(library, source)["paperId"]
        directory, meta = library.runtime.papers.find(pid)
        meta["authors"] = ["张三", "Alice Smith"]
        (directory / "meta.json").write_text(json.dumps(meta))
        images = directory / "images"
        images.mkdir(exist_ok=True)
        (images / "first.png").write_bytes(b"image")
        (images / "second.jpg").write_bytes(b"image")
        (images / "metadata.txt").write_text("not an image")
        (images / "outside.png").symlink_to(source)
        assert library.papers.images(pid) == ["first.png", "second.jpg"]
        assert library.search.browse("张三", "author", 20)["results"][0]["paper"]["id"] == pid
        assert library.search.browse("molecular", "author", 20)["results"] == []
        assert library.search.browse("molecular", "keyword", 20)["results"][0]["paper"]["id"] == pid
        for mode in ("author", "keyword", "unified", "semantic"):
            assert library.search.browse("张三", mode, 20, set())["results"] == []
        def unified(query, db, **kwargs):
            assert kwargs["paper_ids"] == {pid}
            return [{"paper_id": pid}, {"paper_id": "deleted"}], {"vector_degraded": True}
        monkeypatch.setattr("scholaraio.services.index.unified_search", unified)
        result = library.search.browse("research", "unified", 20, {pid})
        assert [r["paper"]["id"] for r in result["results"]] == [pid]
        assert result["notice"]
    finally:
        library.close()


def test_cli_shares_the_application_library_through_the_generated_config(tmp_path, monkeypatch):
    """An agent's CLI run must resolve the same paths as the Hub service."""
    from scholaraio.core.config import load_config
    from scholaraio.hub.config import config_path

    root = tmp_path / "app"
    source = tmp_path / "source.pdf"
    pdf_file(source)
    library = HubLibrary(root)
    try:
        pid = ingest(library, source, "Shared.pdf")["paperId"]
        assert config_path(root).exists()
        elsewhere = tmp_path / "unrelated-cwd"
        elsewhere.mkdir()
        monkeypatch.chdir(elsewhere)
        monkeypatch.setenv("SCHOLARAIO_CONFIG", str(config_path(root)))
        cli_cfg = load_config()
        assert cli_cfg.papers_dir == library.runtime.cfg.papers_dir
        assert cli_cfg.index_db == library.runtime.cfg.index_db
        assert cli_cfg.workspace_dir == library.runtime.cfg.workspace_dir
        assert (cli_cfg.papers_dir / library.runtime.papers.find(pid)[0].name).is_dir()
    finally:
        library.close()


def test_an_existing_configuration_is_never_rewritten(tmp_path):
    from scholaraio.hub.config import config_path

    root = tmp_path / "app"
    root.mkdir()
    config_path(root).write_text("paths:\n  papers_dir: data/libraries/papers\n", encoding="utf-8")
    library = HubLibrary(root)
    try:
        assert config_path(root).read_text(encoding="utf-8").startswith("paths:")
    finally:
        library.close()


def test_projects_can_be_renamed_and_archived(tmp_path):
    root = tmp_path / "app"
    source = tmp_path / "source.pdf"
    pdf_file(source)
    with hub_client(root) as client:
        library = client.app.state.library
        pid = ingest(library, source, "Paper.pdf")["paperId"]
        project = client.post("/projects", json={"name": "review"}).json()["data"]
        client.post("/projects/review/papers", json={"paperIds": [pid], "action": "add"})

        renamed = client.post(f"/projects/{project['id']}/rename", json={"name": "survey"})
        assert renamed.status_code == 200
        # A rename keeps the id: everything that refers to the project still does.
        assert renamed.json()["data"]["id"] == project["id"]
        assert renamed.json()["data"]["paperIds"] == [pid]
        assert client.get("/projects/review").status_code == 404
        assert client.get(f"/projects/{project['id']}").json()["data"]["name"] == "survey"
        assert [p["name"] for p in client.get("/projects").json()["data"]["projects"]] == ["survey"]

        archived = client.delete(f"/projects/{project['id']}")
        assert archived.status_code == 200
        assert archived.json()["data"]["id"] == project["id"]
        assert client.get(f"/projects/{project['id']}").status_code == 404
        assert client.get("/projects").json()["data"]["projects"] == []
        # Archived, not deleted: the agent's work is still on disk.
        assert Path(archived.json()["data"]["path"]).is_dir()
        assert library.papers.detail(pid)["id"] == pid


def test_renaming_onto_an_existing_project_is_refused(tmp_path):
    with hub_client(tmp_path / "app") as client:
        client.post("/projects", json={"name": "review"})
        client.post("/projects", json={"name": "survey"})
        response = client.post("/projects/review/rename", json={"name": "survey"})
        assert response.status_code == 422
        assert client.get("/projects/review").status_code == 200


def test_a_new_project_tells_an_agent_what_the_directory_is(tmp_path):
    library = HubLibrary(tmp_path / "app")
    try:
        project = library.projects.create("review")
        directory = Path(project["path"])
        guide = (directory / "AGENTS.md").read_text(encoding="utf-8")
        assert "--ws review" in guide
        assert (directory / "outputs").is_dir()
        assert (directory / "refs" / "papers.json").is_file()

        # The file belongs to the project once it exists.
        (directory / "AGENTS.md").write_text("我的说明", encoding="utf-8")
        library.projects.scaffold(directory, "review")
        assert (directory / "AGENTS.md").read_text(encoding="utf-8") == "我的说明"
    finally:
        library.close()


def ingest_with_meta(library, tmp_path, name: str, doi: str, references: list[str] | None = None):
    """Import a paper and give it the identifiers an API lookup would have."""
    source = tmp_path / f"{name}.pdf"
    pdf_file(source, title=name)
    pid = ingest(library, source, f"{name}.pdf")["paperId"]
    directory, meta = library.runtime.papers.find(pid)
    meta.update(doi=doi, title=name, year=2024, references=references or [])
    (directory / "meta.json").write_text(json.dumps(meta), encoding="utf-8")
    library.runtime.reindex()
    return pid


def test_citation_views_follow_the_relations_ingestion_recorded(tmp_path):
    library = HubLibrary(tmp_path / "app")
    try:
        cited = ingest_with_meta(library, tmp_path, "Foundations", "10.1/foundations")
        citing_a = ingest_with_meta(
            library, tmp_path, "FollowUpA", "10.1/a", ["10.1/foundations", "10.9/outside"]
        )
        citing_b = ingest_with_meta(
            library, tmp_path, "FollowUpB", "10.1/b", ["10.1/foundations", "10.9/outside"]
        )

        references = library.citations.references(citing_a)["references"]
        assert [r["paper"]["id"] if r["paper"] else r["doi"] for r in references] == [
            cited,
            "10.9/outside",
        ]
        assert {p["id"] for p in library.citations.citing(cited)["citing"]} == {citing_a, citing_b}

    finally:
        library.close()


def test_citation_views_respect_the_project_scope(tmp_path):
    library = HubLibrary(tmp_path / "app")
    try:
        cited = ingest_with_meta(library, tmp_path, "Foundations", "10.1/foundations")
        citing = ingest_with_meta(library, tmp_path, "FollowUp", "10.1/a", ["10.1/foundations"])
        library.projects.create("narrow")
        library.projects.update_papers("narrow", [cited], "add")

        assert library.citations.citing(cited, "narrow")["citing"] == []
        assert library.citations.citing(cited)["citing"][0]["id"] == citing
    finally:
        library.close()


def test_filling_in_a_missing_doi_clears_the_incomplete_mark(tmp_path):
    source = tmp_path / "source.pdf"
    pdf_file(source)
    with hub_client(tmp_path / "app") as client:
        library = client.app.state.library
        pid = ingest(library, source, "Research.pdf")["paperId"]
        assert library.papers.detail(pid)["metadataStatus"] == "incomplete"

        response = client.patch(
            f"/papers/{pid}",
            json={"doi": " 10.1/known ", "title": "Spectroscopy", "authors": ["Ada Lovelace", " "]},
        )
        assert response.status_code == 200
        assert response.json()["data"]["metadataStatus"] == "complete"
        assert response.json()["data"]["doi"] == "10.1/known"
        assert response.json()["data"]["authors"] == "Ada Lovelace"
        # The correction is searchable, not just stored.
        assert library.search.keyword("spectroscopy")[0]["paper"]["id"] == pid

        assert client.patch(f"/papers/{pid}", json={}).status_code == 422
        assert client.patch(f"/papers/{pid}", json={"year": "not a year"}).status_code == 422


def test_a_paper_without_a_doi_cannot_be_refetched(tmp_path):
    source = tmp_path / "source.pdf"
    pdf_file(source)
    with hub_client(tmp_path / "app") as client:
        pid = ingest(client.app.state.library, source, "Research.pdf")["paperId"]
        response = client.post(f"/papers/{pid}/refetch")
        assert response.status_code == 422
        assert "DOI" in response.json()["message"]


def test_a_project_from_before_ids_is_given_one_that_lasts(tmp_path):
    from scholaraio.projects.workspace import create

    root = tmp_path / "app"
    with hub_client(root) as client:
        # A project an older Hub made: a directory with a paper index and no id.
        create(client.app.state.library.projects.root / "legacy")
        listed = client.get("/projects").json()["data"]["projects"]
        assert [p["name"] for p in listed] == ["legacy"]
        project_id = listed[0]["id"]
        assert client.get("/projects/legacy").json()["data"]["id"] == project_id
    with hub_client(root) as client:
        assert client.get(f"/projects/{project_id}").json()["data"]["name"] == "legacy"


def test_a_project_cannot_be_named_like_an_id(tmp_path):
    with hub_client(tmp_path / "app") as client:
        response = client.post("/projects", json={"name": "3f2b7c1e-0000-4000-8000-000000000000"})
        assert response.status_code == 422
