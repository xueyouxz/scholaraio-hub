"""Bringing papers in: uploaded files, identifiers, reference exports, retries."""
from __future__ import annotations

from pathlib import Path
from typing import Annotated

from fastapi import APIRouter, File, UploadFile

from scholaraio.hub.errors import InvalidRequest, TooLarge
from scholaraio.hub.imports import ImportQueue
from scholaraio.interfaces.api.dependencies import Acquire, Imports
from scholaraio.interfaces.api.schemas import AcquireInput

MAX_FILES = 500
MAX_BATCH_BYTES = 500 * 1024 * 1024
MAX_REFERENCES_BYTES = 4 * 1024 * 1024
BLOCK_BYTES = 1024 * 1024
REFERENCE_SUFFIXES = (".bib", ".ris", ".txt", ".enw")

router = APIRouter(prefix="/imports", tags=["imports"])


@router.get("")
def list_jobs(imports: Imports):
    return {"jobs": imports.list()}


@router.post("", status_code=202)
async def upload(imports: Imports, files: Annotated[list[UploadFile], File()]):
    if len(files) > MAX_FILES:
        raise InvalidRequest(f"Import at most {MAX_FILES} PDFs per batch")
    try:
        staged = await receive_pdfs(imports, files)
    finally:
        for file in files:
            await file.close()
    try:
        return imports.enqueue(staged)
    except BaseException:
        discard(staged)
        raise


async def receive_pdfs(imports: ImportQueue, files: list[UploadFile]) -> list[tuple[Path, str]]:
    """Write every upload to staging, or none of them."""
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
    for destination, _ in staged:
        destination.unlink(missing_ok=True)


@router.post("/fetch", status_code=202)
def fetch(body: AcquireInput, acquire: Acquire):
    return acquire.fetch(body.locator)


@router.post("/references", status_code=202)
async def import_references(acquire: Acquire, file: Annotated[UploadFile, File()]):
    if not (file.filename or "").lower().endswith(REFERENCE_SUFFIXES):
        raise InvalidRequest("Only BibTeX or RIS exports are supported")
    try:
        payload = await file.read(MAX_REFERENCES_BYTES)
    finally:
        await file.close()
    return acquire.import_references(payload.decode("utf-8", "replace"))


@router.post("/{job_id}/retry", status_code=202)
def retry(job_id: str, imports: Imports):
    return imports.retry(job_id)
