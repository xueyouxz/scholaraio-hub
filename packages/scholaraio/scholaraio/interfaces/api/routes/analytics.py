"""The topic dashboard."""
from __future__ import annotations

from fastapi import APIRouter

from scholaraio.interfaces.api.dependencies import Analytics
from scholaraio.interfaces.api.schemas import ProjectQuery

router = APIRouter(tags=["analytics"])


@router.get("/analytics")
def analytics(analytics: Analytics, project_id: ProjectQuery = None):
    return analytics.overview(project_id)
