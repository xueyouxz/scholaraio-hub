"""Application configuration file owned by Hub and shared with the CLI.

Both the Hub service and any ``scholaraio`` CLI run started by an agent must
resolve the same library. The CLI resolves relative paths against the directory
holding ``config.yaml``, so the file has to exist inside the application data
directory before ``SCHOLARAIO_CONFIG`` can point at it.
"""
from __future__ import annotations

from pathlib import Path

from scholaraio.core.config import Config, load_config
from scholaraio.hub.storage import atomic_write_text

TEMPLATE = """\
# ScholarAIO Hub 应用配置。
#
# 由 Hub 自动创建，之后不再覆盖。所有相对路径以本文件所在目录为准，
# 因此 Hub 与 `scholaraio` CLI 共享同一份文献数据。
#
# 密钥请写入同目录的 config.local.yaml（同名字段优先），或使用环境变量。
#
# 常用可选配置：
#
# ingest:
#   # PDF 解析：优先 MinerU；配置 token 后走云端，未配置时自动降级为本地解析器。
#   # 云端解析会把 PDF 上传到 MinerU 服务。
#   mineru_api_key: ""        # 或环境变量 MINERU_TOKEN
#   pdf_preferred_parser: mineru
#   # 元数据提取：robust 需要 LLM key，没有 key 时导入按 regex 运行。
#   extractor: robust
#
# llm:
#   api_key: ""               # 或环境变量 SCHOLARAIO_LLM_API_KEY
#
# embed:
#   model: Qwen/Qwen3-Embedding-0.6B
#   source: modelscope        # 首次语义检索时自动下载到 cache_dir
"""


def config_path(root: Path) -> Path:
    return root / "config.yaml"


def local_config_path(root: Path) -> Path:
    """The overlay the settings page writes, merged on top of ``config.yaml``."""
    return root / "config.local.yaml"


def ensure_config(root: Path) -> Config:
    """Return the application config, creating the file when it is missing."""
    path = config_path(root)
    if not path.exists():
        atomic_write_text(path, TEMPLATE, replace=False)
    config = load_config(path)
    # load_config falls back to the caller's cwd when the file disappeared
    # between the check and the read; an unrelated root is never acceptable.
    config._root = root
    return config


__all__ = ["TEMPLATE", "config_path", "ensure_config", "local_config_path"]
