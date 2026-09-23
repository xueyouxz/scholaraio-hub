"""Library changes reach whoever is watching, including changes made outside Hub."""
from __future__ import annotations

import asyncio
import threading
import time

import pytest

from scholaraio.services import hub_events
from scholaraio.services.hub_events import HubEvents
from scholaraio.services.hub_library import HubLibrary


def test_a_change_on_a_worker_thread_reaches_a_stream():
    async def main():
        events = HubEvents()
        events.bind(asyncio.get_running_loop())
        queue = events.add()
        threading.Thread(target=lambda: events.publish("imports")).start()
        return await asyncio.wait_for(queue.get(), timeout=5)

    assert asyncio.run(main()) == {"type": "imports"}


def test_a_stream_that_left_stops_receiving():
    events = HubEvents()
    events.bind(asyncio.new_event_loop())
    queue = events.add()
    events.remove(queue)
    events.publish("tasks")

    assert queue.empty()


@pytest.fixture
def watched(tmp_path, monkeypatch):
    monkeypatch.setattr(hub_events, "PROJECT_POLL_SECONDS", 0.05)
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
