"""The topic dashboard."""

from __future__ import annotations

from fastapi import APIRouter, Request

from scholaraio.interfaces.api.dependencies import Analytics
from scholaraio.interfaces.api.errors import success
from scholaraio.interfaces.api.responses import ApiSuccess, LibraryAnalytics

router = APIRouter(tags=["analytics"])


@router.get("/analytics", response_model=ApiSuccess[LibraryAnalytics])
def analytics(request: Request, analytics: Analytics):
    """查询文献库统计信息。"""
    return success(request, analytics.overview())
