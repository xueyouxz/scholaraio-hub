"""Long-running library work the browser starts, watches and stops.

The runner knows nothing about what a task does: it keeps one record per kind,
persists progress and honours the stop button. What each kind does is a job
function handed in at construction (see :mod:`scholaraio.hub.maintenance`).

Kinds that touch the same files share a lane and run one after another; kinds
in different lanes run side by side, so an hour of LLM summaries does not hold
back a topic rebuild.
"""

from __future__ import annotations

import json
import logging
import threading
import uuid
from collections.abc import Callable, Mapping
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from scholaraio.hub.errors import InvalidRequest
from scholaraio.hub.runtime import LibraryRuntime
from scholaraio.hub.storage import atomic_json

_log = logging.getLogger("scholaraio.hub.tasks")

ACTIVE = ("queued", "running")


def now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


class Progress:
    """What a running job may report, and how it learns it should stop."""

    def __init__(self, runner: TaskRunner, record: dict, stop: threading.Event):
        self._runner = runner
        self._record = record
        self._stop = stop

    @property
    def stopped(self) -> bool:
        return self._stop.is_set()

    def phase(self, name: str, **fields: Any) -> None:
        self._runner.update(self._record, phase=name, **fields)

    def advance(self, done: int, total: int | None = None) -> None:
        fields = {"done": done} if total is None else {"done": done, "total": total}
        self._runner.update(self._record, **fields)


# A job does the work and returns a one-line summary for the browser.
Job = Callable[[Progress], str]


class TaskRunner:
    def __init__(
        self,
        runtime: LibraryRuntime,
        jobs: Mapping[str, Job],
        root: Path,
        lanes: Mapping[str, str],
    ):
        self.runtime = runtime
        self.jobs = dict(jobs)
        self.root = root
        self.root.mkdir(parents=True, exist_ok=True)
        # Every kind names its lane; a missing one is a wiring mistake, not a default.
        self.lanes = {kind: lanes[kind] for kind in self.jobs}
        self.executors = {
            lane: ThreadPoolExecutor(max_workers=1, thread_name_prefix=f"library-task-{lane}")
            for lane in dict.fromkeys(self.lanes.values())
        }
        self.stops: dict[str, threading.Event] = {}
        self.tasks: dict[str, dict] = {}
        for kind in self.jobs:
            path = self.root / f"{kind}.json"
            if not path.exists():
                continue
            record = json.loads(path.read_text(encoding="utf-8"))
            if record.get("status") in ACTIVE:
                # The process that was running it is gone; the work is restartable.
                record.update(
                    status="failed", error="Task was interrupted and can be restarted", phase=None, finishedAt=now()
                )
            self.tasks[kind] = record

    def close(self) -> None:
        for stop in self.stops.values():
            stop.set()
        for executor in self.executors.values():
            executor.shutdown(wait=True, cancel_futures=True)

    # ---- records -------------------------------------------------------

    def save(self, record: dict) -> None:
        atomic_json(self.root / f"{record['kind']}.json", record)
        self.runtime.events.publish("tasks")

    def update(self, record: dict, **fields) -> None:
        with self.runtime.lock:
            record.update(fields)
            self.save(record)

    def list(self) -> list[dict]:
        """Every task's record; a queued one says which task it is waiting for."""
        with self.runtime.lock:
            records = []
            for kind in self.jobs:
                if kind not in self.tasks:
                    continue
                record = dict(self.tasks[kind])
                if record["status"] == "queued":
                    record["waitingFor"] = next(
                        (
                            other
                            for other, task in self.tasks.items()
                            if other != kind and self.lanes[other] == self.lanes[kind] and task["status"] == "running"
                        ),
                        None,
                    )
                records.append(record)
            return records

    def start(self, kind: str) -> dict:
        if kind not in self.jobs:
            raise InvalidRequest(f"Unknown task type: {kind}")
        with self.runtime.lock:
            current = self.tasks.get(kind)
            if current and current["status"] in ACTIVE:
                raise InvalidRequest("Task is already running")
            stop = threading.Event()
            self.stops[kind] = stop
            record = {
                "id": uuid.uuid4().hex,
                "kind": kind,
                "status": "queued",
                "phase": None,
                "done": 0,
                "total": 0,
                "summary": None,
                "error": None,
                "startedAt": now(),
                "finishedAt": None,
            }
            self.tasks[kind] = record
            self.save(record)
            self.executors[self.lanes[kind]].submit(self.run, kind, record, stop)
            return dict(record)

    def cancel(self, kind: str) -> dict:
        with self.runtime.lock:
            record = self.tasks.get(kind)
            if not record or record["status"] not in ACTIVE:
                raise InvalidRequest("Task is not running")
            self.stops[kind].set()
            if record["status"] == "queued":
                # Nothing has started: it ends now instead of when its turn comes.
                record.update(status="cancelled", phase=None, summary="Stopped before execution", finishedAt=now())
            else:
                record["phase"] = "stopping"
            self.save(record)
            return dict(record)

    # ---- execution -----------------------------------------------------

    def run(self, kind: str, record: dict, stop: threading.Event) -> None:
        if stop.is_set():
            return  # cancelled while it waited its turn
        self.update(record, status="running", phase="preparing", error=None)
        try:
            summary = self.jobs[kind](Progress(self, record, stop))
        except Exception as exc:  # the browser shows the reason and offers a restart
            _log.exception("Task %s failed", kind)
            self.update(record, status="failed", phase=None, error=str(exc), finishedAt=now())
            return
        self.update(
            record,
            status="cancelled" if stop.is_set() else "completed",
            phase=None,
            summary=summary,
            error=None,
            finishedAt=now(),
        )


__all__ = ["Job", "Progress", "TaskRunner"]
