"""MinerU v1 task protocol (upload, poll, download) for locally hosted MinerU 4.x."""
from __future__ import annotations

import re
import shutil
import tempfile
import time
from pathlib import Path
from urllib.parse import urljoin, urlsplit
from zipfile import ZipFile

import requests

from scholaraio.core.archives import MAX_ARCHIVE_BYTES, extract_zip


def task_url(base: str, value: str) -> str:
    url = urljoin(base + "/", value)
    # A local parser must not send us to a different service or cloud bucket.
    left, right = urlsplit(base), urlsplit(url)
    if left.scheme not in {"http", "https"} or left.username or left.password or not left.hostname:
        raise ValueError("MinerU endpoint must be an HTTP(S) service URL without credentials")
    if (left.scheme, left.netloc) != (right.scheme, right.netloc):
        raise ValueError("MinerU returned a URL outside its configured service")
    return url


def convert_task(pdf: Path, md: Path, *, base: str, tier: str, mode: str,
                 timeout: int, start_page: int = 0, end_page: int = 99999) -> None:
    """Write one Markdown file and its relative assets; raise on every failed task."""
    base = base.rstrip("/")
    task_url(base, base)
    deadline = time.monotonic() + timeout

    def remaining() -> float:
        seconds = deadline - time.monotonic()
        if seconds <= 0:
            raise TimeoutError(f"MinerU parsing exceeded {timeout}s")
        return min(seconds, 60)

    payload = {"files": [{"file_name": pdf.name, "bytes": pdf.stat().st_size}], "ocr_mode": mode}
    if tier in {"flash", "basic"}:
        payload["tier"] = tier
    if start_page or end_page < 99999:
        payload["page_range"] = f"{start_page + 1}-{end_page + 1}" if end_page < 99999 else f"{start_page + 1}-"
    with requests.Session() as client:
        def request(method: str, url: str, **kwargs):
            response = client.request(method, url, allow_redirects=False, **kwargs)
            if 300 <= response.status_code < 400:
                response.close()
                raise ValueError("MinerU redirects are not supported; configure the final service URL")
            response.raise_for_status()
            return response

        response = request("POST", base + "/v1/tasks", json=payload, timeout=remaining())
        response.raise_for_status()
        task = response.json()
        task_id = task["task_id"]
        upload = task["files"][0].get("upload")
        if upload:
            with pdf.open("rb") as stream:
                response = request("PUT", task_url(base, upload["url"]), headers=upload.get("headers", {}),
                                      data=stream, timeout=remaining())
                response.raise_for_status()
        try:
            while True:
                response = request("GET", base + "/v1/tasks/" + task_id, timeout=remaining())
                response.raise_for_status()
                task = response.json()
                entry = task["files"][0]
                if entry["status"] == "completed":
                    result_url = task_url(base, entry["result_url"])
                    break
                if task["status"] in {"failed", "canceled", "partial", "completed"}:
                    raise ValueError(f"MinerU parsing failed: {entry.get('error') or task['status']}")
                time.sleep(min(1, remaining()))
        except TimeoutError:
            try:
                request("POST", base + "/v1/tasks/" + task_id + "/cancel", timeout=5)
            except (requests.RequestException, ValueError):
                pass
            raise
        with tempfile.TemporaryDirectory(prefix="mineru-result-") as name:
            root = Path(name)
            archive = root / "result.zip"
            with request("GET", result_url, stream=True, timeout=remaining()) as response:
                response.raise_for_status()
                size = 0
                with archive.open("wb") as stream:
                    for chunk in response.iter_content(1024 * 1024):
                        remaining()
                        size += len(chunk)
                        if size > MAX_ARCHIVE_BYTES:
                            raise ValueError("MinerU result exceeds 512 MiB")
                        stream.write(chunk)
            extracted = root / "extracted"
            extracted.mkdir()
            with ZipFile(archive) as bundle:
                extract_zip(bundle, extracted)
            candidates = list(extracted.rglob("*.md"))
            if len(candidates) != 1:
                raise ValueError("MinerU result must contain exactly one Markdown document")
            source = candidates[0]
            text = source.read_text(encoding="utf-8")
            if not text.strip():
                raise ValueError("MinerU returned empty Markdown")
            # Keep all relative image references valid, isolated from other PDFs' assets.
            assets = md.parent / f"{md.stem}_assets"
            if assets.exists():
                shutil.rmtree(assets)
            shutil.copytree(source.parent, assets)
            # The ingest pipeline relocates Markdown images later; use relative references.
            text = re.sub(r"(!\[[^\]]*\]\()([^):]+)(\))",
                          lambda match: match[1] + assets.name + "/" + match[2] + match[3], text)
            md.write_text(text, encoding="utf-8")
