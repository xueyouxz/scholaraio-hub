"""The library's directories, shown in the desktop's file manager."""

from __future__ import annotations

from typing import Literal

from fastapi import APIRouter, Request

from scholaraio.interfaces.api.dependencies import Directories
from scholaraio.interfaces.api.errors import success
from scholaraio.interfaces.api.responses import ApiSuccess, RevealedDirectory

router = APIRouter(prefix="/directories", tags=["directories"])


@router.post("/{target}/reveal", response_model=ApiSuccess[RevealedDirectory])
def reveal(request: Request, target: Literal["data", "papers", "workspaces"], directories: Directories):
    """在文件管理器中打开文献目录。"""
    return success(request, directories.reveal(target))
