"""Portable documents, malicious archives, categories and compatible vectors."""
from __future__ import annotations

import json
import sqlite3
import struct
from zipfile import ZIP_DEFLATED, ZipFile

import pytest

from scholaraio.hub import HubLibrary
from scholaraio.hub.errors import InvalidRequest, TooLarge
from scholaraio.hub.storage import atomic_json
from scholaraio.services import vectors


def seed(library):
    directory = library.runtime.cfg.papers_dir / "alpha"
    directory.mkdir()
    atomic_json(directory / "meta.json", {"id": "alpha", "title": "Alpha", "abstract": "Science", "journal": "CVPR", "authors": ["Alice"], "year": None})
    (directory / "paper.md").write_text("# Alpha\nScience about molecular spectroscopy", encoding="utf-8")
    library.runtime.reindex()
    return directory


def test_bundle_roundtrip_and_vectors(tmp_path):
    first, second = HubLibrary(tmp_path / "a"), HubLibrary(tmp_path / "b")
    try:
        directory = seed(first)
        (directory / "reading-position.json").write_text('{"private":true}')
        assert first.papers.list()[0]["category"] == "CVPR"
        assert first.papers.categorize(["alpha"], "我的类别") == {"updated": 1}
        assert first.papers.list()[0]["categorySource"] == "manual"
        first.papers.categorize(["alpha"], None)
        assert first.papers.list()[0]["category"] == "CVPR"
        with sqlite3.connect(first.runtime.cfg.index_db) as conn:
            vectors._ensure_schema(conn)
            vectors._set_vector_meta(conn, "embed_signature", vectors._embed_signature(first.runtime.cfg))
            conn.execute("INSERT INTO paper_vectors VALUES (?,?,?)", ("alpha", struct.pack("=2f", 0.6, 0.8),
                         vectors._content_hash("Alpha", "Science")))
        path = first.bundles.export(["alpha"], "bundle")
        with ZipFile(path) as z:
            assert not any("reading-position" in name for name in z.namelist())
        assert second.bundles.import_archive(path) == {"imported": 1, "skipped": 0, "vectors": 1}
        assert second.search.keyword("spectroscopy")[0]["paper"]["id"] == "alpha"
        assert second.bundles.import_archive(path) == {"imported": 0, "skipped": 1, "vectors": 0}
        assert second.papers.list()[0]["hasMarkdown"]
    finally:
        first.close()
        second.close()


def test_mineru_zip_and_zip_traversal(tmp_path):
    library = HubLibrary(tmp_path / "library")
    try:
        raw = tmp_path / "raw.zip"
        with ZipFile(raw, "w") as archive:
            archive.writestr("markdown.md", "# Imported\nContent from MinerU")
        assert library.bundles.import_archive(raw)["imported"] == 1
        for name in ("../outside", "/absolute", "C:\\windows"):
            with ZipFile(raw, "w") as archive:
                archive.writestr(name, "bad")
            with pytest.raises(InvalidRequest):
                library.bundles.import_archive(raw)
        assert not (tmp_path / "outside").exists()
    finally:
        library.close()


def test_vector_model_mismatch_rejects_without_changing_library(tmp_path):
    library = HubLibrary(tmp_path / "library")
    try:
        seed(library)
        bundle = {"signature": "different", "entries": [{"paperId": "alpha", "values": [1]}]}
        with pytest.raises(ValueError, match="Embedding model differs"):
            vectors.validate_portable_vectors(bundle, {"alpha": {}}, library.runtime.cfg)
    finally:
        library.close()


@pytest.mark.parametrize("metadata", [[], {"id": "alpha", "authors": {"invalid": True}}, None])
def test_malformed_metadata_rejects_without_changes(tmp_path, metadata):
    library = HubLibrary(tmp_path / "library")
    try:
        path = tmp_path / "malformed.zip"
        with ZipFile(path, "w") as archive:
            archive.writestr("manifest.json", json.dumps({"format": "scholaraio-library", "version": 1,
                                                         "papers": [{"path": "papers/0", "id": "alpha"}]}))
            if metadata is not None:
                archive.writestr("papers/0/meta.json", json.dumps(metadata))
            archive.writestr("papers/0/paper.md", "Paper content")
        with pytest.raises(InvalidRequest):
            library.bundles.import_archive(path)
        assert library.papers.list() == []
    finally:
        library.close()


