"""Bounded ZIP extraction shared by parser results and portable document bundles."""
from __future__ import annotations

import shutil
import stat
from pathlib import Path, PurePosixPath
from zipfile import ZipFile

MAX_ARCHIVE_BYTES = 512 * 1024 * 1024
MAX_FILES = 5000


def extract_zip(
    archive: ZipFile, destination: Path, *,
    max_files: int | None = MAX_FILES, max_bytes: int | None = MAX_ARCHIVE_BYTES,
) -> None:
    members = archive.infolist()
    if ((max_files is not None and len(members) > max_files)
            or (max_bytes is not None and sum(member.file_size for member in members) > max_bytes)):
        raise ValueError("Archive exceeds the configured file count or expanded size limit")
    seen = set()
    for member in members:
        relative = PurePosixPath(member.filename)
        if (not relative.parts or relative.is_absolute() or ".." in relative.parts
                or "\\" in member.filename or ":" in member.filename or "\0" in member.filename
                or member.filename in seen or stat.S_ISLNK(member.external_attr >> 16)):
            raise ValueError("Archive contains an unsafe or duplicate path")
        seen.add(member.filename)
        target = destination.joinpath(*relative.parts)
        if not target.resolve().is_relative_to(destination.resolve()):
            raise ValueError("Archive path escapes destination")
        if member.is_dir():
            target.mkdir(parents=True, exist_ok=True)
        else:
            target.parent.mkdir(parents=True, exist_ok=True)
            with archive.open(member) as source, target.open("wb") as output:
                shutil.copyfileobj(source, output, length=1024 * 1024)
