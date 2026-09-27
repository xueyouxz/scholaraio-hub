"""Finding papers, and the passages an agent receives with a question."""

from __future__ import annotations

from fastapi import APIRouter, Depends, Request

from scholaraio.interfaces.api.dependencies import Discover, Projects, Retrieval, Search
from scholaraio.interfaces.api.errors import require_json, success
from scholaraio.interfaces.api.responses import (
    ApiSuccess,
    DiscoverResponse,
    LibraryContext,
    LibrarySearchResponse,
    Scope,
)
from scholaraio.interfaces.api.schemas import ContextInput, ProjectQuery, ScopeInput

router = APIRouter(tags=["search"])


@router.get("/search", response_model=ApiSuccess[LibrarySearchResponse], response_model_exclude_unset=True)
def search(request: Request, search: Search, mode: str, q: str = "", limit: int = 50, project_id: ProjectQuery = None):
    """按项目范围检索本地文献。"""
    return success(request, search.query(q, mode, limit=limit, project_id=project_id))


@router.get("/discover", response_model=ApiSuccess[DiscoverResponse])
def discover(request: Request, discover: Discover, q: str = "", limit: int = 20):
    """检索外部来源的文献。"""
    return success(request, discover.search(q, limit=limit))


@router.post("/context", response_model=ApiSuccess[LibraryContext], dependencies=[Depends(require_json)])
def context(request: Request, body: ContextInput, retrieval: Retrieval):
    """检索会话所需的文献片段。"""
    return success(request, retrieval.context(body.query, body.paper_ids, body.project_id))


@router.post("/scope", response_model=ApiSuccess[Scope], dependencies=[Depends(require_json)])
def scope(request: Request, body: ScopeInput, projects: Projects):
    """解析项目与论文组成的文献范围。"""
    return success(request, {"paperIds": projects.scope(body.project_id, body.paper_ids)})
