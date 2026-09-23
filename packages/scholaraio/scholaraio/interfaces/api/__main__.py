from __future__ import annotations

import argparse
import hmac
import json
import os
import socket
import sys
import threading
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Literal

import uvicorn
from fastapi import FastAPI, File, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel, Field

from scholaraio.services.hub_library import HubLibrary, atomic_json
from scholaraio.stores.papers import find_pdf


class ContextInput(BaseModel):
    query: str = Field(max_length=20000)
    paperIds: list[str] = Field(default_factory=list, max_length=100)
    projectId: str | None = Field(default=None, min_length=1, max_length=120)


class ProjectInput(BaseModel):
    name: str = Field(min_length=1, max_length=120)


class ProjectPapersInput(BaseModel):
    paperIds: list[str] = Field(max_length=100)
    action: Literal["add", "remove"] = "add"


class MetadataInput(BaseModel):
    title: str | None = Field(default=None, max_length=2000)
    doi: str | None = Field(default=None, max_length=300)
    authors: list[str] | None = Field(default=None, max_length=200)
    year: int | None = Field(default=None, ge=1000, le=2200)
    journal: str | None = Field(default=None, max_length=500)
    abstract: str | None = Field(default=None, max_length=20000)
    paper_type: str | None = Field(default=None, max_length=100)


class SettingsInput(BaseModel):
    """Library settings the browser may change; keys are write-only."""

    extractor: str | None = Field(default=None, max_length=40)
    pdfParser: str | None = Field(default=None, max_length=40)
    llmBackend: str | None = Field(default=None, max_length=40)
    llmModel: str | None = Field(default=None, max_length=200)
    llmBaseUrl: str | None = Field(default=None, max_length=500)
    llmApiKey: str | None = Field(default=None, max_length=500)
    mineruApiKey: str | None = Field(default=None, max_length=500)
    embedProvider: str | None = Field(default=None, max_length=40)
    embedModel: str | None = Field(default=None, max_length=200)
    embedSource: str | None = Field(default=None, max_length=40)
    embedDevice: str | None = Field(default=None, max_length=40)
    embedApiKey: str | None = Field(default=None, max_length=500)


