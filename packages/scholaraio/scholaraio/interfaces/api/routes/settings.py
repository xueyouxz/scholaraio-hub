"""The library settings page."""
from __future__ import annotations

from fastapi import APIRouter

from scholaraio.interfaces.api.dependencies import Settings
from scholaraio.interfaces.api.schemas import SettingsInput

router = APIRouter(prefix="/settings", tags=["settings"])


@router.get("")
def read_settings(settings: Settings):
    return settings.read()


@router.patch("")
def update_settings(body: SettingsInput, settings: Settings):
    # The service speaks the browser's field names, which are the aliases.
    return settings.update(body.model_dump(by_alias=True, exclude_unset=True, exclude_none=True))
