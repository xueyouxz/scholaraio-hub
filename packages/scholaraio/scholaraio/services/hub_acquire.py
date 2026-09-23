"""Fetch a paper the library does not have yet, from what the user can name.

A DOI, an arXiv id, a patent number, a landing page or a direct PDF link all
end the same way: a file staged for the import queue, which then runs the
ordinary ingest pipeline over it.
"""
from __future__ import annotations

import re
import shutil
from pathlib import Path

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


class HubAcquire:
    """Download by identifier, then hand the file to the import queue."""

    def __init__(self, library):
        self.library = library

    def fetch(self, locator: str) -> dict:
        """Download what this locator names and queue it for import."""
        locator = locator.strip()
        if not locator:
            raise ValueError("请填写 DOI、arXiv 编号、专利号或论文链接")
        work = self.library.imports.root / "fetched"
        work.mkdir(parents=True, exist_ok=True)
        downloaded, source = self.download(locator, work)
        staged = self.library.imports.stage(downloaded.name)
        shutil.move(str(downloaded), staged)
        job = self.library.imports.enqueue([(staged, downloaded.name)])
        return {**job, "source": source}

    def download(self, locator: str, work: Path) -> tuple[Path, str]:
        identifier = arxiv_id(locator)
        if identifier:
            return self.download_url(f"https://arxiv.org/pdf/{identifier}", work), "arxiv"
        if is_patent(locator):
            from scholaraio.services.patent_fetch import download_patent_pdf

            path = download_patent_pdf(locator, output_dir=work, cfg=self.library.cfg)
            if path is None:
                raise ValueError(f"未能下载该专利：{locator}")
            return Path(path), "patent"
        return self.download_url(locator, work), "doi"

    def download_url(self, locator: str, work: Path) -> Path:
        import requests

        from scholaraio.services.pdf_fetch import PdfFetchError, fetch_pdf

        try:
            result = fetch_pdf(locator, work)
        except (PdfFetchError, requests.RequestException) as error:
            raise ValueError(f"未能获取 PDF：{error}") from error
        if result.path is None:
            raise ValueError(f"未能获取 PDF：{result.message or locator}")
        return result.path


__all__ = ["HubAcquire", "arxiv_id", "is_patent"]
