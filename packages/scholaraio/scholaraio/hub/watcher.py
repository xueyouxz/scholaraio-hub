"""Notice edits an agent makes to a project's paper index on disk.

Agents change ``refs/papers.json`` through the CLI without telling Hub. Polling
the index modification times turns those edits into the same events the
browser already listens to.
"""
from __future__ import annotations

import logging
import threading
from pathlib import Path

from scholaraio.hub.events import Publisher
from scholaraio.projects import workspace

_log = logging.getLogger("scholaraio.hub.watcher")

# How often the project index is checked for edits made outside Hub.
POLL_SECONDS = 2.0


class ProjectWatcher:
    def __init__(self, root: Path, events: Publisher):
        self.root = root
        self.events = events
        self.stop = threading.Event()
        self.state: dict[str, float] = self.snapshot()
        self.thread = threading.Thread(target=self.run, name="library-projects", daemon=True)
        self.thread.start()

    def close(self) -> None:
        self.stop.set()
        self.thread.join(timeout=POLL_SECONDS * 2)

    def snapshot(self) -> dict[str, float]:
        if not self.root.exists():
            return {}
        stamps = {}
        for directory in self.root.iterdir():
            if not directory.is_dir() or directory.name.startswith("."):
                continue
            index = workspace.paper_index_path(directory)
            stamps[directory.name] = index.stat().st_mtime if index.exists() else 0.0
        return stamps

    def run(self) -> None:
        while not self.stop.wait(POLL_SECONDS):
            try:
                current = self.snapshot()
            except OSError as error:  # a project moved mid-scan; try again next tick
                _log.warning("Project scan failed: %s", error)
                continue
            changed = sorted(
                name
                for name in set(current) | set(self.state)
                if current.get(name) != self.state.get(name)
            )
            self.state = current
            if changed:
                self.events.publish("projects")
                # A project's membership decides what search and context return.
                self.events.publish("papers")


__all__ = ["POLL_SECONDS", "ProjectWatcher"]
