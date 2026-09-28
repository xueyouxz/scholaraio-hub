"""Citation relations between papers, and references going in and out."""

from __future__ import annotations

from fastapi import APIRouter, Depends, Request

from scholaraio.interfaces.api.dependencies import Citations, Exports
from scholaraio.interfaces.api.errors import require_json, success
from scholaraio.interfaces.api.responses import ApiSuccess, CitingList, ExportFile, ReferenceList
from scholaraio.interfaces.api.schemas import CollectionQuery, ExportInput

router = APIRouter(tags=["citations"])


@router.get("/papers/{paper_id}/references", response_model=ApiSuccess[ReferenceList])
def references(request: Request, paper_id: str, citations: Citations, collection_id: CollectionQuery = None):
    """查询论文参考文献。"""
    return success(request, citations.references(paper_id, collection_id))


@router.get("/papers/{paper_id}/citing", response_model=ApiSuccess[CitingList])
def citing(request: Request, paper_id: str, citations: Citations, collection_id: CollectionQuery = None):
    """查询引用当前论文的文献。"""
    return success(request, citations.citing(paper_id, collection_id))


@router.post("/citations/export", response_model=ApiSuccess[ExportFile], dependencies=[Depends(require_json)])
def export_references(request: Request, body: ExportInput, exports: Exports):
    """导出指定文献的引用文件。"""
    return success(request, exports.export(body.paper_ids, body.collection_id, body.format, body.style))
