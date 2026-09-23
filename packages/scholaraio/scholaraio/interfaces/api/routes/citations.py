"""Citation relations between papers, and references going in and out."""
from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Query

from scholaraio.hub.search import clamp_limit
from scholaraio.interfaces.api.dependencies import Citations, Exports
from scholaraio.interfaces.api.schemas import CitationCheckInput, ExportInput, ProjectQuery

router = APIRouter(tags=["citations"])


@router.get("/papers/{paper_id}/references")
def references(paper_id: str, citations: Citations, project_id: ProjectQuery = None):
    return citations.references(paper_id, project_id)


@router.get("/papers/{paper_id}/citing")
def citing(paper_id: str, citations: Citations, project_id: ProjectQuery = None):
    return citations.citing(paper_id, project_id)


@router.get("/citations/shared")
def shared_references(
    citations: Citations,
    paper_ids: Annotated[str, Query(alias="paperIds")] = "",
    project_id: ProjectQuery = None,
    min_shared: Annotated[int, Query(alias="minShared")] = 2,
):
    return citations.shared([value for value in paper_ids.split(",") if value], project_id, min_shared)


@router.get("/citations/top")
def most_cited(citations: Citations, limit: int = 20, project_id: ProjectQuery = None):
    return citations.most_cited(clamp_limit(limit), project_id)


@router.post("/citations/export")
def export_references(body: ExportInput, exports: Exports):
    return exports.export(body.paper_ids, body.project_id, body.format, body.style)


@router.post("/citations/check")
def check_references(body: CitationCheckInput, exports: Exports):
    return exports.check(body.text, body.project_id)
