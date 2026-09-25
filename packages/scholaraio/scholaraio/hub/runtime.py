"""What every library service shares: configuration, the writer lock, the papers
on disk, the search index and the event bus.

Services receive this object and the sibling services they use through their
constructors; none of them reaches back into :class:`HubLibrary`.
"""
from __future__ import annotations

import threading
from pathlib import Path

from scholaraio.core.config import Config
from scholaraio.hub.config import ensure_config
from scholaraio.hub.errors import InvalidRequest
from scholaraio.hub.events import EventBus
from scholaraio.hub.repository import PaperRepository
from scholaraio.services.chunks import build_chunk_index
from scholaraio.services.index import build_index


class LibraryRuntime:
    def __init__(self, root: Path):
        self.root = root.resolve()
        # Explicit root: never discover config from the code checkout or caller cwd.
        # The file is also what an agent's CLI run resolves through SCHOLARAIO_CONFIG.
        self.cfg: Config = ensure_config(self.root)
        for directory in (self.cfg.papers_dir, self.cfg.state_root, self.cfg.inbox_dir, self.cfg.index_db.parent):
            self.require_inside(directory, "Library path is outside the application data directory")
            directory.mkdir(parents=True, exist_ok=True)
        # One writer at a time: requests, the import worker and the task worker
        # all change the same files and index.
        self.lock = threading.RLock()
        self.events = EventBus()
        self.papers = PaperRepository(self.cfg.papers_dir)

    def require_inside(self, path: Path, message: str) -> Path:
        """Refuse a path that resolves outside the application data directory."""
        resolved = path.resolve()
        if not resolved.is_relative_to(self.root):
            raise InvalidRequest(f"{message}: {path}")
        return resolved

    def reload_config(self) -> Config:
        """Re-read the configuration after a settings change.

        Only keys, models and extraction choices are editable, so every path
        the library and its workers resolved at start-up still holds.
        """
        with self.lock:
            self.cfg = ensure_config(self.root)
            return self.cfg

    def reindex(self) -> None:
        """Bring keyword and chunk search in line with the papers on disk."""
        with self.lock:
            build_index(self.cfg.papers_dir, self.cfg.index_db)
            build_chunk_index(self.cfg.papers_dir, self.cfg.index_db)


__all__ = ["LibraryRuntime"]
