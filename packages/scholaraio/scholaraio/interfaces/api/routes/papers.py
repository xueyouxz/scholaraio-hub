"""One paper: its row, text, files, reading position and metadata corrections."""

from __future__ import annotations

from fastapi import APIRouter, Depends, Request

from scholaraio.interfaces.api.dependencies import Metadata, Papers
from scholaraio.interfaces.api.errors import require_json, success
from scholaraio.interfaces.api.files import file_response
from scholaraio.interfaces.api.responses import (
    ApiSuccess,
    ImageList,
    LibraryPaper,
    LibraryPaperDetail,
    PaperList,
    ReadingPosition,
    RefetchResult,
)
from scholaraio.interfaces.api.schemas import MetadataInput, ReadingPositionInput

# Files change when a paper is re-parsed; always revalidate.
REVALIDATE = {"cache-control": "private, max-age=0, must-revalidate"}

router = APIRouter(prefix="/papers", tags=["papers"])


@router.get("", response_model=ApiSuccess[PaperList])
def list_papers(request: Request, papers: Papers):
    """查询文献列表。"""
    return success(request, {"papers": papers.list()})


@router.get("/{paper_id}", response_model=ApiSuccess[LibraryPaperDetail])
def detail(request: Request, paper_id: str, papers: Papers):
    """读取论文元数据与正文详情。"""
    return success(request, papers.detail(paper_id))


@router.patch("/{paper_id}", response_model=ApiSuccess[LibraryPaper], dependencies=[Depends(require_json)])
def update_metadata(request: Request, paper_id: str, body: MetadataInput, metadata: Metadata):
    """更新论文元数据。"""
    return success(request, metadata.update(paper_id, body.model_dump(exclude_unset=True, exclude_none=True)))


@router.post("/{paper_id}/refetch", response_model=ApiSuccess[RefetchResult])
def refetch_metadata(request: Request, paper_id: str, metadata: Metadata):
    """重新获取论文元数据。"""
    return success(request, metadata.refetch(paper_id))


@router.get("/{paper_id}/images", response_model=ApiSuccess[ImageList])
def images(request: Request, paper_id: str, papers: Papers):
    """查询论文图片列表。"""
    return success(request, {"images": papers.images(paper_id)})


@router.get("/{paper_id}/pdf")
def pdf(paper_id: str, papers: Papers, request: Request):
    """返回论文 PDF，支持范围请求与缓存校验。"""
    return file_response(request, papers.pdf(paper_id), media_type="application/pdf", headers=REVALIDATE)


@router.get("/{paper_id}/attachments/{relative:path}")
def attachment(paper_id: str, relative: str, papers: Papers, request: Request):
    """返回论文附件文件。"""
    return file_response(
        request, papers.attachment(paper_id, relative), headers={**REVALIDATE, "x-content-type-options": "nosniff"}
    )


@router.get("/{paper_id}/position", response_model=ApiSuccess[ReadingPosition])
def get_position(request: Request, paper_id: str, papers: Papers):
    """读取论文阅读位置。"""
    return success(request, papers.position(paper_id))


@router.put("/{paper_id}/position", response_model=ApiSuccess[ReadingPosition], dependencies=[Depends(require_json)])
def set_position(request: Request, paper_id: str, body: ReadingPositionInput, papers: Papers):
    """保存论文阅读位置。"""
    return success(request, papers.save_position(paper_id, body.model_dump()))
