"""Long-running library work the browser starts, watches and stops.

The runner knows nothing about what a task does: it keeps one record per kind,
runs one task at a time, persists progress and honours the stop button. What
each kind does is a job function handed in at construction (see
:mod:`scholaraio.hub.maintenance`).
"""
from __future__ import annotations

import json
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
    def __init__(self, runtime: LibraryRuntime, jobs: Mapping[str, Job], root: Path):
        self.runtime = runtime
        self.jobs = dict(jobs)
        self.root = root
        self.root.mkdir(parents=True, exist_ok=True)
        self.executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="library-task")
        self.stops: dict[str, threading.Event] = {}
        self.tasks: dict[str, dict] = {}
        for kind in self.jobs:
            path = self.root / f"{kind}.json"
            if not path.exists():
                continue
            record = json.loads(path.read_text(encoding="utf-8"))
            if record.get("status") in ACTIVE:
                # The process that was running it is gone; the work is restartable.
                record.update(status="failed", error="任务被中断，可重新开始", phase=None, finishedAt=now())
            self.tasks[kind] = record

    @property
    def kinds(self) -> tuple[str, ...]:
        return tuple(self.jobs)

    def close(self) -> None:
        for stop in self.stops.values():
            stop.set()
        self.executor.shutdown(wait=True, cancel_futures=True)

    # ---- records -------------------------------------------------------

    def save(self, record: dict) -> None:
        atomic_json(self.root / f'{record["kind"]}.json', record)
        self.runtime.events.publish("tasks")

    def update(self, record: dict, **fields) -> None:
        with self.runtime.lock:
            record.update(fields)
            self.save(record)

    def list(self) -> list[dict]:
        with self.runtime.lock:
            return [dict(self.tasks[kind]) for kind in self.jobs if kind in self.tasks]

    def start(self, kind: str) -> dict:
        if kind not in self.jobs:
            raise InvalidRequest(f"未知的任务类型：{kind}")
        with self.runtime.lock:
            current = self.tasks.get(kind)
            if current and current["status"] in ACTIVE:
                raise InvalidRequest("该任务已在运行")
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
            self.executor.submit(self.run, kind, record, stop)
            return dict(record)

    def cancel(self, kind: str) -> dict:
        with self.runtime.lock:
            record = self.tasks.get(kind)
            if not record or record["status"] not in ACTIVE:
                raise InvalidRequest("该任务没有在运行")
            self.stops[kind].set()
            record["phase"] = "stopping"
            self.save(record)
            return dict(record)

    # ---- execution -----------------------------------------------------

    def run(self, kind: str, record: dict, stop: threading.Event) -> None:
        self.update(record, status="running", phase="preparing", error=None)
        try:
            summary = self.jobs[kind](Progress(self, record, stop))
        except Exception as exc:  # the browser shows the reason and offers a restart
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
