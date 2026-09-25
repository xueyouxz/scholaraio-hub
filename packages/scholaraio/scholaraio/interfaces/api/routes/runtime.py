"""Optional capabilities of the service's own Python runtime, installed on request."""
from __future__ import annotations

from typing import Literal

from fastapi import APIRouter

from scholaraio.interfaces.api.dependencies import Installer
from scholaraio.interfaces.api.responses import RuntimeInstallStatus

router = APIRouter(prefix="/runtime", tags=["runtime"])


@router.get("", response_model=RuntimeInstallStatus, response_model_exclude_unset=True)
def status(installer: Installer):
    return installer.read()


@router.post("/{capability}", status_code=202, response_model=RuntimeInstallStatus,
             response_model_exclude_unset=True)
def install(capability: Literal["semantic"], installer: Installer):
    """Install the capability's packages; the service restarts itself once they land."""
    return installer.install(capability)
