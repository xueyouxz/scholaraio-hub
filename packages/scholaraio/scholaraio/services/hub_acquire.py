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

    def import_references(self, text: str) -> dict:
        """Fetch everything a BibTeX or RIS export names, and say what was missed.

        This is how a Zotero or EndNote library arrives: export it there, hand
        the file over here, and each entry is fetched by its own identifier.
        """
        entries = parse_references(text)
        if not entries:
            raise ValueError("没有从该文件中解析出条目，请导出 BibTeX 或 RIS 后重试")
        work = self.library.imports.root / "fetched"
        work.mkdir(parents=True, exist_ok=True)
        staged: list[tuple[Path, str]] = []
        skipped: list[dict] = []
        for entry in entries:
            try:
                downloaded, _ = self.download(entry["locator"], work)
            except (ValueError, OSError) as error:
                skipped.append({"title": entry["title"], "locator": entry["locator"], "error": str(error)})
                continue
            destination = self.library.imports.stage(downloaded.name)
            shutil.move(str(downloaded), destination)
            staged.append((destination, downloaded.name))
        if not staged:
            raise ValueError(f"共 {len(entries)} 条，全部未能获取 PDF；请检查网络或改用文件导入")
        job = self.library.imports.enqueue(staged)
        return {**job, "source": "references", "skipped": skipped}

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


DOI_FIELD = re.compile(r"\b(?:doi\s*[=:]\s*|DO\s+-\s+)\{?\s*(10\.\d{4,9}/[^\s,}\"']+)", re.IGNORECASE)
TITLE_FIELD = re.compile(r"\b(?:title\s*=\s*[{\"]|TI\s+-\s+)\s*([^\n}\"]+)", re.IGNORECASE)
ENTRY_LIMIT = 500


def parse_references(text: str) -> list[dict]:
    """Read a BibTeX or RIS export down to what the library can fetch with.

    Only the identifier and the title are taken: the metadata itself comes
    from the ingest pipeline, the same way an uploaded PDF's does.
    """
    blocks = re.split(r"\n(?=@)|\bER\s+-\s*\n", text)
    entries = []
    seen = set()
    for block in blocks:
        doi = DOI_FIELD.search(block)
        identifier = doi.group(1).rstrip(".,;") if doi else arxiv_id_in(block)
        if not identifier or identifier in seen:
            continue
        seen.add(identifier)
        title = TITLE_FIELD.search(block)
        entries.append({"locator": identifier, "title": title.group(1).strip() if title else identifier})
    return entries[:ENTRY_LIMIT]


def arxiv_id_in(block: str) -> str:
    """The arXiv id mentioned anywhere in this entry, if any."""
    match = ARXIV_URL.search(block) or re.search(r"arxiv\s*[=:]?\s*\{?\s*(\d{4}\.\d{4,5})", block, re.IGNORECASE)
    return match.group(1) if match else ""


__all__ = ["HubAcquire", "arxiv_id", "is_patent", "parse_references"]
