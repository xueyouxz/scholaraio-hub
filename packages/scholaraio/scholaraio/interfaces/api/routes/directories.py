"""The library's directories, shown in the desktop's file manager."""
from __future__ import annotations

from typing import Literal

from fastapi import APIRouter

from scholaraio.interfaces.api.dependencies import Directories
from scholaraio.interfaces.api.responses import RevealedDirectory

router = APIRouter(prefix="/directories", tags=["directories"])


@router.post("/{target}/reveal", response_model=RevealedDirectory)
def reveal(target: Literal["data", "papers", "workspaces"], directories: Directories):
    """Open one of the library's own directories; no path comes from the caller."""
    return directories.reveal(target)
