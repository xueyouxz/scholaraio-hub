"""Fetch a paper the library does not have yet, from what the user can name.

A DOI, an arXiv id, a patent number, a landing page or a direct PDF link all
end the same way: a file staged for the import queue, which then runs the
ordinary ingest pipeline over it.
"""

from __future__ import annotations

import re
import shutil
from pathlib import Path

from scholaraio.hub.errors import InvalidRequest
from scholaraio.hub.imports import ImportQueue
from scholaraio.hub.runtime import LibraryRuntime

ARXIV = re.compile(r"^(?:arxiv:)?(\d{4}\.\d{4,5}(?:v\d+)?)$", re.IGNORECASE)
ARXIV_URL = re.compile(r"arxiv\.org/(?:abs|pdf)/(\d{4}\.\d{4,5}(?:v\d+)?)", re.IGNORECASE)
PATENT = re.compile(r"^(?:[A-Z]{2})\d{6,}[A-Z]?\d?$", re.IGNORECASE)
PATENT_URL = re.compile(r"patents\.google\.com/patent/", re.IGNORECASE)


def arxiv_id(locator: str) -> str:
    """The arXiv id this locator names, if it names one."""
    match = ARXIV.match(locator.strip()) or ARXIV_URL.search(locator)
    return match.group(1) if match else ""


def is_patent(locator: str) -> bool:
    text = locator.strip()
    return bool(PATENT_URL.search(text) or PATENT.match(text.replace(" ", "")))


class AcquireService:
    """Download by identifier, then hand the file to the import queue."""

    def __init__(self, runtime: LibraryRuntime, imports: ImportQueue):
        self.runtime = runtime
        self.imports = imports

    @property
    def work(self) -> Path:
        """Where downloads land before the import queue takes them over."""
        work = self.imports.root / "fetched"
        work.mkdir(parents=True, exist_ok=True)
        return work

    def fetch(self, locator: str, collection_id: str | None = None, title: str | None = None) -> dict:
        """Download what this locator names and queue it for import."""
        locator = locator.strip()
        if not locator:
            raise InvalidRequest("Provide a DOI, arXiv ID, patent number, or paper URL")
        downloaded, source = self.download(locator, self.work)
        job = self.imports.enqueue([self.stage(downloaded)], collection_id, title=title)
        return {**job, "source": source}

    def stage(self, downloaded: Path) -> tuple[Path, str]:
        """Hand a download to the import queue's private staging area."""
        staged = self.imports.stage(downloaded.name)
        shutil.move(str(downloaded), staged)
        return staged, downloaded.name

    def download(self, locator: str, work: Path) -> tuple[Path, str]:
        identifier = arxiv_id(locator)
        if identifier:
            return self.download_url(f"https://arxiv.org/pdf/{identifier}", work), "arxiv"
        if is_patent(locator):
            from scholaraio.services.patent_fetch import download_patent_pdf

            path = download_patent_pdf(locator, output_dir=work, cfg=self.runtime.cfg)
            if path is None:
                raise InvalidRequest(f"Unable to download patent: {locator}")
            return Path(path), "patent"
        return self.download_url(locator, work), "doi"

    def download_url(self, locator: str, work: Path) -> Path:
        import requests

        from scholaraio.services.pdf_fetch import PdfFetchError, fetch_pdf

        try:
            result = fetch_pdf(locator, work)
        except (PdfFetchError, requests.RequestException) as error:
            raise InvalidRequest(f"Unable to retrieve PDF: {error}") from error
        if result.path is None:
            raise InvalidRequest(f"Unable to retrieve PDF: {result.message or locator}")
        return result.path


__all__ = ["AcquireService", "arxiv_id", "is_patent"]
