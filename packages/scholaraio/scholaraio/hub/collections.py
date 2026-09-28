"""Literature collections: named sets of papers, backed by the workspace paper index.

A collection is a directory under the workspace root, named by the user; the
papers it holds are listed in its ``refs/papers.json``. Its id is a UUID kept in
a marker file inside that directory, so it stays the same when the collection
is renamed: the browser and sessions refer to a collection by id. Every method
also accepts the collection's name, which agents (``scholaraio ws``) use.

A collection is only a set of papers an agent can be pointed at; agents never
work inside its directory.
"""

from __future__ import annotations

import json
import shutil
import uuid
from datetime import datetime, timezone
from pathlib import Path

from scholaraio.hub.errors import InvalidRequest, NotFound
from scholaraio.hub.runtime import LibraryRuntime
from scholaraio.hub.storage import atomic_json
from scholaraio.projects import workspace

NAME_LIMIT = 120
# Inside the collection directory, so it moves with a rename and goes with an
# archive. The name predates collections; existing directories carry it.
ID_FILE = ".scholaraio-project.json"


def is_collection_id(value: str) -> bool:
    try:
        return str(uuid.UUID(value)) == value
    except ValueError:
        return False


def not_found(reference: str) -> NotFound:
    return NotFound(f"Literature collection not found: {reference}", code="COLLECTION_NOT_FOUND")


class CollectionService:
    def __init__(self, runtime: LibraryRuntime):
        self.runtime = runtime
        self.root = runtime.cfg.workspace_dir.resolve()
        if not self.root.is_relative_to(runtime.root):
            raise InvalidRequest("Literature collections must be inside the application data directory")

    def resolve(self, collection: str) -> Path:
        """The directory of a collection named by its id, or by its name."""
        if not is_collection_id(collection):
            return self.directory(collection)
        for directory in self.directories():
            if self.identity(directory) == collection:
                return directory
        raise not_found(collection)

    def directories(self) -> list[Path]:
        if not self.root.exists():
            return []
        return [
            d
            for d in sorted(self.root.iterdir())
            if d.is_dir()
            and not d.name.startswith(".")
            and (workspace.has_paper_index(d) or workspace.has_legacy_paper_index(d))
        ]

    def identity(self, directory: Path) -> str:
        """The collection's id; one from before ids existed is given one now."""
        marker = directory / ID_FILE
        try:
            value = json.loads(marker.read_text(encoding="utf-8"))["id"]
        except FileNotFoundError:
            value = str(uuid.uuid4())
            atomic_json(marker, {"id": value})
            return value
        except (OSError, ValueError, KeyError, TypeError) as error:
            raise RuntimeError(f"Cannot read collection identity file: {marker}") from error
        if not isinstance(value, str) or not is_collection_id(value):
            raise RuntimeError(f"Invalid collection identity file: {marker}")
        return value

    def directory(self, name: str, *, existing: bool = True) -> Path:
        """The directory a collection name stands for, checked to stay inside the workspace root."""
        if (
            not workspace.validate_workspace_name(name)
            or name.startswith(".")
            or len(name) > NAME_LIMIT
            or any(ord(c) < 32 for c in name)
            or is_collection_id(name)
        ):
            raise InvalidRequest("Invalid collection name: path separators are not allowed")
        directory = self.root / name
        if not directory.resolve().is_relative_to(self.root):
            raise InvalidRequest("Collection directory is outside the managed area")
        for relative in ("refs", "refs/papers.json", "papers.json"):
            if not (directory / relative).resolve().is_relative_to(directory.resolve()):
                raise InvalidRequest("Collection index is outside the collection directory")
        if existing and not workspace.has_paper_index(directory):
            if workspace.has_legacy_paper_index(directory):
                raise InvalidRequest(f"Collection {name} uses legacy papers.json. Migrate to refs/papers.json first")
            raise not_found(name)
        return directory

    def get(self, collection: str) -> dict:
        with self.runtime.lock:
            return self.describe(self.resolve(collection))

    def describe(self, directory: Path) -> dict:
        with self.runtime.lock:
            ids = sorted(workspace.read_paper_ids(directory))
            return {
                "id": self.identity(directory),
                "name": directory.name,
                "paperIds": ids,
                "paperCount": len(ids),
            }

    def list(self) -> list[dict]:
        with self.runtime.lock:
            return [self.describe(self.directory(d.name)) for d in self.directories()]

    def create(self, name: str) -> dict:
        with self.runtime.lock:
            directory = self.directory(name, existing=False)
            if directory.exists():
                raise InvalidRequest("A collection or directory with this name already exists")
            workspace.create(directory)
            return self.describe(directory)

    def rename(self, collection: str, name: str) -> dict:
        """Rename the collection's directory; its id, and so every reference to it, stays."""
        with self.runtime.lock:
            directory = self.resolve(collection)
            self.identity(directory)
            target = self.directory(name, existing=False)
            if target.exists():
                raise InvalidRequest("The target collection name is already in use")
            return self.describe(workspace.rename(self.root, directory.name, name))

    def delete(self, collection: str) -> dict:
        """Move a collection aside rather than delete it outright."""
        with self.runtime.lock:
            directory = self.resolve(collection)
            collection_id = self.identity(directory)
            stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
            trash = self.root / ".trash" / f"{directory.name}-{stamp}"
            trash.parent.mkdir(parents=True, exist_ok=True)
            shutil.move(str(directory), str(trash))
            return {"id": collection_id, "archivedAt": stamp}

    def update_papers(self, collection: str, paper_ids: list[str], action: str) -> dict:
        with self.runtime.lock:
            directory = self.resolve(collection)
            if action == "add":
                resolved = [
                    {"id": pid, "dir_name": self.runtime.papers.find(pid).directory.name}
                    for pid in dict.fromkeys(paper_ids)
                ]
                workspace.add(directory, [], self.runtime.cfg.index_db, resolved=resolved)
            elif action == "remove":
                workspace.remove(directory, paper_ids, self.runtime.cfg.index_db)
            else:
                raise InvalidRequest(f"Unknown collection paper operation: {action}")
            return self.describe(directory)

    def scope(self, collection_ids: list[str], paper_ids: list[str]) -> list[str] | None:
        """The papers a selection stands for: every paper of the collections, plus the papers.

        ``None`` means the whole library (nothing selected); ``[]`` means the
        selection holds no papers, as with an empty collection. A collection
        that is gone, or a paper no longer in the library, refuses the request.
        """
        with self.runtime.lock:
            available = self.runtime.papers.ids()
            selected = set(paper_ids)
            if selected - available:
                raise InvalidRequest("Selected papers no longer exist. Select them again")
            if not collection_ids and not selected:
                return None
            for collection in dict.fromkeys(collection_ids):
                selected |= set(self.get(collection)["paperIds"]) & available
            return sorted(selected)

    def scope_set(self, collection_id: str | None) -> set[str] | None:
        """The papers one collection limits a query to; ``None`` for the whole library."""
        if not collection_id:
            return None
        return set(self.scope([collection_id], []) or [])


__all__ = ["CollectionService", "NAME_LIMIT"]
