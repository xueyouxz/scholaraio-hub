"""Changes the library pushes to whoever is watching it.

Imports, maintenance tasks and agents editing a project's ``refs/papers.json``
all change what the browser is showing. Publishing those changes lets the
browser stop asking every second whether anything happened.
"""
from __future__ import annotations

import asyncio
import threading
from pathlib import Path

from scholaraio.projects import workspace

# How often the project index is checked for edits made outside Hub.
PROJECT_POLL_SECONDS = 2.0


class HubEvents:
    """Fan-out of library changes to connected streams.

    Work happens on worker threads; readers live on the server's event loop,
    so every hand-over goes through ``call_soon_threadsafe``.
    """

    def __init__(self):
        self.lock = threading.Lock()
        self.subscribers: set[asyncio.Queue] = set()
        self.loop: asyncio.AbstractEventLoop | None = None

    def bind(self, loop: asyncio.AbstractEventLoop) -> None:
        self.loop = loop

    def publish(self, kind: str, **fields) -> None:
        loop = self.loop
        with self.lock:
            queues = list(self.subscribers)
        if loop is None or not queues:
            return
        event = {"type": kind, **fields}
        for queue in queues:
            try:
                loop.call_soon_threadsafe(queue.put_nowait, event)
            except RuntimeError:
                # The server is shutting down; its streams are already gone.
                return

    def add(self) -> asyncio.Queue:
        queue: asyncio.Queue = asyncio.Queue(maxsize=100)
        with self.lock:
            self.subscribers.add(queue)
        return queue

    def remove(self, queue: asyncio.Queue) -> None:
        with self.lock:
            self.subscribers.discard(queue)


class ProjectWatcher:
    """Notice edits an agent makes to a project's paper index on disk."""

    def __init__(self, library):
        self.library = library
        self.stop = threading.Event()
        self.state: dict[str, float] = self.snapshot()
        self.thread = threading.Thread(target=self.run, name="library-projects", daemon=True)
        self.thread.start()

    def close(self) -> None:
        self.stop.set()
        self.thread.join(timeout=PROJECT_POLL_SECONDS * 2)

    def snapshot(self) -> dict[str, float]:
        root: Path = self.library.projects.root
        if not root.exists():
            return {}
        stamps = {}
        for directory in root.iterdir():
            if not directory.is_dir() or directory.name.startswith("."):
                continue
            index = workspace.paper_index_path(directory)
            stamps[directory.name] = index.stat().st_mtime if index.exists() else 0.0
        return stamps

    def run(self) -> None:
        while not self.stop.wait(PROJECT_POLL_SECONDS):
            try:
                current = self.snapshot()
            except OSError as error:  # a project moved mid-scan; try again next tick
                print(f"[library] project scan failed: {error}", flush=True)
                continue
            changed = sorted(
                name
                for name in set(current) | set(self.state)
                if current.get(name) != self.state.get(name)
            )
            self.state = current
            if changed:
                self.library.events.publish("projects", projects=changed)
                # A project's membership decides what search and context return.
                self.library.events.publish("papers")


__all__ = ["HubEvents", "ProjectWatcher"]
