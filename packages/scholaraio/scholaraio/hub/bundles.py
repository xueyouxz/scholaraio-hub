"""Portable parsed-paper bundles with optional safe JSON vectors."""
from __future__ import annotations

import errno
import json
import shutil
import tempfile
import uuid
from pathlib import Path
from typing import BinaryIO
from zipfile import BadZipFile, ZIP_DEFLATED, ZipFile

from scholaraio.core.archives import MAX_ARCHIVE_BYTES, extract_zip
from scholaraio.hub.errors import InvalidRequest, TooLarge
from scholaraio.hub.runtime import LibraryRuntime
from scholaraio.hub.storage import atomic_json, content_hash
from scholaraio.services import vectors
from scholaraio.stores.papers import find_pdf

# Bundle only public document artifacts. Host config, reading state and agent files stay local.
ARTIFACT_SUFFIXES = {".pdf", ".md", ".png", ".jpg", ".jpeg", ".webp", ".gif"}


class BundleService:
    def __init__(self, runtime: LibraryRuntime):
        self.runtime = runtime

    def export(self, paper_ids: list[str], format: str) -> Path:
        directory = Path(tempfile.mkdtemp(prefix="scholaraio-export-"))
        destination = directory / "documents.zip"
        try:
            with self.runtime.lock, ZipFile(destination, "w", compression=ZIP_DEFLATED) as archive:
                records = [self.runtime.papers.find(pid) for pid in dict.fromkeys(paper_ids)]
                manifest, metadata, size = [], {}, 0
                for index, record in enumerate(records):
                    prefix = f"papers/{index}"
                    meta = public_metadata(record.meta, record.id)
                    metadata[record.id] = meta
                    if format in {"bundle", "markdown"} and not (record.directory / "paper.md").is_file():
                        raise InvalidRequest(f"Paper {record.id} has not been parsed yet")
                    if format == "bundle":
                        archive.writestr(prefix + "/meta.json", json.dumps(meta, ensure_ascii=False))
                        manifest.append({"path": prefix, "id": record.id})
                    if format == "pdf":
                        pdf = find_pdf(record.directory)
                        if pdf is None:
                            raise InvalidRequest(f"Paper {record.id} has no original PDF")
                        files = [pdf]
                    else:
                        files = [file for file in record.directory.rglob("*") if file.is_file()
                                 and not file.is_symlink() and file.suffix.lower() in ARTIFACT_SUFFIXES
                                 and file.resolve().is_relative_to(record.directory.resolve())
                                 and (format == "bundle" or file.suffix.lower() != ".pdf")]
                    for file in files:
                        size += file.stat().st_size
                        if size > MAX_ARCHIVE_BYTES:
                            raise TooLarge("Select fewer papers: export exceeds 512 MiB")
                        archive.write(file, prefix + "/" + file.relative_to(record.directory).as_posix())
                if format == "bundle":
                    portable = vectors.export_portable_vectors(self.runtime.cfg.index_db, set(metadata))
                    archive.writestr("manifest.json", json.dumps({"format": "scholaraio-library", "version": 1,
                                                                 "papers": manifest, "vectors": portable},
                                                                ensure_ascii=False, allow_nan=False))
            return destination
        except BaseException:
            shutil.rmtree(directory)
            raise

    def import_archive(self, source: Path | BinaryIO) -> dict:
        with tempfile.TemporaryDirectory(prefix="scholaraio-import-", dir=self.runtime.root) as name:
            staged = Path(name)
            try:
                with ZipFile(source) as archive:
                    # Library migrations can contain thousands of papers. Bound them
                    # by available storage, while parser result ZIPs keep their limits.
                    expanded = sum(member.file_size for member in archive.infolist())
                    if expanded > shutil.disk_usage(staged).free:
                        raise TooLarge("Not enough disk space to unpack this library")
                    extract_zip(archive, staged, max_files=None, max_bytes=None)
                manifest_path = staged / "manifest.json"
                if manifest_path.exists():
                    entries, vector_bundle = self._manifest(staged, json.loads(manifest_path.read_text(encoding="utf-8")))
                elif directory_manifest := self._directory_manifest(staged):
                    entries, vector_bundle = self._manifest(staged, directory_manifest)
                else:
                    # A raw MinerU result ZIP contains a single Markdown document and images.
                    markdown = list(staged.rglob("*.md"))
                    if len(markdown) != 1:
                        raise InvalidRequest("Upload a papers ZIP with meta.json and paper.md in each paper directory, a ScholarAIO bundle, or a MinerU ZIP with one Markdown file")
                    source_dir = markdown[0].parent
                    target = staged / ("paper-" + uuid.uuid4().hex)
                    target.mkdir()
                    for file in source_dir.iterdir():
                        if file != target:
                            if file.is_dir():
                                shutil.copytree(file, target / file.name)
                            else:
                                shutil.copy2(file, target / file.name)
                    original = target / markdown[0].name
                    if original.name != "paper.md":
                        original.rename(target / "paper.md")
                    pid = str(uuid.uuid4())
                    title = next((line.lstrip("# ").strip()[:300] for line in markdown[0].read_text(encoding="utf-8").splitlines()
                                  if line.strip()), "Imported MinerU document")
                    meta = {"id": pid, "title": title, "authors": [], "hub": {"parseStatus": "ready"}}
                    atomic_json(target / "meta.json", meta)
                    entries, vector_bundle = [(target, meta)], {"entries": []}
                metadata = {meta["id"]: meta for _, meta in entries}
                rows = vectors.validate_portable_vectors(vector_bundle, metadata, self.runtime.cfg)
                return self._commit(entries, rows)
            except InvalidRequest:
                raise
            except OSError as error:
                if error.errno == errno.ENOSPC:
                    raise TooLarge("Not enough disk space to import this library") from error
                raise
            except (ValueError, KeyError, TypeError, BadZipFile, UnicodeError) as error:
                raise InvalidRequest(f"Invalid document bundle: {error}") from error

    def _directory_manifest(self, root: Path) -> dict | None:
        """Discover an ordinary papers ZIP and build its manifest on the server.

        Only extracted temporary copies are normalized; the uploaded archive and
        existing library are unchanged until every paper has passed validation.
        """
        metadata_paths = [
            path for path in sorted(root.rglob("meta.json"))
            if not any(part.startswith(".") or part == "__MACOSX"
                       for part in path.relative_to(root).parts)
        ]
        if not metadata_paths:
            return None
        papers = []
        for markdown_path in root.rglob("paper.md"):
            relative = markdown_path.relative_to(root)
            if any(part.startswith(".") or part == "__MACOSX" for part in relative.parts):
                continue
            if not (markdown_path.parent / "meta.json").is_file():
                raise InvalidRequest(f"Missing meta.json in uploaded paper: {relative.parent}")
        for metadata_path in metadata_paths:
            relative = metadata_path.relative_to(root)
            directory = metadata_path.parent
            if not (directory / "paper.md").is_file():
                raise InvalidRequest(f"Missing paper.md in uploaded paper: {relative.parent}")
            meta = json.loads(metadata_path.read_text(encoding="utf-8-sig"))
            if not isinstance(meta, dict):
                raise InvalidRequest(f"Invalid paper metadata: {relative}")
            # Legacy stores address papers without an ID by their directory name.
            pid = meta.get("id") or directory.name
            meta["id"] = pid
            for key in ("title", "abstract"):
                if meta.get(key) is None:
                    meta.pop(key, None)
            atomic_json(metadata_path, meta)
            papers.append({"path": relative.parent.as_posix(), "id": pid})
        # Single-paper archives may put meta.json directly at the ZIP root;
        # wrap that paper so it follows the normal bundle path validation.
        if any(paper["path"] == "." for paper in papers):
            if len(papers) != 1:
                raise InvalidRequest("Uploaded paper directories must not overlap")
            wrapper = root / ("paper-" + uuid.uuid4().hex)
            wrapper.mkdir()
            for file in root.iterdir():
                if file != wrapper:
                    shutil.move(str(file), wrapper / file.name)
            papers[0]["path"] = wrapper.name
        return {"format": "scholaraio-library", "version": 1, "papers": papers}

    def _manifest(self, root: Path, manifest: dict) -> tuple[list, dict]:
        if not isinstance(manifest, dict) or manifest.get("format") != "scholaraio-library" or manifest.get("version") != 1:
            raise InvalidRequest("Unsupported library bundle format")
        papers = manifest.get("papers")
        if not isinstance(papers, list) or not papers:
            raise InvalidRequest("Bundle must contain at least one paper")
        result, seen_paths, seen_ids = [], set(), set()
        resolved_root = root.resolve()
        for entry in papers:
            if not isinstance(entry, dict) or not isinstance(entry.get("path"), str):
                raise InvalidRequest("Invalid bundled paper path")
            directory = (root / entry["path"]).resolve()
            if (not directory.is_relative_to(resolved_root) or directory == resolved_root
                    or directory in seen_paths):
                raise InvalidRequest("Invalid or overlapping bundled paper directory")
            seen_paths.add(directory)
            metadata_path = directory / "meta.json"
            if not metadata_path.is_file():
                raise InvalidRequest("Each bundled paper must have meta.json")
            meta = json.loads(metadata_path.read_text(encoding="utf-8"))
            if not isinstance(meta, dict):
                raise InvalidRequest("Invalid paper metadata")
            pid = meta.get("id")
            if not isinstance(pid, str) or not pid or len(pid) > 200 or pid in seen_ids or pid != entry.get("id"):
                raise InvalidRequest("Invalid or duplicate bundled paper ID")
            if not isinstance(meta.get("title", ""), str) or not isinstance(meta.get("abstract", ""), str):
                raise InvalidRequest("Invalid paper title or abstract")
            seen_ids.add(pid)
            if not (directory / "paper.md").is_file():
                raise InvalidRequest("Each bundled paper must have parsed paper.md")
            # Validate UTF-8 before publishing the document to indexers/readers.
            (directory / "paper.md").read_text(encoding="utf-8")
            result.append((directory, public_metadata(meta, pid)))
        # Checking ancestors avoids comparing every pair in a large library.
        if any(parent in seen_paths for directory in seen_paths for parent in directory.parents):
            raise InvalidRequest("Invalid or overlapping bundled paper directory")
        bundle = manifest.get("vectors", {"entries": []})
        if not isinstance(bundle, dict):
            raise InvalidRequest("Invalid vector bundle")
        return result, bundle

    def _commit(self, entries: list, rows: list) -> dict:
        with self.runtime.lock:
            existing_ids, existing_hashes = set(), set()
            for record in self.runtime.papers:
                existing_ids.add(record.id)
                if fingerprint := record.meta.get("hub", {}).get("sha256"):
                    existing_hashes.add(fingerprint)
            moved, skipped, accepted = [], 0, set()
            try:
                for source, meta in entries:
                    pid = meta["id"]
                    pdf = find_pdf(source)
                    fingerprint = content_hash(pdf) if pdf else None
                    if pid in existing_ids or (fingerprint and fingerprint in existing_hashes):
                        skipped += 1
                        continue
                    target = self.runtime.cfg.papers_dir / str(uuid.uuid4())
                    target.mkdir()
                    moved.append(target)
                    for file in source.rglob("*"):
                        if file.is_file() and file.suffix.lower() in ARTIFACT_SUFFIXES:
                            relative = file.relative_to(source)
                            destination = target / relative
                            destination.parent.mkdir(parents=True, exist_ok=True)
                            # Staging is on the same volume: move artifacts without
                            # needing a second full copy of the expanded library.
                            file.replace(destination)
                    meta.setdefault("hub", {})["parseStatus"] = "ready"
                    if fingerprint:
                        meta["hub"]["sha256"] = fingerprint
                    atomic_json(target / "meta.json", meta)
                    accepted.add(pid)
                    existing_ids.add(pid)
                    if fingerprint:
                        existing_hashes.add(fingerprint)
                self.runtime.reindex()
                count = vectors.import_portable_vectors(self.runtime.cfg.index_db,
                                                         [row for row in rows if row[0] in accepted], self.runtime.cfg)
            except BaseException:
                for target in moved:
                    shutil.rmtree(target)
                self.runtime.reindex()
                raise
            self.runtime.events.publish("papers")
            return {"imported": len(moved), "skipped": skipped, "vectors": count}


