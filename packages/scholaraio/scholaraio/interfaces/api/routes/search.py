"""Finding papers, and the passages an agent receives with a question."""
from __future__ import annotations

from fastapi import APIRouter

from scholaraio.interfaces.api.dependencies import Projects, Retrieval, Search
from scholaraio.interfaces.api.schemas import ContextInput, ProjectQuery

router = APIRouter(tags=["search"])


@router.get("/search")
def search(search: Search, q: str = "", limit: int = 50, project_id: ProjectQuery = None, mode: str | None = None):
    return search.query(q, limit=limit, project_id=project_id, mode=mode)


@router.post("/context")
def context(body: ContextInput, retrieval: Retrieval):
    return retrieval.context(body.query, body.paper_ids, body.project_id)


@router.post("/scope")
def scope(body: ContextInput, projects: Projects):
    return {"paperIds": projects.scope(body.project_id, body.paper_ids)}
