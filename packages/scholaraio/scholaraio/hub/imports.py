"""Import queue that runs uploaded files through the ScholarAIO ingest pipeline.

Each item runs the same steps as ``scholaraio pipeline``—parse, extract
metadata, look up and deduplicate, ingest—so a paper imported from the browser
carries the DOI, identifiers and citation data the rest of the library depends
on. The queue owns per-item staging, status and retry; the pipeline owns the
work.
"""
from __future__ import annotations

import copy
import json
import os
import shutil
import uuid
from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Any

from scholaraio.hub.errors import InvalidRequest, NotFound
from scholaraio.hub.runtime import LibraryRuntime
from scholaraio.hub.storage import atomic_json, content_hash
from scholaraio.services.ingest import identifiers
from scholaraio.services.ingest.inbox_orchestration import run_file_steps
from scholaraio.services.ingest.types import InboxCtx
from scholaraio.stores.papers import read_meta, write_meta

STEPS = ["mineru", "extract", "dedup", "ingest"]
# Split so the queue can fill gaps the browser can live with (a missing title)
# between reading the file and committing it to the library.
PARSE_STEPS = STEPS[:2]
STORE_STEPS = STEPS[2:]
ACTIVE = ("queued", "running")
# Statuses that leave a usable paper behind.
INGESTED = ("completed", "completed_incomplete")


def lookups_disabled() -> bool:
    """Whether external metadata lookups are switched off for this instance.

    Set by tests and offline runs; imports then keep whatever the file itself
    states and mark the missing identifiers.
    """
    return os.environ.get("SCHOLARAIO_HUB_NO_API", "").strip().lower() not in ("", "0", "false")


def snapshot(value):
    """A copy the caller may keep while the worker goes on changing the original."""
    return json.loads(json.dumps(value))


