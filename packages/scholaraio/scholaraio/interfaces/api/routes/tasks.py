"""Maintenance tasks and the readiness they report."""

from __future__ import annotations

from fastapi import APIRouter, Request

from scholaraio.interfaces.api.dependencies import Status, Tasks
from scholaraio.interfaces.api.errors import success
from scholaraio.interfaces.api.responses import ApiSuccess, LibraryCapabilities, LibraryTask

router = APIRouter(tags=["tasks"])


@router.get("/tasks", response_model=ApiSuccess[LibraryCapabilities], response_model_exclude_unset=True)
def readiness(request: Request, status: Status):
    """查询文献维护能力及任务状态。"""
    return success(request, status.readiness())


@router.post(
    "/tasks/{kind}", status_code=202, response_model=ApiSuccess[LibraryTask], response_model_exclude_unset=True
)
def start_task(request: Request, kind: str, tasks: Tasks):
    """启动指定类型的文献维护任务。"""
    return success(request, tasks.start(kind))


@router.delete("/tasks/{kind}", response_model=ApiSuccess[LibraryTask], response_model_exclude_unset=True)
def cancel_task(request: Request, kind: str, tasks: Tasks):
    """取消指定类型的文献维护任务。"""
    return success(request, tasks.cancel(kind))
