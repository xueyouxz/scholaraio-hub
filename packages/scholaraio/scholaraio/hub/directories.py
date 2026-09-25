"""The library's directories on this machine, shown in the desktop's file manager."""
from __future__ import annotations

import logging
import subprocess
import sys
from collections.abc import Callable
from pathlib import Path

from scholaraio.hub.errors import InvalidRequest
from scholaraio.hub.runtime import LibraryRuntime

_log = logging.getLogger("scholaraio.hub.directories")

TARGETS = ("data", "papers", "workspaces")


def open_in_file_manager(directory: Path) -> None:
    """Show a directory in the platform's file manager, without waiting for it."""
    if sys.platform == "darwin":
        command = ["open", str(directory)]
    elif sys.platform == "win32":
        command = ["explorer.exe", str(directory)]
    else:
        command = ["xdg-open", str(directory)]
    subprocess.Popen(command, stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL,
                     stderr=subprocess.DEVNULL, start_new_session=True)


class DirectoryService:
    def __init__(self, runtime: LibraryRuntime, opener: Callable[[Path], None] = open_in_file_manager):
        self.runtime = runtime
        self.opener = opener

    def path(self, target: str) -> Path:
        """One of the library's own directories; the request only names which."""
        cfg = self.runtime.cfg
        if target == "data":
            return self.runtime.root
        if target == "papers":
            directory = cfg.papers_dir
        elif target == "workspaces":
            directory = cfg.workspace_dir
        else:
            raise InvalidRequest(f"未知的目录：{target}")
        return self.runtime.require_inside(directory, "该目录不在数据目录内，不能从这里打开")

    def reveal(self, target: str) -> dict:
        directory = self.path(target)
        try:
            self.opener(directory)
        except OSError as error:
            _log.error("Could not open %s", directory, exc_info=error)
            raise RuntimeError(f"无法打开目录 {directory}：{error}") from error
        return {"opened": True, "path": str(directory)}


__all__ = ["TARGETS", "DirectoryService", "open_in_file_manager"]
