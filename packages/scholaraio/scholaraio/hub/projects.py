"""Managed literature projects backed by the existing workspace paper index.

A project is a directory under the workspace root, named by the user. Its id is
a UUID kept in a marker file inside that directory, so it stays the same when
the project is renamed: sessions and the browser refer to a project by id.
Every method also accepts the project's name, which agents and older records use.
"""

from __future__ import annotations

import json
import shutil
import uuid
from datetime import datetime, timezone
from pathlib import Path

from scholaraio.hub.errors import InvalidRequest, NotFound
from scholaraio.hub.runtime import LibraryRuntime
from scholaraio.hub.storage import atomic_json
from scholaraio.projects import workspace

NAME_LIMIT = 120
# Inside the project directory, so it moves with a rename and goes with an archive.
ID_FILE = ".scholaraio-project.json"


def is_project_id(value: str) -> bool:
    try:
        return str(uuid.UUID(value)) == value
    except ValueError:
        return False


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
            raise InvalidRequest("Library project directories must be inside the application data directory")

    def resolve(self, project: str) -> Path:
        """The directory of a project named by its id, or by its name."""
        if not is_project_id(project):
            return self.directory(project)
        for directory in self.directories():
            if self.identity(directory) == project:
                return directory
        raise NotFound(f"Library project not found: {project}", code="PROJECT_NOT_FOUND")

    def directories(self) -> list[Path]:
        if not self.root.exists():
            return []
        return [
            d
            for d in sorted(self.root.iterdir())
            if d.is_dir()
            and not d.name.startswith(".")
            and (workspace.has_paper_index(d) or workspace.has_legacy_paper_index(d))
        ]

    def identity(self, directory: Path) -> str:
        """The project's id; a project from before ids existed is given one now."""
        marker = directory / ID_FILE
        try:
            value = json.loads(marker.read_text(encoding="utf-8"))["id"]
        except FileNotFoundError:
            value = str(uuid.uuid4())
            atomic_json(marker, {"id": value})
            return value
        except (OSError, ValueError, KeyError, TypeError) as error:
            raise RuntimeError(f"Cannot read project identity file: {marker}") from error
        if not isinstance(value, str) or not is_project_id(value):
            raise RuntimeError(f"Invalid project identity file: {marker}")
        return value

    def directory(self, name: str, *, existing: bool = True) -> Path:
        """The directory a project name stands for, checked to stay inside the workspace root."""
        project_id = name
        if (
            not workspace.validate_workspace_name(project_id)
            or project_id.startswith(".")
            or len(project_id) > NAME_LIMIT
            or any(ord(c) < 32 for c in project_id)
            or is_project_id(project_id)
        ):
            raise InvalidRequest("Invalid project name: path separators are not allowed")
        directory = self.root / project_id
        if not directory.resolve().is_relative_to(self.root):
            raise InvalidRequest("Project directory is outside the managed area")
        for relative in ("refs", "refs/papers.json", "papers.json"):
            if not (directory / relative).resolve().is_relative_to(directory.resolve()):
                raise InvalidRequest("Project index is outside the project directory")
        if existing and not workspace.has_paper_index(directory):
            if workspace.has_legacy_paper_index(directory):
                raise InvalidRequest(f"Project {project_id} uses legacy papers.json. Migrate to refs/papers.json first")
            raise NotFound(f"Library project not found: {project_id}", code="PROJECT_NOT_FOUND")
        return directory

    def get(self, project: str) -> dict:
        with self.runtime.lock:
            return self.describe(self.resolve(project))

    def describe(self, directory: Path) -> dict:
        with self.runtime.lock:
            ids = sorted(workspace.read_paper_ids(directory))
            return {
                "id": self.identity(directory),
                "name": directory.name,
                # The agent works in this directory; only this module resolves it.
                "path": str(directory),
                "paperIds": ids,
                "paperCount": len(ids),
            }

    def list(self) -> list[dict]:
        with self.runtime.lock:
            return [self.describe(self.directory(d.name)) for d in self.directories()]

    def create(self, name: str) -> dict:
        with self.runtime.lock:
            directory = self.directory(name, existing=False)
            if directory.exists():
                raise InvalidRequest("A project or directory with this name already exists")
            workspace.create(directory)
            self.scaffold(directory, name)
            return self.describe(directory)

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

    def rename(self, project: str, name: str) -> dict:
        """Rename the project's directory; its id, and so every reference to it, stays."""
        with self.runtime.lock:
            directory = self.resolve(project)
            self.identity(directory)
            target = self.directory(name, existing=False)
            if target.exists():
                raise InvalidRequest("The target project name is already in use")
            return self.describe(workspace.rename(self.root, directory.name, name))

    def delete(self, project: str) -> dict:
        """Move a project aside instead of deleting the agent's work outright."""
        with self.runtime.lock:
            directory = self.resolve(project)
            project_id = self.identity(directory)
            stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
            trash = self.root / ".trash" / f"{directory.name}-{stamp}"
            trash.parent.mkdir(parents=True, exist_ok=True)
            shutil.move(str(directory), str(trash))
            return {"id": project_id, "archivedAt": stamp, "path": str(trash)}

    def update_papers(self, project: str, paper_ids: list[str], action: str) -> dict:
        with self.runtime.lock:
            directory = self.resolve(project)
            if action == "add":
                resolved = [
                    {"id": pid, "dir_name": self.runtime.papers.find(pid).directory.name}
                    for pid in dict.fromkeys(paper_ids)
                ]
                workspace.add(directory, [], self.runtime.cfg.index_db, resolved=resolved)
            elif action == "remove":
                workspace.remove(directory, paper_ids, self.runtime.cfg.index_db)
            else:
                raise InvalidRequest(f"Unknown project paper operation: {action}")
            return self.describe(directory)

    def scope(self, project_id: str | None, paper_ids: list[str]) -> list[str] | None:
        """Resolve a selection to paper ids.

        ``None`` means the whole library; ``[]`` means an explicitly empty project.
        """
        with self.runtime.lock:
            available = self.runtime.papers.ids()
            selected = set(paper_ids)
            if selected - available:
                raise InvalidRequest("Selected papers no longer exist. Select them again")
            if project_id:
                members = set(self.get(project_id)["paperIds"])
                if selected - members:
                    raise InvalidRequest("Selected papers do not belong to this project. Select them again")
                return sorted(selected or (members & available))
            return sorted(selected) if selected else None

    def scope_set(self, project_id: str | None) -> set[str] | None:
        """The papers a project limits a query to; ``None`` for the whole library."""
        if not project_id:
            return None
        ids = self.scope(project_id, [])
        return set(ids) if ids is not None else None


__all__ = ["AGENTS_GUIDE", "ProjectService"]
