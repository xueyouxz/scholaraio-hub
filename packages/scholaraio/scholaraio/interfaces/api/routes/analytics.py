"""The topic dashboard."""
from __future__ import annotations

from fastapi import APIRouter

from scholaraio.interfaces.api.dependencies import Analytics

router = APIRouter(tags=["analytics"])


@router.get("/analytics")
def analytics(analytics: Analytics):
    return analytics.overview()
