"""Durable file primitives every Hub record goes through.

A reader never sees half a file: content goes to a private temporary file,
reaches the disk, then replaces the target in one rename.
"""
from __future__ import annotations

import hashlib
import json
import os
import uuid
from pathlib import Path


def atomic_write_text(path: Path, text: str, *, replace: bool = True) -> bool:
    """Write ``text`` to ``path`` atomically, readable by this user only.

    With ``replace=False`` an existing file is kept; returns whether this call
    wrote the file.
    """
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(f".{path.name}.{uuid.uuid4().hex}.tmp")
    try:
        with temporary.open("x", encoding="utf-8") as output:
            temporary.chmod(0o600)
            output.write(text)
            output.flush()
            os.fsync(output.fileno())
        # Another writer may have won the race; keep what it wrote.
        if not replace and path.exists():
            return False
        temporary.replace(path)
        return True
    finally:
        temporary.unlink(missing_ok=True)


def atomic_json(path: Path, value: object) -> None:
    atomic_write_text(path, json.dumps(value, ensure_ascii=False, indent=2))


def content_hash(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as file:
        for block in iter(lambda: file.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


__all__ = ["atomic_json", "atomic_write_text", "content_hash"]
