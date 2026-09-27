"""The library settings page."""

from __future__ import annotations

from fastapi import APIRouter, Depends, Request

from scholaraio.interfaces.api.dependencies import Settings
from scholaraio.interfaces.api.errors import require_json, success
from scholaraio.interfaces.api.responses import ApiSuccess, LibrarySettings, SettingsCheck
from scholaraio.interfaces.api.schemas import SettingsCheckInput, SettingsInput

router = APIRouter(prefix="/settings", tags=["settings"])


@router.get("", response_model=ApiSuccess[LibrarySettings])
def read_settings(request: Request, settings: Settings):
    """读取文献服务配置。"""
    return success(request, settings.read())


@router.patch("", response_model=ApiSuccess[LibrarySettings], dependencies=[Depends(require_json)])
def update_settings(request: Request, body: SettingsInput, settings: Settings):
    """更新文献服务配置。"""
    return success(request, settings.update(body.model_dump(by_alias=True, exclude_unset=True, exclude_none=True)))


@router.post("/check", response_model=ApiSuccess[SettingsCheck], dependencies=[Depends(require_json)])
def check_settings(request: Request, body: SettingsCheckInput, settings: Settings):
    """检查指定服务的配置可用性。"""
    return success(request, settings.check(body.target))
