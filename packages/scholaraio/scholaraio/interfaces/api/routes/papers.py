"""One paper: its row, text, files, reading position and metadata corrections."""
from __future__ import annotations

from fastapi import APIRouter
from fastapi.responses import FileResponse

from scholaraio.interfaces.api.dependencies import Metadata, Papers
from scholaraio.interfaces.api.responses import (
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


@router.get("", response_model=PaperList)
def list_papers(papers: Papers):
    return {"papers": papers.list()}


@router.get("/{paper_id}", response_model=LibraryPaperDetail)
def detail(paper_id: str, papers: Papers):
    return papers.detail(paper_id)


@router.patch("/{paper_id}", response_model=LibraryPaper)
def update_metadata(paper_id: str, body: MetadataInput, metadata: Metadata):
    return metadata.update(paper_id, body.model_dump(exclude_unset=True, exclude_none=True))


@router.post("/{paper_id}/refetch", response_model=RefetchResult)
def refetch_metadata(paper_id: str, metadata: Metadata):
    return metadata.refetch(paper_id)


@router.get("/{paper_id}/images", response_model=ImageList)
def images(paper_id: str, papers: Papers):
    return {"images": papers.images(paper_id)}


@router.get("/{paper_id}/pdf")
def pdf(paper_id: str, papers: Papers):
    return FileResponse(papers.pdf(paper_id), media_type="application/pdf", headers=REVALIDATE)


@router.get("/{paper_id}/attachments/{relative:path}")
def attachment(paper_id: str, relative: str, papers: Papers):
    return FileResponse(papers.attachment(paper_id, relative), headers={**REVALIDATE, "x-content-type-options": "nosniff"})


@router.get("/{paper_id}/position", response_model=ReadingPosition)
def get_position(paper_id: str, papers: Papers):
    return papers.position(paper_id)


@router.put("/{paper_id}/position", response_model=ReadingPosition)
def set_position(paper_id: str, body: ReadingPositionInput, papers: Papers):
    return papers.save_position(paper_id, body.model_dump())
