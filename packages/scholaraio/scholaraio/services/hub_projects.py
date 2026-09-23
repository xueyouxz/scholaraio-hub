"""Managed literature projects backed by the existing workspace paper index."""
from __future__ import annotations

import shutil
from datetime import datetime, timezone
from pathlib import Path

from scholaraio.projects import workspace


class HubProjects:
    def __init__(self, library):
        self.library = library
        self.root = library.cfg.workspace_dir.resolve()
        if not self.root.is_relative_to(library.root):
            raise ValueError("文献项目目录必须位于应用数据目录内")

    def directory(self, project_id: str, *, existing: bool = True) -> Path:
        if (not workspace.validate_workspace_name(project_id) or project_id.startswith(".")
                or len(project_id) > 120 or any(ord(c) < 32 for c in project_id)):
            raise ValueError("项目名称无效：请使用不含路径分隔符的名称")
        directory = self.root / project_id
        if not directory.resolve().is_relative_to(self.root):
            raise ValueError("项目目录超出受管理范围")
        for relative in ("refs", "refs/papers.json", "papers.json"):
            if not (directory / relative).resolve().is_relative_to(directory.resolve()):
                raise ValueError("项目索引超出项目目录")
        if existing and not workspace.has_paper_index(directory):
            if workspace.has_legacy_paper_index(directory):
                raise ValueError(f"项目 {project_id} 使用旧 papers.json，请先迁移到 refs/papers.json")
            raise KeyError(f"文献项目不存在：{project_id}")
        return directory

    def get(self, project_id: str):
        with self.library.lock:
            directory = self.directory(project_id)
            ids = sorted(workspace.read_paper_ids(directory))
            return {
                "id": project_id,
                "name": project_id,
                # The agent works in this directory; only this module resolves it.
                "path": str(directory),
                "paperIds": ids,
                "paperCount": len(ids),
            }

    def list(self):
        with self.library.lock:
            if not self.root.exists():
                return []
            return [self.get(d.name) for d in sorted(self.root.iterdir())
                    if d.is_dir() and not d.name.startswith(".")
                    and (workspace.has_paper_index(d) or workspace.has_legacy_paper_index(d))]

    def create(self, name: str):
        with self.library.lock:
            directory = self.directory(name, existing=False)
            if directory.exists():
                raise ValueError("项目或同名目录已存在")
            workspace.create(directory)
            return self.get(name)

    def rename(self, project_id: str, name: str):
        with self.library.lock:
            self.directory(project_id)
            target = self.directory(name, existing=False)
            if target.exists():
                raise ValueError("目标项目名称已被占用")
            workspace.rename(self.root, project_id, name)
            return self.get(name)

    def delete(self, project_id: str):
        """Move a project aside instead of deleting the agent's work outright."""
        with self.library.lock:
            directory = self.directory(project_id)
            stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
            trash = self.root / ".trash" / f"{project_id}-{stamp}"
            trash.parent.mkdir(parents=True, exist_ok=True)
            shutil.move(str(directory), str(trash))
            return {"id": project_id, "archivedAt": stamp, "path": str(trash)}

    def update_papers(self, project_id: str, paper_ids: list[str], action: str):
        with self.library.lock:
            directory = self.directory(project_id)
            if action == "add":
                resolved = []
                for pid in dict.fromkeys(paper_ids):
                    paper_dir, _ = self.library.find(pid)
                    resolved.append({"id": pid, "dir_name": paper_dir.name})
                workspace.add(directory, [], self.library.cfg.index_db, resolved=resolved)
            else:
                workspace.remove(directory, paper_ids, self.library.cfg.index_db)
            return self.get(project_id)

    def scope(self, project_id: str | None, paper_ids: list[str]) -> list[str] | None:
        """None means whole library; [] means an explicitly empty project."""
        with self.library.lock:
            available = {paper["id"] for paper in self.library.papers()}
            selected = set(paper_ids)
            if selected - available:
                raise ValueError("选中的文献已不存在，请重新选择")
            if project_id:
                members = set(self.get(project_id)["paperIds"])
                if selected - members:
                    raise ValueError("选中的文献不属于当前项目，请重新选择")
                return sorted(selected or (members & available))
            return sorted(selected) if selected else None
