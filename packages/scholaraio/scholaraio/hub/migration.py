"""Explicit, journaled relocation of user files; never called during startup.

A verified independent backup precedes every move. On the same filesystem the
original files are renamed, avoiding a second full-sized copy of the library.
"""
from __future__ import annotations

import argparse
import json
import os
import shutil
import uuid
from datetime import datetime, timezone
from pathlib import Path

import yaml

from scholaraio.core.config import Config, load_config
from scholaraio.hub.library import HubLibrary
from scholaraio.hub.storage import atomic_json, content_hash
from scholaraio.stores.papers import iter_paper_dirs, read_meta

EXCLUDED_NAMES = {".git", ".venv", "node_modules", "__pycache__", ".DS_Store"}
EXCLUDED_DATA = {"cache", "runtime"}


def inventory(source: Path, mappings: list[dict]) -> list[dict]:
    entries = {}
    for mapping in mappings:
        directory = Path(mapping["source"])
        if not directory.exists():
            continue
        for parent, dirs, files in os.walk(directory, followlinks=False):
            current = Path(parent)
            dirs[:] = sorted(d for d in dirs if d not in EXCLUDED_NAMES and not (
                current == source / "data" and d in EXCLUDED_DATA))
            for name in dirs + files:
                if (current / name).is_symlink():
                    raise ValueError(f"Resolve symbolic links before migration: {current / name}")
            for name in sorted(files):
                if name in EXCLUDED_NAMES or (current == source / "data" and name.startswith("scholaraio.log")):
                    continue
                file = current / name
                relative = (Path(mapping["destination"]) / file.relative_to(directory)).as_posix()
                if relative in entries:
                    continue
                entries[relative] = {"source": str(file), "destination": relative,
                                     "size": file.stat().st_size, "sha256": content_hash(file)}
    return list(entries.values())


def resolve_mappings(source: Path):
    cfg = load_config(source / "config.yaml") if (source / "config.yaml").exists() else Config(_root=source)
    defaults = Config(_root=Path("/hub-migration-target"))
    mappings = [{"source": str(source / "data"), "destination": "data"},
                {"source": str(cfg.workspace_dir), "destination": "workspace"}]
    paths = {}
    # Preserve configured storage roots; normalize them into the application root.
    for key in ("papers_dir", "workspace_dir", "state_root", "inbox_dir", "doc_inbox_dir",
                "thesis_inbox_dir", "patent_inbox_dir", "proceedings_inbox_dir"):
        actual = getattr(cfg, key)
        containing = next((item for item in mappings if actual.is_relative_to(Path(item["source"]))), None)
        if containing:
            paths[key] = (Path(containing["destination"]) / actual.relative_to(containing["source"])).as_posix()
        else:
            destination = getattr(defaults, key).relative_to(defaults._root).as_posix()
            mappings.append({"source": str(actual), "destination": destination})
            paths[key] = destination
    return cfg, mappings, paths


