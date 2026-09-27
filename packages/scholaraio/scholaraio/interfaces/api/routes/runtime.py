"""Optional capabilities of the service's own Python runtime, installed on request."""

from __future__ import annotations

from typing import Literal

from fastapi import APIRouter, Request

from scholaraio.interfaces.api.dependencies import Installer
from scholaraio.interfaces.api.errors import success
from scholaraio.interfaces.api.responses import ApiSuccess, RuntimeInstallStatus

router = APIRouter(prefix="/runtime", tags=["runtime"])


@router.get("", response_model=ApiSuccess[RuntimeInstallStatus], response_model_exclude_unset=True)
def status(request: Request, installer: Installer):
    """查询可选运行环境安装状态。"""
    return success(request, installer.read())


@router.post(
    "/{capability}", status_code=202, response_model=ApiSuccess[RuntimeInstallStatus], response_model_exclude_unset=True
)
def install(request: Request, capability: Literal["semantic"], installer: Installer):
    """启动可选运行环境安装任务。"""
    return success(request, installer.install(capability))
