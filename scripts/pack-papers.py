#!/usr/bin/env python3
"""Create uploadable ScholarAIO bundles using only Python's standard library.

Usage: python3 scripts/pack-papers.py /path/to/papers --output /path/to/upload-bundles
Source files are read only. Run against a library that is not being edited.
"""

import argparse
import json
import sys
import tempfile
from dataclasses import dataclass
from pathlib import Path, PurePosixPath
from zipfile import ZIP_DEFLATED, ZipFile

# Conservative batch budgets leave room below the import endpoint's limits.
MAX_PAPERS = 100
MAX_BYTES = 400 * 1024 * 1024
MAX_FILES = 4000
ARTIFACT_SUFFIXES = {".pdf", ".md", ".png", ".jpg", ".jpeg", ".webp", ".gif"}


@dataclass
class Paper:
    directory: Path
    paper_id: str
    metadata: bytes
    files: list[tuple[Path, str]]
    size: int


def json_bytes(value: object) -> bytes:
    return json.dumps(value, ensure_ascii=False, indent=2, allow_nan=False).encode("utf-8")


def validate_metadata(meta: dict) -> None:
    for key in ("title", "doi", "journal", "abstract", "paper_type", "metadata_status"):
        if key in meta and not isinstance(meta[key], str):
            raise ValueError(f"元数据字段 {key} 必须是字符串")
    authors = meta.get("authors", [])
    if not isinstance(authors, (str, list)) or (
        isinstance(authors, list) and any(not isinstance(author, str) for author in authors)
    ):
        raise ValueError("authors 必须是字符串或字符串数组")
    if "year" in meta and not isinstance(meta["year"], (str, int)):
        raise ValueError("year 必须是字符串或整数")
    missing = meta.get("missing_metadata", [])
    if not isinstance(missing, list) or any(not isinstance(key, str) for key in missing):
        raise ValueError("missing_metadata 必须是字符串数组")
    if "metadata_status" in meta and meta["metadata_status"] not in {"complete", "incomplete"}:
        raise ValueError("metadata_status 必须是 complete 或 incomplete")
    hub = meta.get("hub", {})
    if not isinstance(hub, dict) or (
        "category" in hub and not isinstance(hub["category"], str)
    ):
        raise ValueError("hub 必须是对象，hub.category 必须是字符串")


def read_paper(directory: Path) -> Paper:
    metadata_path = directory / "meta.json"
    markdown_path = directory / "paper.md"
    if metadata_path.is_symlink() or markdown_path.is_symlink():
        raise ValueError("meta.json 和 paper.md 不能是符号链接")
    meta = json.loads(metadata_path.read_text(encoding="utf-8-sig"))
    if not isinstance(meta, dict):
        raise ValueError("meta.json 必须是 JSON 对象")
    meta = {key: value for key, value in meta.items() if value is not None}
    pid = meta.get("id", directory.name)
    if not isinstance(pid, str) or not pid.strip() or len(pid) > 200:
        raise ValueError("论文 ID 必须是长度不超过 200 的非空字符串")
    meta["id"] = pid
    validate_metadata(meta)
    markdown_path.read_text(encoding="utf-8")
    files = []
    size = 0
    for file in sorted(directory.rglob("*")):
        relative = file.relative_to(directory).as_posix()
        if any(part.startswith(".") for part in PurePosixPath(relative).parts):
            continue
        if file.is_symlink():
            raise ValueError(f"文件不能是符号链接：{relative}")
        if not file.is_file() or file.suffix.lower() not in ARTIFACT_SUFFIXES:
            continue
        if any(char in relative for char in ("\\", ":", "\0")):
            raise ValueError(f"文件名不适合文献包格式：{relative}")
        files.append((file, relative))
        size += file.stat().st_size
    metadata = json_bytes(meta)
    return Paper(directory, pid, metadata, files, size + len(metadata))


def manifest(papers: list[Paper]) -> bytes:
    return json_bytes({
        "format": "scholaraio-library",
        "version": 1,
        "papers": [
            {"path": f"papers/{index:04d}", "id": paper.paper_id}
            for index, paper in enumerate(papers, 1)
        ],
    })


def fits(papers: list[Paper]) -> bool:
    return (
        len(papers) <= MAX_PAPERS
        and 1 + sum(len(paper.files) + 1 for paper in papers) <= MAX_FILES
        and sum(paper.size for paper in papers) + len(manifest(papers)) <= MAX_BYTES
    )