def plan(source: Path, target: Path) -> Path:
    source, target = source.expanduser().resolve(), target.expanduser().resolve()
    if not source.is_dir() or source == target or target.is_relative_to(source) or source.is_relative_to(target):
        raise ValueError("Source and target must be separate existing source / target directories")
    cfg, mappings, paths = resolve_mappings(source)
    entries = inventory(source, mappings)
    if not entries:
        raise ValueError("No user files found")
    # Parse metadata before making any changes and keep the original UUID set.
    paper_ids = []
    for directory in iter_paper_dirs(cfg.papers_dir):
        meta = read_meta(directory)
        if not meta.get("id"):
            raise ValueError(f"Missing paper UUID: {directory}")
        paper_ids.append(str(meta["id"]))
    if len(set(paper_ids)) != len(paper_ids):
        raise ValueError("Duplicate paper UUIDs in source library")
    merged = {}
    for name in ("config.yaml", "config.local.yaml"):
        file = source / name
        if file.exists():
            data = yaml.safe_load(file.read_text()) or {}
            for key, value in data.items():
                if isinstance(value, dict) and isinstance(merged.get(key), dict):
                    merged[key] = {**merged[key], **value}
                else:
                    merged[key] = value
    # All application paths now derive from the injected root. External model caches
    # are not copied; embedding remains optional and can be configured afterwards.
    merged["paths"] = {**paths, "cache_root": "data/cache", "runtime_root": "data/runtime", "index_db": "data/state/search/index.db"}
    merged.setdefault("log", {}).update(file="logs/scholaraio.log", metrics_db="")
    merged.setdefault("embed", {}).update(cache_dir="data/cache/models")
    merged.setdefault("topics", {}).update(model_dir="")
    migration = target / "backups" / ("migration-" + datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S") + "-" + uuid.uuid4().hex[:8])
    migration.mkdir(parents=True, mode=0o700)
    manifest = migration / "manifest.json"
    atomic_json(manifest, {"version": 1, "state": "planned", "source": str(source), "target": str(target),
                           "mappings": mappings, "entries": entries, "paperIds": paper_ids,
                           "config": merged, "bytes": sum(e["size"] for e in entries)})
    manifest.chmod(0o600)
    return manifest


def load_manifest(file: Path):
    data = json.loads(file.read_text())
    if data.get("version") != 1:
        raise ValueError("Unsupported migration manifest")
    target = Path(data["target"]).resolve()
    for entry in data["entries"]:
        destination = (target / entry["destination"]).resolve()
        if not destination.is_relative_to(target) or destination == target:
            raise ValueError("Invalid destination in manifest")
    return data


def verify(file: Path, entry: dict):
    if not file.is_file() or file.stat().st_size != entry["size"] or content_hash(file) != entry["sha256"]:
        raise ValueError(f"Missing or changed file: {file}")


def apply(manifest: Path):
    data = load_manifest(manifest)
    if data["state"] != "planned":
        raise ValueError("Migration is not planned; use rollback after a failed run")
    source, target = Path(data["source"]), Path(data["target"])
    if (target / "config.yaml").exists() or (target / "config.local.yaml").exists():
        raise FileExistsError("Target configuration already exists")
    for entry in data["entries"]:
        verify(Path(entry["source"]), entry)
        if (target / entry["destination"]).exists():
            raise FileExistsError(f"Target conflict: {entry['destination']}")
    if inventory(source, data["mappings"]) != data["entries"]:
        raise ValueError("Source changed since planning; stop writers and create a new plan")
    same_disk = all(Path(entry["source"]).stat().st_dev == target.stat().st_dev for entry in data["entries"])
    required = data["bytes"] * (1 if same_disk else 2) + max(64 * 1024**2, data["bytes"] // 10)
    if shutil.disk_usage(target).free < required:
        raise OSError(f"Insufficient free space: need {required} bytes for verified backup and relocation")
    data["state"] = "backing-up"
    atomic_json(manifest, data)
    try:
        for entry in data["entries"]:
            backup = manifest.parent / "files" / entry["destination"]
            backup.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(entry["source"], backup)
            verify(backup, entry)
        for name in ("config.yaml", "config.local.yaml"):
            if (source / name).exists():
                shutil.copy2(source / name, manifest.parent / name)
        # Check again after backup; stale/live source files must never be removed.
        if inventory(source, data["mappings"]) != data["entries"]:
            raise ValueError("Source changed while backing up; stop writers before retrying")
        data["state"] = "moving"
        atomic_json(manifest, data)
        # The journal is durable before each rename; rollback also handles a crash
        # between rename and the next journal line without guessing file contents.
        with (manifest.parent / "moves.jsonl").open("a", encoding="utf-8") as journal:
            for entry in data["entries"]:
                destination = target / entry["destination"]
                destination.parent.mkdir(parents=True, exist_ok=True)
                journal.write(json.dumps(entry["destination"]) + "\n")
                journal.flush()
                os.fsync(journal.fileno())
                if destination.exists():
                    raise FileExistsError(destination)
                shutil.move(entry["source"], destination)
                verify(destination, entry)
        # Confirm UUIDs and attachments at the relocated paths before switching config.
        paper_root = target / data["config"]["paths"]["papers_dir"]
        actual_ids = sorted(str(read_meta(d)["id"]) for d in iter_paper_dirs(paper_root))
        if actual_ids != sorted(data["paperIds"]):
            raise ValueError("Paper UUID verification failed")
        config_text = yaml.safe_dump(data["config"], allow_unicode=True, sort_keys=False)
        data["state"] = "configuring"
        atomic_json(manifest, data)
        temporary_config = manifest.parent / "new-config.yaml"
        with temporary_config.open("x", encoding="utf-8") as output:
            temporary_config.chmod(0o600)
            output.write(config_text)
            output.flush()
            os.fsync(output.fileno())
        # Publish atomically, with no replacement of an existing configuration.
        os.link(temporary_config, target / "config.yaml")
        temporary_config.unlink()
        data["state"] = "reindexing"
        atomic_json(manifest, data)
        library = HubLibrary(target)
        library.close()
        data["state"] = "complete"
        atomic_json(manifest, data)
    except BaseException as exc:
        data["error"] = str(exc)
        atomic_json(manifest, data)
        raise


def rollback(manifest: Path):
    data = load_manifest(manifest)
    target = Path(data["target"])
    journal = manifest.parent / "moves.jsonl"
    moved = set(json.loads(line) for line in journal.read_text().splitlines()) if journal.exists() else set()
    entries = [entry for entry in data["entries"] if entry["destination"] in moved]
    config = target / "config.yaml"
    owns_config = data["state"] in ("configuring", "reindexing", "complete")
    if owns_config and config.exists() and yaml.safe_load(config.read_text()) != data["config"]:
        raise ValueError("Target config was modified; rollback stopped before changing files")
    # Preflight every file; never partially overwrite newer user modifications.
    for entry in entries:
        source = Path(entry["source"])
        if source.exists():
            verify(source, entry)
        verify(manifest.parent / "files" / entry["destination"], entry)
        destination = target / entry["destination"]
        # Indexes are derived and may have been rebuilt after relocation.
        if destination.exists() and not entry["destination"].startswith("data/state/search/"):
            verify(destination, entry)
    for entry in entries:
        source = Path(entry["source"])
        if not source.exists():
            source.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(manifest.parent / "files" / entry["destination"], source)
        (target / entry["destination"]).unlink(missing_ok=True)
    if owns_config:
        config.unlink(missing_ok=True)
    data["state"] = "rolled-back"
    atomic_json(manifest, data)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=["plan", "apply", "rollback"])
    parser.add_argument("--source", type=Path)
    parser.add_argument("--target", type=Path)
    parser.add_argument("--manifest", type=Path)
    args = parser.parse_args()
    if args.action == "plan":
        if not args.source or not args.target:
            parser.error("plan requires --source and --target")
        manifest = plan(args.source, args.target)
        data = load_manifest(manifest)
        print(json.dumps({"manifest": str(manifest), "files": len(data["entries"]), "bytes": data["bytes"],
                          "papers": len(data["paperIds"]), "directories": data["mappings"]}, indent=2, ensure_ascii=False))
    else:
        if not args.manifest:
            parser.error("--manifest is required; stop both old and new writers before apply/rollback")
        (apply if args.action == "apply" else rollback)(args.manifest)
        print(f"Migration {args.action} complete: {args.manifest}")


if __name__ == "__main__":
    main()