def test_packed_legacy_directory_merges_without_overwriting(tmp_path):
    import subprocess
    import sys
    from pathlib import Path

    source = tmp_path / "old-papers"
    source.mkdir()
    for name, pid in (("existing-paper", "alpha"), ("作者-2026-论文", "beta")):
        directory = source / name
        (directory / "images").mkdir(parents=True)
        atomic_json(directory / "meta.json", {"id": pid, "title": "Imported " + pid,
                                               "authors": ["作者"], "year": None})
        (directory / "paper.md").write_text("# Imported\nUnique packing evidence", encoding="utf-8")
        (directory / "images" / "figure.png").write_bytes(b"image")
    (source / "unfinished").mkdir()
    before = {p.relative_to(source): p.read_bytes() for p in source.rglob("*") if p.is_file()}
    output = tmp_path / "upload"
    script = Path(__file__).resolve().parents[3] / "scripts" / "pack-papers.py"
    result = subprocess.run([sys.executable, str(script), str(source), "--output", str(output)],
                            check=True, capture_output=True, text=True)
    assert "unfinished" in result.stderr
    assert json.loads((output / "report.json").read_text())["papers"] == 2

    library = HubLibrary(tmp_path / "target")
    try:
        seed(library)
        assert library.bundles.import_archive(output / "batch-001.zip") == {
            "imported": 1, "skipped": 1, "vectors": 0,
        }
        assert library.runtime.papers.find("alpha").meta["title"] == "Alpha"
        imported = library.runtime.papers.find("beta")
        assert imported.meta["title"] == "Imported beta"
        assert (imported.directory / "images" / "figure.png").read_bytes() == b"image"
        assert library.search.keyword("packing")[0]["paper"]["id"] == "beta"
        assert before == {p.relative_to(source): p.read_bytes() for p in source.rglob("*") if p.is_file()}
    finally:
        library.close()


@pytest.mark.parametrize("prefix", ["papers/", "", "data/papers/"])
def test_plain_papers_zip_discovers_and_merges_without_manifest(tmp_path, prefix):
    library = HubLibrary(tmp_path / "library")
    try:
        existing = seed(library)
        original_meta = (existing / "meta.json").read_bytes()
        archive_path = tmp_path / "papers.zip"
        with ZipFile(archive_path, "w") as archive:
            for name, meta in (
                ("existing", {"id": "alpha", "title": "Must not overwrite"}),
                ("作者-2026-论文", {"title": "New paper", "authors": ["作者"], "year": None}),
            ):
                base = prefix + name
                archive.writestr(base + "/meta.json", json.dumps(meta, ensure_ascii=False))
                archive.writestr(base + "/paper.md", "# Paper\nDistinctive directoryimport evidence")
                archive.writestr(base + "/images/figure.png", b"image")
            archive.writestr("__MACOSX/unused/meta.json", "bad metadata")
            archive.writestr(".hidden/meta.json", "bad metadata")
        assert library.bundles.import_archive(archive_path) == {
            "imported": 1, "skipped": 1, "vectors": 0,
        }
        assert (existing / "meta.json").read_bytes() == original_meta
        record = library.runtime.papers.find("作者-2026-论文")
        assert record.meta["title"] == "New paper"
        assert (record.directory / "images/figure.png").read_bytes() == b"image"
        assert library.search.keyword("directoryimport")[0]["paper"]["id"] == record.id
        assert library.bundles.import_archive(archive_path) == {
            "imported": 0, "skipped": 2, "vectors": 0,
        }
        with ZipFile(archive_path) as archive:
            assert "id" not in json.loads(archive.read(prefix + "作者-2026-论文/meta.json"))
    finally:
        library.close()


def test_plain_single_paper_at_archive_root_preserves_metadata(tmp_path):
    library = HubLibrary(tmp_path / "library")
    try:
        source = tmp_path / "single.zip"
        with ZipFile(source, "w") as archive:
            archive.writestr("meta.json", '\ufeff' + json.dumps({
                "id": "root-paper", "title": "Full title", "abstract": None,
                "authors": ["Alice"], "doi": "10.1234/keep",
            }))
            archive.writestr("paper.md", "# Short title\nBody")
        assert library.bundles.import_archive(source)["imported"] == 1
        meta = library.runtime.papers.find("root-paper").meta
        assert meta["title"] == "Full title"
        assert meta["authors"] == ["Alice"]
        assert meta["doi"] == "10.1234/keep"
    finally:
        library.close()


@pytest.mark.parametrize("fault", ["missing-markdown", "missing-metadata", "invalid-json",
                                  "invalid-authors", "duplicate-id", "overlap"])
