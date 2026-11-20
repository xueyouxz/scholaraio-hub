"""Bulk paper classification and portable parsed-document transfer."""
from __future__ import annotations

import shutil
from typing import Annotated

from fastapi import APIRouter, Depends, File, Request, UploadFile
from fastapi.responses import FileResponse
from starlette.background import BackgroundTask
from starlette.concurrency import run_in_threadpool

from scholaraio.interfaces.api.dependencies import Bundles, Papers
from scholaraio.interfaces.api.errors import require_json, require_multipart, success
from scholaraio.interfaces.api.responses import ApiSuccess, BundleImportResult, CategoryResult
from scholaraio.interfaces.api.schemas import BundleExportInput, CategoryInput

router = APIRouter(prefix="/documents", tags=["documents"])


@router.post("/category", response_model=ApiSuccess[CategoryResult], dependencies=[Depends(require_json)])
def categorize(request: Request, body: CategoryInput, papers: Papers):
    """Set a manual category, or clear it to return to conference detection."""
    return success(request, papers.categorize(body.paper_ids, body.category))


@router.post("/export", dependencies=[Depends(require_json)])
def export(body: BundleExportInput, bundles: Bundles):
    """Download selected PDFs, Markdown/assets or a portable library with vectors."""
    archive = bundles.export(body.paper_ids, body.format)
    return FileResponse(archive, media_type="application/zip", filename=f"scholaraio-{body.format}.zip",
                        background=BackgroundTask(shutil.rmtree, archive.parent))


@router.post("/import", response_model=ApiSuccess[BundleImportResult], dependencies=[Depends(require_multipart)])
async def import_bundle(request: Request, bundles: Bundles, file: Annotated[UploadFile, File()]):
    """Upload a parsed library bundle or a raw MinerU result ZIP."""
    try:
        # UploadFile already spools large multipart bodies to disk. Read its
        # seekable stream directly instead of making another full ZIP copy.
        result = await run_in_threadpool(bundles.import_archive, file.file)
        return success(request, result)
    finally:
        await file.close()