def public_metadata(meta: dict, pid: str) -> dict:
    fields = ("title", "authors", "year", "doi", "journal", "abstract", "paper_type", "citation_count",
              "citation_counts", "metadata_status", "missing_metadata")
    result = {key: meta[key] for key in fields if key in meta and meta[key] is not None}
    for key in ("title", "doi", "journal", "abstract", "paper_type", "metadata_status"):
        if key in result and not isinstance(result[key], str):
            raise InvalidRequest(f"Invalid paper metadata: {key}")
    authors = result.get("authors", [])
    if not isinstance(authors, (str, list)) or (isinstance(authors, list) and any(not isinstance(a, str) for a in authors)):
        raise InvalidRequest("Invalid paper authors")
    if "year" in result and not isinstance(result["year"], (str, int)):
        raise InvalidRequest("Invalid paper year")
    if "missing_metadata" in result and (not isinstance(result["missing_metadata"], list) or any(not isinstance(k, str) for k in result["missing_metadata"])):
        raise InvalidRequest("Invalid missing metadata fields")
    if "metadata_status" in result and result["metadata_status"] not in {"complete", "incomplete"}:
        raise InvalidRequest("Invalid metadata status")
    hub = meta.get("hub", {})
    if not isinstance(hub, dict):
        raise InvalidRequest("Invalid paper metadata")
    if "category" in hub and not isinstance(hub["category"], str):
        raise InvalidRequest("Invalid paper category")
    result.update({"id": pid, "hub": {key: hub[key] for key in ("category", "parseStatus", "sha256") if key in hub}})
    return result
