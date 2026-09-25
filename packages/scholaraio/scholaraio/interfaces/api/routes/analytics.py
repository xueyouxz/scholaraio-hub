"""The topic dashboard."""
from __future__ import annotations

from fastapi import APIRouter

from scholaraio.interfaces.api.dependencies import Analytics
from scholaraio.interfaces.api.responses import LibraryAnalytics

router = APIRouter(tags=["analytics"])


@router.get("/analytics", response_model=LibraryAnalytics)
def analytics(analytics: Analytics):
    return analytics.overview()
