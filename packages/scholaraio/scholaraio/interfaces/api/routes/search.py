"""Finding papers, and the passages an agent receives with a question."""
from __future__ import annotations

from fastapi import APIRouter

from scholaraio.interfaces.api.dependencies import Discover, Projects, Retrieval, Search
from scholaraio.interfaces.api.schemas import ContextInput, ProjectQuery, ScopeInput

router = APIRouter(tags=["search"])


@router.get("/search")
def search(search: Search, mode: str, q: str = "", limit: int = 50, project_id: ProjectQuery = None):
    return search.query(q, mode, limit=limit, project_id=project_id)


@router.get("/discover")
def discover(discover: Discover, q: str = "", limit: int = 20):
    """Papers on the open web the library could fetch."""
    return discover.search(q, limit=limit)


@router.post("/context")
def context(body: ContextInput, retrieval: Retrieval):
    return retrieval.context(body.query, body.paper_ids, body.project_id)


@router.post("/scope")
def scope(body: ScopeInput, projects: Projects):
    return {"paperIds": projects.scope(body.project_id, body.paper_ids)}
