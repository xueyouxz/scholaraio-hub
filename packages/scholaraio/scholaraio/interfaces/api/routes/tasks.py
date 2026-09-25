"""Maintenance tasks and the readiness they report."""
from __future__ import annotations

from fastapi import APIRouter

from scholaraio.interfaces.api.dependencies import Status, Tasks
from scholaraio.interfaces.api.responses import LibraryCapabilities, LibraryTask

router = APIRouter(tags=["tasks"])


@router.get("/tasks", response_model=LibraryCapabilities, response_model_exclude_unset=True)
def readiness(status: Status):
    return status.readiness()


@router.post("/tasks/{kind}", status_code=202, response_model=LibraryTask, response_model_exclude_unset=True)
def start_task(kind: str, tasks: Tasks):
    return tasks.start(kind)


@router.delete("/tasks/{kind}", response_model=LibraryTask, response_model_exclude_unset=True)
def cancel_task(kind: str, tasks: Tasks):
    return tasks.cancel(kind)