def pack(papers_dir: Path, output: Path) -> list[Path]:
    papers_dir = papers_dir.expanduser().resolve()
    output = output.expanduser().resolve()
    if not papers_dir.is_dir():
        raise ValueError(f"论文目录不存在：{papers_dir}")
    if output == papers_dir or papers_dir in output.parents:
        raise ValueError("输出目录必须放在 papers 目录之外")
    if output.exists():
        raise ValueError(f"输出目录已存在，请选择一个新目录：{output}")
    papers, seen, skipped = [], set(), []
    for directory in sorted(papers_dir.iterdir()):
        if directory.name.startswith(".") or not directory.is_dir():
            continue
        if directory.is_symlink():
            raise ValueError(f"论文目录不能是符号链接：{directory}")
        missing = [name for name in ("meta.json", "paper.md") if not (directory / name).is_file()]
        if missing:
            skipped.append({"directory": directory.name, "reason": "缺少 " + "、".join(missing)})
            print(f"跳过 {directory.name}：缺少 {'、'.join(missing)}", file=sys.stderr)
            continue
        try:
            paper = read_paper(directory)
        except (ValueError, OSError) as error:
            raise ValueError(f"{directory.name}：{error}") from error
        if paper.paper_id in seen:
            raise ValueError(f"重复的论文 ID：{paper.paper_id}（{directory.name}）")
        seen.add(paper.paper_id)
        if not fits([paper]):
            raise ValueError(f"单篇论文超过打包预算：{directory.name}，请检查附件大小和数量")
        papers.append(paper)
    if not papers:
        raise ValueError("没有找到同时包含 meta.json 和 paper.md 的论文目录")

    batches, batch = [], []
    for paper in papers:
        if batch and not fits([*batch, paper]):
            batches.append(batch)
            batch = []
        batch.append(paper)
    batches.append(batch)

    output.parent.mkdir(parents=True, exist_ok=True)
    # Publish the output directory only after every ZIP is complete.
    with tempfile.TemporaryDirectory(prefix="scholaraio-pack-", dir=output.parent) as name:
        staging = Path(name) / "bundles"
        staging.mkdir()
        report = {"papers": len(papers), "skipped": skipped, "bundles": []}
        for index, batch in enumerate(batches, 1):
            archive_path = staging / f"batch-{index:03d}.zip"
            with ZipFile(archive_path, "w", compression=ZIP_DEFLATED) as archive:
                archive.writestr("manifest.json", manifest(batch))
                for number, paper in enumerate(batch, 1):
                    prefix = f"papers/{number:04d}"
                    archive.writestr(f"{prefix}/meta.json", paper.metadata)
                    for file, relative in paper.files:
                        archive.write(file, f"{prefix}/{relative}")
            with ZipFile(archive_path) as archive:
                if (archive_path.stat().st_size > MAX_BYTES
                        or sum(info.file_size for info in archive.infolist()) > MAX_BYTES):
                    raise ValueError(f"文件在打包时发生变化或 ZIP 超过预算：{archive_path.name}")
            report["bundles"].append({
                "file": archive_path.name,
                "papers": [
                    {"directory": paper.directory.name, "id": paper.paper_id}
                    for paper in batch
                ],
            })
        (staging / "report.json").write_bytes(json_bytes(report))
        if output.exists():
            raise ValueError(f"输出目录已存在：{output}")
        staging.rename(output)
    result = [output / entry["file"] for entry in report["bundles"]]
    print(f"已打包 {len(papers)} 篇论文，共 {len(result)} 个 ZIP，跳过 {len(skipped)} 个目录。")
    for path in result:
        print(path)
    print("到“文献管理 · MCP → 上传已解析文献包”逐个上传这些 ZIP。")
    print("不包含旧 index.db 或语义向量；目标库会自动更新关键词和正文分块索引。")
    return result


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("papers", type=Path, help="已有的 papers 文件夹路径")
    parser.add_argument("--output", type=Path, required=True, help="用于保存 ZIP 的新目录")
    args = parser.parse_args()
    try:
        pack(args.papers, args.output)
    except (ValueError, OSError) as error:
        parser.exit(1, f"打包失败：{error}\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
