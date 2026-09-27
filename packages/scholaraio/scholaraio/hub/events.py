"""Changes the library pushes to whoever is watching it.

Imports, maintenance tasks and agents editing a project's ``refs/papers.json``
all change what the browser is showing. Publishing those changes lets the
browser stop asking every second whether anything happened.
"""
from __future__ import annotations

import asyncio
import threading
from typing import Any, Protocol

# Events a stream may fall behind by before the loop drops new ones for it.
QUEUE_SIZE = 100
# What a stream receives when the bus closes: the service is stopping.
CLOSED = None


class Publisher(Protocol):
    """What a service needs to announce a change; satisfied by :class:`EventBus`."""

    def publish(self, kind: str, **fields: Any) -> None: ...


class EventBus:
    """Fan-out of library changes to connected streams.

    Work happens on worker threads; readers live on the server's event loop,
    so every hand-over goes through ``call_soon_threadsafe``.
    """

    def __init__(self):
        self.lock = threading.Lock()
        self.subscribers: set[asyncio.Queue] = set()
        self.loop: asyncio.AbstractEventLoop | None = None
        self.closed = False

    def bind(self, loop: asyncio.AbstractEventLoop) -> None:
        self.loop = loop

    def publish(self, kind: str, **fields: Any) -> None:
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

    def subscribe(self) -> asyncio.Queue:
        queue: asyncio.Queue = asyncio.Queue(maxsize=QUEUE_SIZE)
        with self.lock:
            if self.closed:
                queue.put_nowait(CLOSED)
            else:
                self.subscribers.add(queue)
        return queue

    def close(self) -> None:
        """结束所有事件流：服务停止时调用，流结束后服务才不必等这些连接。可在任意线程调用。"""
        loop = self.loop
        with self.lock:
            self.closed = True
            queues = list(self.subscribers)
        if loop is None:
            return
        for queue in queues:
            try:
                # A full queue still gets the end: make room for it.
                loop.call_soon_threadsafe(_end, queue)
            except RuntimeError:
                return

    def unsubscribe(self, queue: asyncio.Queue) -> None:
        with self.lock:
            self.subscribers.discard(queue)


def _end(queue: asyncio.Queue) -> None:
    """在事件循环中向一个流投递结束标记，必要时丢弃最旧的一条事件。"""
    if queue.full():
        queue.get_nowait()
    queue.put_nowait(CLOSED)


__all__ = ["CLOSED", "EventBus", "Publisher"]
