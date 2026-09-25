"""Maintenance tasks and the readiness they report."""
from __future__ import annotations

from fastapi import APIRouter

from scholaraio.interfaces.api.dependencies import Status, Tasks

router = APIRouter(tags=["tasks"])


@router.get("/tasks")
def readiness(status: Status):
    return status.readiness()


@router.post("/tasks/{kind}", status_code=202)
def start_task(kind: str, tasks: Tasks):
    return tasks.start(kind)


@router.delete("/tasks/{kind}")
def cancel_task(kind: str, tasks: Tasks):
    return tasks.cancel(kind)

