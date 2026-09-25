"""Liveness, and the stream of library changes."""
from __future__ import annotations

import asyncio
import json
from collections.abc import AsyncIterator

from fastapi import APIRouter, Request
from fastapi.responses import StreamingResponse

from scholaraio.hub.events import EventBus
from scholaraio.interfaces.api.dependencies import Events
from scholaraio.interfaces.api.responses import Health

# Idle gap after which an open event stream sends a comment to stay alive.
HEARTBEAT_SECONDS = 15.0

router = APIRouter()


@router.get("/health", response_model=Health)
def health():
    return {"status": "ok"}


@router.get("/events")
async def events(request: Request, bus: Events):
    """Stream library changes, so the browser does not have to ask for them."""
    bus.bind(asyncio.get_running_loop())
    # Subscribe before answering, so nothing published in between is missed.
    queue = bus.subscribe()
    return StreamingResponse(
        server_sent_events(request, bus, queue),
        media_type="text/event-stream",
        headers={"cache-control": "no-store", "x-accel-buffering": "no"},
    )


async def server_sent_events(request: Request, bus: EventBus, queue: asyncio.Queue) -> AsyncIterator[str]:
    try:
        while True:
            try:
                event = await asyncio.wait_for(queue.get(), timeout=HEARTBEAT_SECONDS)
            except TimeoutError:
                # Keeps the connection open through idle proxies.
                yield ": keep-alive\n\n"
                continue
            yield f"data: {json.dumps(event, ensure_ascii=False)}\n\n"
            if await request.is_disconnected():
                return
    finally:
        bus.unsubscribe(queue)
