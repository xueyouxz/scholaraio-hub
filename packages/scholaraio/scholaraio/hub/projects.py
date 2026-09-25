"""Managed literature projects backed by the existing workspace paper index."""
from __future__ import annotations

import shutil
from datetime import datetime, timezone
from pathlib import Path

from scholaraio.hub.errors import InvalidRequest, NotFound
from scholaraio.hub.runtime import LibraryRuntime
from scholaraio.projects import workspace

NAME_LIMIT = 120

AGENTS_GUIDE = """\
# 文献项目 {name}

这是一个 ScholarAIO Hub 文献项目目录，也是你的工作目录。

- `refs/papers.json`：本项目的文献集，引用主库中的论文 UUID。
- `outputs/`：产出文件默认放这里。

## 查询文献

用 `--ws {name}` 把命令限定在本项目：

```bash
scholaraio usearch "<查询词>" --ws {name}    # 融合检索
scholaraio ws show {name}                     # 列出项目文献
scholaraio refs <论文标识> --ws {name}        # 参考文献
scholaraio citing <论文标识> --ws {name}      # 库内被引
```

## 写操作

写操作由 Hub 统一执行。下面这些命令可以直接用，它们会转交 Hub 排队执行：

```bash
scholaraio ws add/remove <论文标识> --ws {name}   # 增删项目文献
scholaraio fetch-pdf <DOI 或链接>                 # 获取并入库
scholaraio arxiv fetch <arXiv 编号>
scholaraio patent-fetch <专利号>
scholaraio embed                                  # 准备语义检索
scholaraio topics --build                         # 构建主题
scholaraio enrich-toc / enrich-l3                 # 深度解析
```

带 `--force`、`--dry-run`、`--rebuild` 等 Hub 不提供的选项时命令会停用，
请改在前端触发。
"""


class ProjectService:
    def __init__(self, runtime: LibraryRuntime):
        self.runtime = runtime
        self.root = runtime.cfg.workspace_dir.resolve()
        if not self.root.is_relative_to(runtime.root):
            raise InvalidRequest("文献项目目录必须位于应用数据目录内")

    def directory(self, project_id: str, *, existing: bool = True) -> Path:
        if (not workspace.validate_workspace_name(project_id) or project_id.startswith(".")
                or len(project_id) > NAME_LIMIT or any(ord(c) < 32 for c in project_id)):
            raise InvalidRequest("项目名称无效：请使用不含路径分隔符的名称")
        directory = self.root / project_id
        if not directory.resolve().is_relative_to(self.root):
            raise InvalidRequest("项目目录超出受管理范围")
        for relative in ("refs", "refs/papers.json", "papers.json"):
            if not (directory / relative).resolve().is_relative_to(directory.resolve()):
                raise InvalidRequest("项目索引超出项目目录")
        if existing and not workspace.has_paper_index(directory):
            if workspace.has_legacy_paper_index(directory):
                raise InvalidRequest(f"项目 {project_id} 使用旧 papers.json，请先迁移到 refs/papers.json")
            raise NotFound(f"文献项目不存在：{project_id}")
        return directory

    def get(self, project_id: str) -> dict:
        with self.runtime.lock:
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

    def list(self) -> list[dict]:
        with self.runtime.lock:
            if not self.root.exists():
                return []
            return [self.get(d.name) for d in sorted(self.root.iterdir())
                    if d.is_dir() and not d.name.startswith(".")
                    and (workspace.has_paper_index(d) or workspace.has_legacy_paper_index(d))]

    def create(self, name: str) -> dict:
        with self.runtime.lock:
            directory = self.directory(name, existing=False)
            if directory.exists():
                raise InvalidRequest("项目或同名目录已存在")
            workspace.create(directory)
            self.scaffold(directory, name)
            return self.get(name)

    def scaffold(self, directory: Path, name: str) -> None:
        """Tell an agent working here what this directory is.

        Written once, at creation: afterwards the file belongs to the user and
        the agents working in the project.
        """
        (directory / "outputs").mkdir(exist_ok=True)
        guide = directory / "AGENTS.md"
        if guide.exists():
            return
        guide.write_text(AGENTS_GUIDE.format(name=name), encoding="utf-8")

    def rename(self, project_id: str, name: str) -> dict:
        with self.runtime.lock:
            self.directory(project_id)
            target = self.directory(name, existing=False)
            if target.exists():
                raise InvalidRequest("目标项目名称已被占用")
            workspace.rename(self.root, project_id, name)
            return self.get(name)

    def delete(self, project_id: str) -> dict:
        """Move a project aside instead of deleting the agent's work outright."""
        with self.runtime.lock:
            directory = self.directory(project_id)
            stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
            trash = self.root / ".trash" / f"{project_id}-{stamp}"
            trash.parent.mkdir(parents=True, exist_ok=True)
            shutil.move(str(directory), str(trash))
            return {"id": project_id, "archivedAt": stamp, "path": str(trash)}

    def update_papers(self, project_id: str, paper_ids: list[str], action: str) -> dict:
        with self.runtime.lock:
            directory = self.directory(project_id)
            if action == "add":
                resolved = [
                    {"id": pid, "dir_name": self.runtime.papers.find(pid).directory.name}
                    for pid in dict.fromkeys(paper_ids)
                ]
                workspace.add(directory, [], self.runtime.cfg.index_db, resolved=resolved)
            elif action == "remove":
                workspace.remove(directory, paper_ids, self.runtime.cfg.index_db)
            else:
                raise InvalidRequest(f"未知的项目文献操作：{action}")
            return self.get(project_id)

    def scope(self, project_id: str | None, paper_ids: list[str]) -> list[str] | None:
        """Resolve a selection to paper ids.

        ``None`` means the whole library; ``[]`` means an explicitly empty project.
        """
        with self.runtime.lock:
            available = self.runtime.papers.ids()
            selected = set(paper_ids)
            if selected - available:
                raise InvalidRequest("选中的文献已不存在，请重新选择")
            if project_id:
                members = set(self.get(project_id)["paperIds"])
                if selected - members:
                    raise InvalidRequest("选中的文献不属于当前项目，请重新选择")
                return sorted(selected or (members & available))
            return sorted(selected) if selected else None

    def scope_set(self, project_id: str | None) -> set[str] | None:
        """The papers a project limits a query to; ``None`` for the whole library."""
        if not project_id:
            return None
        ids = self.scope(project_id, [])
        return set(ids) if ids is not None else None


__all__ = ["AGENTS_GUIDE", "ProjectService"]
