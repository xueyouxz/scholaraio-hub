"""Application configuration file owned by Hub and shared with the CLI.

Both the Hub service and any ``scholaraio`` CLI run started by an agent must
resolve the same library. The CLI resolves relative paths against the directory
holding ``config.yaml``, so the file has to exist inside the application data
directory before ``SCHOLARAIO_CONFIG`` can point at it.
"""
from __future__ import annotations

import os
import uuid
from pathlib import Path

from scholaraio.core.config import Config, load_config

TEMPLATE = """\
# ScholarAIO Hub 应用配置。
#
# 由 Hub 自动创建，之后不再覆盖。所有相对路径以本文件所在目录为准，
# 因此 Hub 与 `scholaraio` CLI 共享同一份文献数据。
#
# 本地覆盖写入同目录的 config.local.yaml，它的同名字段优先。
"""


def config_path(root: Path) -> Path:
    return root / "config.yaml"


def ensure_config(root: Path) -> Config:
    """Return the application config, creating the file when it is missing."""
    path = config_path(root)
    if not path.exists():
        write_template(path)
    config = load_config(path)
    # load_config falls back to the caller's cwd when the file disappeared
    # between the check and the read; an unrelated root is never acceptable.
    config._root = root
    return config


def write_template(path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(f".{path.name}.{uuid.uuid4().hex}.tmp")
    try:
        with temporary.open("x", encoding="utf-8") as output:
            temporary.chmod(0o600)
            output.write(TEMPLATE)
            output.flush()
            os.fsync(output.fileno())
        # Another starter may have won the race; keep the existing file.
        if not path.exists():
            temporary.replace(path)
    finally:
        temporary.unlink(missing_ok=True)
