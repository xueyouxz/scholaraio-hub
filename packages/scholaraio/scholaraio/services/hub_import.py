"""Import queue that runs uploaded files through the ScholarAIO ingest pipeline.

Each item runs the same steps as ``scholaraio pipeline``—parse, extract
metadata, look up and deduplicate, ingest—so a paper imported from the browser
carries the DOI, identifiers and citation data the rest of the library depends
on. The queue owns per-item staging, status and retry; the pipeline owns the
work.
"""
from __future__ import annotations

import copy as copy_module
import json
import shutil
import uuid
from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Any

from scholaraio.services.ingest import identifiers
from scholaraio.services.ingest.inbox_orchestration import run_file_steps
from scholaraio.services.ingest.types import InboxCtx
from scholaraio.stores.papers import iter_paper_dirs, read_meta, write_meta

STEPS = ["mineru", "extract", "dedup", "ingest"]
# Split so the queue can fill gaps the browser can live with (a missing title)
# between reading the file and committing it to the library.
PARSE_STEPS = STEPS[:2]
STORE_STEPS = STEPS[2:]
ACTIVE = ("queued", "running")
# Statuses that leave a usable paper behind.
INGESTED = ("completed", "completed_incomplete")


def copy(value):
    return json.loads(json.dumps(value))


class ImportQueue:
    """Serial import worker owned by one :class:`HubLibrary`."""

    def __init__(self, library):
        self.library = library
        self.root = library.cfg.state_root / "imports"
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
        from scholaraio.services.hub_library import atomic_json

        atomic_json(self.root / f'{job["id"]}.json', job)

    def list(self):
        with self.library.lock:
            return copy(list(self.jobs.values()))

    def enqueue(self, files: list[tuple[Path, str]]):
        with self.library.lock:
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
                raise ValueError("These files are already being imported")
            job = {"id": uuid.uuid4().hex, "items": items}
            self.jobs[job["id"]] = job
            self.save(job)
            self.executor.submit(self.run, job)
            return copy(job)

    def retry(self, job_id):
        with self.library.lock:
            job = self.jobs[job_id]
            if any(item["status"] in ACTIVE for item in job["items"]):
                raise ValueError("Import already running")
            for item in job["items"]:
                if item["status"] == "failed":
                    item.update(status="queued", error=None, step=None)
            self.save(job)
            self.executor.submit(self.run, job)
            return copy(job)

    # ---- execution -----------------------------------------------------

    def run(self, job):
        papers_dir = self.library.cfg.papers_dir
        dois, pub_nums, arxiv_ids = identifiers.collect_existing_ids(papers_dir)
        ingested = False
        for item in job["items"]:
            with self.library.lock:
                if item["status"] != "queued":
                    continue
                item.update(status="running", step=STEPS[0], error=None)
                self.save(job)
            try:
                result = self.import_file(
                    Path(item["source"]),
                    item["name"],
                    existing=(dois, pub_nums, arxiv_ids),
                    on_step=lambda step, item=item: self.record_step(job, item, step),
                )
            except Exception as exc:  # a failed item must not stop the batch
                result = {"status": "failed", "error": str(exc)}
            with self.library.lock:
                item.update(step=None, **result)
                self.save(job)
            ingested |= result["status"] in INGESTED
        if ingested:
            self.library.reindex()

    def record_step(self, job, item, step: str) -> None:
        with self.library.lock:
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
        from scholaraio.services.hub_library import content_hash

        cfg = self.extraction_config()
        fingerprint = content_hash(source)
        already = self.find_by_hash(fingerprint)
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
        """Title the paper after its file when extraction found none.

        Refusing the import would leave the user with a file the library never
        mentions; a titled paper flagged as incomplete can be corrected.
        """
        if ctx.meta is None or (ctx.meta.title or "").strip():
            return
        ctx.meta.title = Path(name).stem
        ctx.meta.metadata_status = "incomplete"
        ctx.meta.missing_metadata = sorted({*ctx.meta.missing_metadata, "title"})

    def extraction_config(self):
        """Fall back to regex extraction when no LLM key is configured.

        The packaged default is `robust`, which needs an LLM. Without a key the
        extractor refuses to run at all, which would fail every import; regex
        extraction still yields a title, authors and often a DOI.
        """
        cfg = self.library.cfg
        if cfg.ingest.extractor in ("robust", "llm", "auto") and not cfg.resolved_api_key():
            cfg = copy_module.deepcopy(cfg)
            cfg.ingest.extractor = "regex"
        return cfg

    def find_by_hash(self, fingerprint: str) -> str | None:
        """Return the paper already holding this exact file, if any."""
        for directory in iter_paper_dirs(self.library.cfg.papers_dir):
            meta = read_meta(directory)
            if meta.get("hub", {}).get("sha256") == fingerprint:
                return str(meta.get("id") or directory.name)
        return None

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