class ReadingPosition(BaseModel):
    page: int = Field(default=1, ge=1)
    line: int = Field(default=1, ge=1)
    mode: Literal["pdf", "markdown"] = "pdf"


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
        return JSONResponse({"error": str(exc)}, status_code=404)

    @app.exception_handler(RuntimeError)
    async def invalid_storage(request, exc):
        return JSONResponse({"error": str(exc)}, status_code=500)

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
    def search(q: str = "", limit: int = 50, projectId: str | None = None, mode: str | None = None):
        ids = app.state.library.projects.scope(projectId, []) if projectId else None
        if mode:
            return app.state.library.browse_search(q, mode, min(max(limit, 1), 200), set(ids) if ids is not None else None)
        return {"results": app.state.library.search(q, min(max(limit, 1), 200), set(ids) if ids is not None else None)}

    @app.get("/analytics")
    def analytics(projectId: str | None = None):
        return app.state.library.analytics(projectId)

    @app.patch("/papers/{paper_id}")
    def update_metadata(paper_id: str, body: MetadataInput):
        fields = body.model_dump(exclude_unset=True, exclude_none=True)
        if not fields:
            raise ValueError("没有要修改的字段")
        return app.state.library.metadata.update(paper_id, fields)

    @app.post("/papers/{paper_id}/refetch")
    def refetch_metadata_endpoint(paper_id: str):
        return app.state.library.metadata.refetch(paper_id)

    @app.get("/papers/{paper_id}/references")
    def references(paper_id: str, projectId: str | None = None):
        return app.state.library.citations.references(paper_id, projectId)

    @app.get("/papers/{paper_id}/citing")
    def citing(paper_id: str, projectId: str | None = None):
        return app.state.library.citations.citing(paper_id, projectId)

    @app.get("/citations/shared")
    def shared_references(paperIds: str = "", projectId: str | None = None, minShared: int = 2):
        ids = [value for value in paperIds.split(",") if value][:100]
        if len(ids) < 2:
            raise ValueError("共同参考文献至少需要两篇论文")
        return app.state.library.citations.shared(ids, projectId, max(min(minShared, len(ids)), 2))

    @app.get("/citations/top")
    def most_cited(limit: int = 20, projectId: str | None = None):
        return app.state.library.citations.most_cited(min(max(limit, 1), 200), projectId)

    @app.get("/papers/{paper_id}/images")
    def images(paper_id: str):
        return {"images": app.state.library.images(paper_id)}

    @app.post("/context")
    def context(body: ContextInput):
        return app.state.library.context(body.query, body.paperIds, body.projectId)

    @app.post("/scope")
    def scope(body: ContextInput):
        return {"paperIds": app.state.library.projects.scope(body.projectId, body.paperIds)}

    @app.get("/projects")
    def projects():
        return {"projects": app.state.library.projects.list()}

    @app.post("/projects", status_code=201)
    def create_project(body: ProjectInput):
        return app.state.library.projects.create(body.name)

    @app.get("/projects/{project_id}")
    def project(project_id: str):
        return app.state.library.projects.get(project_id)

    @app.post("/projects/{project_id}/rename")
    def rename_project(project_id: str, body: ProjectInput):
        return app.state.library.projects.rename(project_id, body.name)

    @app.delete("/projects/{project_id}")
    def delete_project(project_id: str):
        return app.state.library.projects.delete(project_id)

    @app.post("/projects/{project_id}/papers")
    def project_papers(project_id: str, body: ProjectPapersInput):
        return app.state.library.projects.update_papers(project_id, body.paperIds, body.action)

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

    @app.get("/papers/{paper_id}/attachments/{relative:path}")
    def attachment(paper_id: str, relative: str):
        directory, _ = app.state.library.find(paper_id)
        file = (directory / relative).resolve()
        if not file.is_relative_to(directory.resolve()) or not file.is_file():
            raise HTTPException(404, "Attachment unavailable")
        if file.suffix.lower() not in {".png", ".jpg", ".jpeg", ".webp", ".gif", ".pdf"}:
            raise HTTPException(400, "Unsupported attachment type")
        return FileResponse(file, headers={"cache-control": "private, max-age=0, must-revalidate", "x-content-type-options": "nosniff"})

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

    @app.get("/settings")
    def settings():
        return app.state.library.settings.read()

    @app.patch("/settings")
    def update_settings(body: SettingsInput):
        return app.state.library.settings.update(body.model_dump(exclude_unset=True, exclude_none=True))

    @app.get("/tasks")
    def tasks():
        return app.state.library.tasks.status()

    @app.post("/tasks/{kind}", status_code=202)
    def start_task(kind: str):
        return app.state.library.tasks.start(kind)

    @app.delete("/tasks/{kind}")
    def cancel_task(kind: str):
        return app.state.library.tasks.cancel(kind)

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
                destination = app.state.library.imports.stage(file.filename)
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


def watch_parent(server: uvicorn.Server, stopped: threading.Event):
    """An EOF on the Node-owned pipe also covers SIGKILL and watch restarts."""
    try:
        while os.read(sys.stdin.fileno(), 1024):
            pass
    except OSError as exc:
        print(f"Parent pipe failed: {exc}", file=sys.stderr, flush=True)
    if stopped.is_set():
        return
    server.should_exit = True
    # An import worker or a request may block graceful shutdown. Once the owner
    # is gone, bound cleanup time; persisted imports are recovered on next start.
    if not stopped.wait(5):
        os._exit(1)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--data-dir", type=Path, required=True)
    parser.add_argument("--watch-stdin", action="store_true")
    args = parser.parse_args()
    token = os.environ.get("SCHOLARAIO_HUB_INTERNAL_TOKEN", "")
    if not token:
        raise SystemExit("Missing internal service token")
    sock = socket.socket()
    sock.bind(("127.0.0.1", 0))
    print(json.dumps({"port": sock.getsockname()[1]}), flush=True)
    server = uvicorn.Server(uvicorn.Config(create_app(args.data_dir, token), log_level="warning"))
    stopped = threading.Event()
    if args.watch_stdin:
        # Process-owned daemon: a normal server exit ends a pending pipe read;
        # stopped cancels the forced-exit deadline if graceful cleanup completes.
        threading.Thread(target=watch_parent, args=(server, stopped), daemon=True).start()
    try:
        server.run(sockets=[sock])
    finally:
        stopped.set()
        sock.close()


if __name__ == "__main__":
    main()