def test_plain_papers_zip_rejects_invalid_batch_without_changes(tmp_path, fault):
    library = HubLibrary(tmp_path / "library")
    try:
        seed(library)
        source = tmp_path / "invalid.zip"
        with ZipFile(source, "w") as archive:
            archive.writestr("papers/valid/meta.json", json.dumps({"id": "new", "title": "Valid"}))
            archive.writestr("papers/valid/paper.md", "Valid body")
            prefix = "papers/valid/nested" if fault == "overlap" else "papers/invalid"
            if fault != "missing-metadata":
                meta = {"id": "new" if fault == "duplicate-id" else "other"}
                if fault == "invalid-authors":
                    meta["authors"] = {"bad": True}
                archive.writestr(prefix + "/meta.json", "bad json" if fault == "invalid-json" else json.dumps(meta))
            if fault != "missing-markdown":
                archive.writestr(prefix + "/paper.md", "Body")
        with pytest.raises(InvalidRequest):
            library.bundles.import_archive(source)
        assert library.runtime.papers.ids() == {"alpha"}
        assert library.runtime.papers.find("alpha").meta["title"] == "Alpha"
    finally:
        library.close()


def test_import_whole_library_with_3138_papers(tmp_path):
    library = HubLibrary(tmp_path / "library")
    try:
        seed(library)
        source = tmp_path / "whole-library.zip"
        with ZipFile(source, "w", compression=ZIP_DEFLATED) as archive:
            for index in range(3138):
                prefix = f"papers/author-2026-paper-{index}"
                archive.writestr(prefix + "/meta.json", json.dumps({"id": f"bulk-{index}", "title": f"Paper {index}"}))
                archive.writestr(prefix + "/paper.md", f"# Paper {index}\nneedle{index}")
                archive.writestr(prefix + "/original.pdf", f"%PDF-unique-{index}")
        assert library.bundles.import_archive(source) == {"imported": 3138, "skipped": 0, "vectors": 0}
        assert len(library.runtime.papers.ids()) == 3139
        assert library.runtime.papers.find("alpha").meta["title"] == "Alpha"
        assert library.search.keyword("needle3137")[0]["paper"]["id"] == "bulk-3137"
        assert library.bundles.import_archive(source) == {"imported": 0, "skipped": 3138, "vectors": 0}
    finally:
        library.close()


def test_library_import_exceeds_parser_expanded_size_limit(tmp_path):
    from scholaraio.core.archives import MAX_ARCHIVE_BYTES, extract_zip

    library = HubLibrary(tmp_path / "library")
    try:
        source = tmp_path / "large-library.zip"
        with ZipFile(source, "w", compression=ZIP_DEFLATED) as archive:
            archive.writestr("papers/large/meta.json", json.dumps({"id": "large", "title": "Large PDF"}))
            archive.writestr("papers/large/paper.md", "# Large PDF")
            with archive.open("papers/large/original.pdf", "w", force_zip64=True) as pdf:
                block = b"0" * (1024 * 1024)
                for _ in range(MAX_ARCHIVE_BYTES // len(block) + 1):
                    pdf.write(block)
        # Single-document parser ZIPs keep their existing protection.
        with ZipFile(source) as archive, pytest.raises(ValueError, match="limit"):
            extract_zip(archive, tmp_path / "parser")
        assert library.bundles.import_archive(source)["imported"] == 1
        pdf = library.runtime.papers.find("large").directory / "original.pdf"
        assert pdf.stat().st_size > MAX_ARCHIVE_BYTES
        pdf.unlink()
    finally:
        library.close()


def test_library_import_refuses_insufficient_disk_without_changes(tmp_path, monkeypatch):
    from types import SimpleNamespace

    library = HubLibrary(tmp_path / "library")
    try:
        seed(library)
        source = tmp_path / "papers.zip"
        with ZipFile(source, "w") as archive:
            archive.writestr("papers/new/meta.json", '{"id":"new"}')
            archive.writestr("papers/new/paper.md", "Body")
        monkeypatch.setattr("scholaraio.hub.bundles.shutil.disk_usage", lambda _: SimpleNamespace(free=0))
        with pytest.raises(TooLarge, match="disk space"):
            library.bundles.import_archive(source)
        assert library.runtime.papers.ids() == {"alpha"}
        assert not list(library.runtime.root.glob("scholaraio-import-*"))
    finally:
        library.close()


def test_same_pdf_with_different_ids_in_one_zip_is_skipped(tmp_path):
    library = HubLibrary(tmp_path / "library")
    try:
        source = tmp_path / "duplicates.zip"
        with ZipFile(source, "w") as archive:
            for pid in ("first", "second"):
                archive.writestr(f"papers/{pid}/meta.json", json.dumps({"id": pid}))
                archive.writestr(f"papers/{pid}/paper.md", "Same PDF")
                archive.writestr(f"papers/{pid}/original.pdf", "%PDF-same")
        assert library.bundles.import_archive(source) == {"imported": 1, "skipped": 1, "vectors": 0}
    finally:
        library.close()