class ImportQueue:
    """Serial import worker: one job at a time, each item through the pipeline."""

    def __init__(self, runtime: LibraryRuntime):
        self.runtime = runtime
        self.root = runtime.cfg.state_root / "imports"
        self.staging = self.root / "staging"
        for directory in (self.root, self.staging):
            directory.mkdir(parents=True, exist_ok=True)
        self.executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="library-import")
        self.jobs = {p.stem: json.loads(p.read_text()) for p in self.root.glob("*.json")}
        for job in self.jobs.values():
            for item in job["items"]:
                if item["status"] in ACTIVE:
                    item.update(status="failed", error="导入被中断，可重试继续", step=None)
            self.save(job)

    def close(self):
        self.executor.shutdown(wait=True, cancel_futures=True)

    # ---- staging -------------------------------------------------------

    def stage(self, filename: str) -> Path:
        """Return a private path for an upload, outside every scanned inbox."""
        return self.staging / f"{uuid.uuid4().hex}{Path(filename).suffix.lower()}"

    # ---- queue ---------------------------------------------------------

    def save(self, job):
        atomic_json(self.root / f'{job["id"]}.json', job)
        self.runtime.events.publish("imports")

    def list(self):
        with self.runtime.lock:
            return snapshot(list(self.jobs.values()))

    def enqueue(self, files: list[tuple[Path, str]]):
        with self.runtime.lock:
            pending = {
                item["source"]
                for job in self.jobs.values()
                for item in job["items"]
                if item["status"] in ACTIVE
            }
            items = [
                {"id": uuid.uuid4().hex, "source": str(source), "name": name, "status": "queued"}
                for source, name in files
                if str(source) not in pending
            ]
            if not items:
                raise InvalidRequest("These files are already being imported")
            job = {"id": uuid.uuid4().hex, "items": items}
            self.jobs[job["id"]] = job
            self.save(job)
            self.executor.submit(self.run, job)
            return snapshot(job)

    def retry(self, job_id):
        with self.runtime.lock:
            job = self.jobs.get(job_id)
            if job is None:
                raise NotFound(f"导入任务不存在：{job_id}")
            if any(item["status"] in ACTIVE for item in job["items"]):
                raise InvalidRequest("Import already running")
            for item in job["items"]:
                if item["status"] == "failed":
                    item.update(status="queued", error=None, step=None)
            self.save(job)
            self.executor.submit(self.run, job)
            return snapshot(job)

    # ---- execution -----------------------------------------------------

    def run(self, job):
        papers_dir = self.runtime.cfg.papers_dir
        dois, pub_nums, arxiv_ids = identifiers.collect_existing_ids(papers_dir)
        ingested = False
        for item in job["items"]:
            with self.runtime.lock:
                if item["status"] != "queued":
                    continue
                item.update(status="running", step=STEPS[0], error=None)
                self.save(job)
            try:
                result = self.import_file(
                    Path(item["source"]),
                    item["name"],
                    existing=(dois, pub_nums, arxiv_ids),
                    no_api=lookups_disabled(),
                    on_step=lambda step, item=item: self.record_step(job, item, step),
                )
            except Exception as exc:  # a failed item must not stop the batch
                result = {"status": "failed", "error": str(exc)}
            with self.runtime.lock:
                item.update(step=None, **result)
                self.save(job)
            ingested |= result["status"] in INGESTED
        if ingested:
            self.runtime.reindex()
            self.runtime.events.publish("papers")

    def record_step(self, job, item, step: str) -> None:
        with self.runtime.lock:
            item["step"] = step
            self.save(job)

    def import_file(
        self,
        source: Path,
        name: str,
        *,
        existing: tuple[dict, dict, dict] | None = None,
        no_api: bool = False,
        on_step: Callable[[str], None] | None = None,
    ) -> dict[str, Any]:
        """Run one file through the ingest pipeline and describe the outcome."""
        cfg = self.extraction_config()
        fingerprint = content_hash(source)
        already = self.runtime.papers.find_by_hash(fingerprint)
        if already is not None:
            return {"status": "duplicate", "paperId": already, "error": None}
        dois, pub_nums, arxiv_ids = existing or identifiers.collect_existing_ids(cfg.papers_dir)
        work = self.root / "work" / uuid.uuid4().hex
        work.mkdir(parents=True, exist_ok=True)
        staged = work / safe_name(name)
        # Files the queue already owns move; anything else is left where it is.
        if source.is_relative_to(self.root):
            shutil.move(str(source), staged)
        else:
            shutil.copy2(source, staged)
        ctx = InboxCtx(
            pdf_path=staged if staged.suffix.lower() == ".pdf" else None,
            inbox_dir=work,
            papers_dir=cfg.papers_dir,
            existing_dois=dois,
            cfg=cfg,
            # The browser has no review queue: a paper whose DOI cannot be found
            # is ingested with the gap recorded instead of being held back.
            opts={"no_doi_policy": "ingest", "no_api": no_api},
            pending_dir=cfg.pending_dir,
            md_path=staged if staged.suffix.lower() == ".md" else None,
            existing_pub_nums=pub_nums,
            existing_arxiv_ids=arxiv_ids,
        )
        report = (lambda step, _result: report_next(STEPS, step, on_step)) if on_step else None
        try:
            if run_file_steps(ctx, PARSE_STEPS, label=name, on_step=report):
                self.fill_missing_title(ctx, name)
                run_file_steps(ctx, STORE_STEPS, label=name, on_step=report)
            status = ctx.status if ctx.status != "pending" else "failed"
        finally:
            if ctx.status == "ingested" or not any(work.iterdir()):
                shutil.rmtree(work, ignore_errors=True)
        result = self.describe(ctx, status, work, staged)
        if result["status"] in INGESTED and ctx.ingested_json:
            # Remember the exact file, so re-uploading it is recognised even
            # when the paper carries no DOI.
            directory = ctx.ingested_json.parent
            meta = read_meta(directory)
            meta["hub"] = {**meta.get("hub", {}), "sha256": fingerprint, "filename": name}
            write_meta(directory, meta)
        return result

    def fill_missing_title(self, ctx: InboxCtx, name: str) -> None:
        """Fall back to the file's own title when extraction found none.

        Refusing the import would leave the user with a file the library never
        mentions; a titled paper flagged as incomplete can be corrected.
        """
        if ctx.meta is None or (ctx.meta.title or "").strip():
            return
        ctx.meta.title = embedded_title(ctx.pdf_path) or Path(name).stem
        ctx.meta.metadata_status = "incomplete"
        ctx.meta.missing_metadata = sorted({*ctx.meta.missing_metadata, "title"})
        if not ctx.meta.authors:
            author = embedded_author(ctx.pdf_path)
            if author:
                ctx.meta.authors = [author]

    def extraction_config(self):
        """Fall back to regex extraction when no LLM key is configured.

        The packaged default is `robust`, which needs an LLM. Without a key the
        extractor refuses to run at all, which would fail every import; regex
        extraction still yields a title, authors and often a DOI.
        """
        cfg = self.runtime.cfg
        if cfg.ingest.extractor in ("robust", "llm", "auto") and not cfg.resolved_api_key():
            cfg = copy.deepcopy(cfg)
            cfg.ingest.extractor = "regex"
        return cfg

    def describe(self, ctx: InboxCtx, status: str, work: Path, staged: Path) -> dict[str, Any]:
        if status == "ingested" and ctx.ingested_json:
            directory = ctx.ingested_json.parent
            meta = read_meta(directory)
            incomplete = meta.get("metadata_status") == "incomplete"
            return {
                "status": "completed_incomplete" if incomplete else "completed",
                "paperId": str(meta.get("id") or directory.name),
                "missingMetadata": list(meta.get("missing_metadata") or []),
                "error": None,
            }
        if status == "duplicate":
            directory = ctx.duplicate_of
            meta = read_meta(directory) if directory else {}
            return {
                "status": "duplicate",
                "paperId": str(meta.get("id") or (directory.name if directory else "")),
                "error": None,
            }
        # The file stays in its work directory so a retry can continue from it.
        return {
            "status": "needs_review" if status == "needs_review" else "failed",
            "source": str(staged) if staged.exists() else str(work),
            "error": ctx.error or f"导入未完成（{status}）",
        }


def embedded_title(pdf_path: Path | None) -> str:
    """The title the PDF itself carries, when it has one."""
    return _document_field(pdf_path, "title")


def embedded_author(pdf_path: Path | None) -> str:
    return _document_field(pdf_path, "author")


def _document_field(pdf_path: Path | None, field: str) -> str:
    if pdf_path is None or not pdf_path.exists():
        return ""
    import pymupdf

    try:
        with pymupdf.open(pdf_path) as document:
            return str((document.metadata or {}).get(field) or "").strip()
    except Exception:  # a file we could still parse for text may have broken metadata
        return ""


def report_next(steps: list[str], finished: str, on_step: Callable[[str], None]) -> None:
    """Report the step that starts next, so progress reflects current work."""
    position = steps.index(finished) + 1
    if position < len(steps):
        on_step(steps[position])


def safe_name(name: str) -> str:
    """Keep the user's filename readable without letting it escape the directory."""
    cleaned = Path(name).name.replace("\0", "")
    return cleaned or "upload.pdf"


__all__ = ["STEPS", "ImportQueue"]
