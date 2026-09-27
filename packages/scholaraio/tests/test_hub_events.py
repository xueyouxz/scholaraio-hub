"""Library changes reach whoever is watching, including changes made outside Hub."""
from __future__ import annotations

import asyncio
import threading
import time

import pytest

from scholaraio.hub import HubLibrary, watcher
from scholaraio.hub.events import CLOSED, EventBus


def test_a_change_on_a_worker_thread_reaches_a_stream():
    async def main():
        events = EventBus()
        events.bind(asyncio.get_running_loop())
        queue = events.subscribe()
        threading.Thread(target=lambda: events.publish("imports")).start()
        return await asyncio.wait_for(queue.get(), timeout=5)

    assert asyncio.run(main()) == {"type": "imports"}


def test_a_stream_that_left_stops_receiving():
    events = EventBus()
    events.bind(asyncio.new_event_loop())
    queue = events.subscribe()
    events.unsubscribe(queue)
    events.publish("tasks")

    assert queue.empty()


def test_closing_the_bus_ends_every_stream_even_a_full_one():
    async def main():
        events = EventBus()
        events.bind(asyncio.get_running_loop())
        idle, full = events.subscribe(), events.subscribe()
        for _ in range(full.maxsize):
            full.put_nowait({"type": "papers"})
        await asyncio.to_thread(events.close)
        await asyncio.sleep(0)
        drained = [full.get_nowait() for _ in range(full.qsize())]
        late = events.subscribe()
        return await asyncio.wait_for(idle.get(), timeout=5), drained[-1], late.get_nowait()

    assert asyncio.run(main()) == (CLOSED, CLOSED, CLOSED)


@pytest.fixture
def watched(tmp_path, monkeypatch):
    monkeypatch.setattr(watcher, "POLL_SECONDS", 0.05)
    library = HubLibrary(tmp_path / "app")
    try:
        yield library
    finally:
        library.close()


def test_an_edit_to_a_projects_papers_on_disk_is_announced(watched, monkeypatch):
    published: list[str] = []
    monkeypatch.setattr(watched.events, "publish", lambda kind, **_: published.append(kind))

    watched.projects.create("综述")

    deadline = time.monotonic() + 5
    while time.monotonic() < deadline and "projects" not in published:
        time.sleep(0.02)
    assert "projects" in published
    # Membership decides what search returns, so the paper list is stale too.
    assert "papers" in published
