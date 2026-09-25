"""Citation relations between papers, and references going in and out."""
from __future__ import annotations

from fastapi import APIRouter

from scholaraio.interfaces.api.dependencies import Citations, Exports
from scholaraio.interfaces.api.schemas import ExportInput, ProjectQuery

router = APIRouter(tags=["citations"])


@router.get("/papers/{paper_id}/references")
def references(paper_id: str, citations: Citations, project_id: ProjectQuery = None):
    return citations.references(paper_id, project_id)


@router.get("/papers/{paper_id}/citing")
def citing(paper_id: str, citations: Citations, project_id: ProjectQuery = None):
    return citations.citing(paper_id, project_id)


@router.post("/citations/export")
def export_references(body: ExportInput, exports: Exports):
    return exports.export(body.paper_ids, body.project_id, body.format, body.style)

