"""Bringing papers in: uploaded files, identifiers, retries."""

from __future__ import annotations

from pathlib import Path
from typing import Annotated

from fastapi import APIRouter, Depends, File, Form, Request, UploadFile

from scholaraio.hub.collections import NAME_LIMIT
from scholaraio.hub.errors import InvalidRequest, TooLarge
from scholaraio.hub.imports import ImportQueue
from scholaraio.interfaces.api.dependencies import Acquire, Imports
from scholaraio.interfaces.api.errors import require_json, require_multipart, success
from scholaraio.interfaces.api.responses import ApiSuccess, FetchedImportJob, ImportJob, ImportJobList
from scholaraio.interfaces.api.schemas import AcquireInput

MAX_FILES = 500
MAX_BATCH_BYTES = 500 * 1024 * 1024
BLOCK_BYTES = 1024 * 1024

router = APIRouter(prefix="/imports", tags=["imports"])


@router.get("", response_model=ApiSuccess[ImportJobList], response_model_exclude_unset=True)
def list_jobs(request: Request, imports: Imports):
    """查询文献导入任务。"""
    return success(request, {"jobs": imports.list()})


@router.post(
    "",
    status_code=202,
    response_model=ApiSuccess[ImportJob],
    response_model_exclude_unset=True,
    dependencies=[Depends(require_multipart)],
)
async def upload(
    request: Request,
    imports: Imports,
    files: Annotated[list[UploadFile], File()],
    collection_id: Annotated[str | None, Form(alias="collectionId", max_length=NAME_LIMIT)] = None,
):
    """接收 PDF 文件并创建导入任务。"""
    if len(files) > MAX_FILES:
        raise InvalidRequest(f"Import at most {MAX_FILES} PDFs per batch")
    try:
        staged = await receive_pdfs(imports, files)
    finally:
        for file in files:
            await file.close()
    try:
        return success(request, imports.enqueue(staged, collection_id or None))
    except BaseException:
        discard(staged)
        raise


async def receive_pdfs(imports: ImportQueue, files: list[UploadFile]) -> list[tuple[Path, str]]:
    """接收上传文件至暂存目录，失败时清理本批次文件。"""
    staged: list[tuple[Path, str]] = []
    total = 0
    try:
        for file in files:
            if not (file.filename or "").lower().endswith(".pdf"):
                raise InvalidRequest("Only PDF files are supported")
            destination = imports.stage(file.filename)
            staged.append((destination, Path(file.filename).name))
            with destination.open("wb") as output:
                while block := await file.read(BLOCK_BYTES):
                    total += len(block)
                    if total > MAX_BATCH_BYTES:
                        raise TooLarge(f"Batch exceeds {MAX_BATCH_BYTES // (1024 * 1024)} MB")
                    output.write(block)
    except BaseException:
        discard(staged)
        raise
    return staged


def discard(staged: list[tuple[Path, str]]) -> None:
    """删除本批次暂存的上传文件。"""
    for destination, _ in staged:
        destination.unlink(missing_ok=True)


@router.post(
    "/fetch",
    status_code=202,
    response_model=ApiSuccess[FetchedImportJob],
    response_model_exclude_unset=True,
    dependencies=[Depends(require_json)],
)
def fetch(request: Request, body: AcquireInput, acquire: Acquire):
    """根据文献标识创建获取任务。"""
    return success(request, acquire.fetch(body.locator, body.collection_id, body.title))


@router.post(
    "/{job_id}/retry", status_code=202, response_model=ApiSuccess[ImportJob], response_model_exclude_unset=True
)
def retry(request: Request, job_id: str, imports: Imports):
    """重新执行失败的导入任务。"""
    return success(request, imports.retry(job_id))
