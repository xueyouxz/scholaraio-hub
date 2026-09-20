from __future__ import annotations

import argparse
import hmac
import json
import os
import socket
import uuid
from contextlib import asynccontextmanager
from pathlib import Path

import uvicorn
from fastapi import FastAPI, File, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel, Field

from scholaraio.services.hub_library import HubLibrary, atomic_json
from scholaraio.stores.papers import find_pdf


class ContextInput(BaseModel):
    query: str = Field(max_length=20000)
    paperIds: list[str] = Field(default_factory=list, max_length=100)


class ReadingPosition(BaseModel):
    page: int = Field(default=1, ge=1)
    line: int = Field(default=1, ge=1)
    mode: str = "pdf"


def create_app(root: Path, token: str) -> FastAPI:
    @asynccontextmanager
    async def lifespan(app):
        library = HubLibrary(root)
        app.state.library = library
        try:
            yield
        finally:
            library.close()

    app = FastAPI(lifespan=lifespan)

    @app.middleware("http")
    async def authenticate(request: Request, call_next):
        if not token or not hmac.compare_digest(request.headers.get("x-hub-token", ""), token):
            return JSONResponse({"error": "Unauthorized"}, status_code=401)
        return await call_next(request)

    @app.exception_handler(KeyError)
    async def not_found(request, exc):
        return JSONResponse({"error": "Resource not found"}, status_code=404)

    @app.exception_handler(ValueError)
    async def invalid(request, exc):
        return JSONResponse({"error": str(exc)}, status_code=400)

    @app.get("/health")
    def health():
        return {"status": "ok"}

    @app.get("/papers")
    def papers():
        return {"papers": app.state.library.papers()}

    @app.get("/search")
    def search(q: str = "", limit: int = 50):
        return {"results": app.state.library.search(q, min(max(limit, 1), 200))}

    @app.post("/context")
    def context(body: ContextInput):
        return app.state.library.context(body.query, body.paperIds)

    @app.get("/papers/{paper_id}")
    def detail(paper_id: str):
        return app.state.library.detail(paper_id)

    @app.get("/papers/{paper_id}/pdf")
    def pdf(paper_id: str):
        directory, _ = app.state.library.find(paper_id)
        file = find_pdf(directory)
        if file is None:
            raise HTTPException(404, "PDF unavailable")
        return FileResponse(file, media_type="application/pdf", headers={"cache-control": "private, max-age=0, must-revalidate"})

    @app.get("/papers/{paper_id}/position")
    def get_position(paper_id: str):
        directory, _ = app.state.library.find(paper_id)
        file = directory / "reading-position.json"
        return json.loads(file.read_text()) if file.exists() else {"page": 1, "line": 1, "mode": "pdf"}

    @app.put("/papers/{paper_id}/position")
    def set_position(paper_id: str, body: ReadingPosition):
        directory, _ = app.state.library.find(paper_id)
        atomic_json(directory / "reading-position.json", body.model_dump())
        return body

    @app.get("/imports")
    def jobs():
        return {"jobs": app.state.library.list_jobs()}

    @app.post("/imports", status_code=202)
    async def upload(files: list[UploadFile] = File(...)):
        if len(files) > 500:
            raise HTTPException(400, "Import at most 500 PDFs per batch")
        staged = []
        total = 0
        try:
            for file in files:
                if not (file.filename or "").lower().endswith(".pdf"):
                    raise HTTPException(400, "Only PDF files are supported")
                destination = app.state.library.cfg.inbox_dir / f"{uuid.uuid4().hex}.pdf"
                staged.append((destination, Path(file.filename).name))
                with destination.open("wb") as output:
                    while block := await file.read(1024 * 1024):
                        total += len(block)
                        if total > 500 * 1024 * 1024:
                            raise HTTPException(413, "Batch exceeds 500 MB")
                        output.write(block)
            return app.state.library.enqueue(staged)
        except BaseException:
            for destination, _ in staged:
                destination.unlink(missing_ok=True)
            raise
        finally:
            for file in files:
                await file.close()

    @app.post("/imports/{job_id}/retry", status_code=202)
    def retry(job_id: str):
        return app.state.library.retry(job_id)

    return app


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--data-dir", type=Path, required=True)
    args = parser.parse_args()
    token = os.environ.get("SCHOLARAIO_HUB_INTERNAL_TOKEN", "")
    if not token:
        raise SystemExit("Missing internal service token")
    sock = socket.socket()
    sock.bind(("127.0.0.1", 0))
    print(json.dumps({"port": sock.getsockname()[1]}), flush=True)
    try:
        uvicorn.Server(uvicorn.Config(create_app(args.data_dir, token), log_level="warning")).run(sockets=[sock])
    finally:
        sock.close()


if __name__ == "__main__":
    main()
