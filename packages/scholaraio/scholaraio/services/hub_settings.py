"""The library settings the browser owns, written to ``config.local.yaml``.

``config.yaml`` stays the documented file a user edits by hand; anything the
settings page changes is written to the local overlay beside it, which the
config loader merges on top. Keys are stored but never read back out: the
browser only learns whether one is configured.
"""
from __future__ import annotations

import os
import uuid
from pathlib import Path

import yaml

from scholaraio.core.config import VALID_PDF_PREFERRED_PARSERS

VALID_LLM_BACKENDS = {"openai-compat", "anthropic", "google"}
VALID_EXTRACTORS = {"regex", "auto", "robust", "llm"}
VALID_EMBED_PROVIDERS = {"local", "openai-compat", "none"}
VALID_EMBED_SOURCES = {"modelscope", "huggingface"}
VALID_EMBED_DEVICES = {"auto", "cpu", "cuda"}

# Browser field -> (config section, key, allowed values or None for free text).
FIELDS: dict[str, tuple[str, str, set[str] | None]] = {
    "extractor": ("ingest", "extractor", VALID_EXTRACTORS),
    "pdfParser": ("ingest", "pdf_preferred_parser", VALID_PDF_PREFERRED_PARSERS),
    "llmBackend": ("llm", "backend", VALID_LLM_BACKENDS),
    "llmModel": ("llm", "model", None),
    "llmBaseUrl": ("llm", "base_url", None),
    "embedProvider": ("embed", "provider", VALID_EMBED_PROVIDERS),
    "embedModel": ("embed", "model", None),
    "embedSource": ("embed", "source", VALID_EMBED_SOURCES),
    "embedDevice": ("embed", "device", VALID_EMBED_DEVICES),
}
# Write-only: stored in the overlay, reported only as configured or not.
SECRETS: dict[str, tuple[str, str]] = {
    "mineruApiKey": ("ingest", "mineru_api_key"),
    "llmApiKey": ("llm", "api_key"),
    "embedApiKey": ("embed", "api_key"),
}


class HubSettings:
    def __init__(self, library):
        self.library = library

    @property
    def path(self) -> Path:
        return self.library.root / "config.local.yaml"

    def read(self) -> dict:
        with self.library.lock:
            cfg = self.library.cfg
            settings = {
                field: str(getattr(getattr(cfg, section), key) or "")
                for field, (section, key, _) in FIELDS.items()
            }
            return {
                **settings,
                # An environment variable counts as configured just as a stored key does.
                "mineruConfigured": bool(cfg.resolved_mineru_api_key()),
                "llmConfigured": bool(cfg.resolved_api_key()),
                "embedApiConfigured": bool((cfg.embed.api_key or "").strip()),
                "configPath": str(self.library.root / "config.yaml"),
            }

    def update(self, fields: dict) -> dict:
        """Apply a settings change and reload the configuration it describes."""
        changes: dict[str, dict[str, str]] = {}
        for field, value in fields.items():
            if field in SECRETS:
                section, key = SECRETS[field]
                changes.setdefault(section, {})[key] = str(value).strip()
                continue
            if field not in FIELDS:
                raise ValueError(f"无法修改该配置项：{field}")
            section, key, allowed = FIELDS[field]
            text = str(value).strip()
            if allowed is not None and text not in allowed:
                raise ValueError(f"{field} 只能是：{'、'.join(sorted(allowed))}")
            changes.setdefault(section, {})[key] = text
        if not changes:
            raise ValueError("没有要修改的配置项")
        with self.library.lock:
            self.write(changes)
            self.library.reload_config()
            return self.read()

    def write(self, changes: dict[str, dict[str, str]]) -> None:
        """Merge the change into the overlay, keeping every other stored value."""
        current = {}
        if self.path.exists():
            loaded = yaml.safe_load(self.path.read_text(encoding="utf-8"))
            if loaded is not None and not isinstance(loaded, dict):
                raise ValueError("config.local.yaml 格式无效，请手动检查")
            current = loaded or {}
        for section, values in changes.items():
            existing = current.get(section)
            merged = dict(existing) if isinstance(existing, dict) else {}
            # An emptied field goes back to whatever config.yaml or the
            # environment says, rather than pinning an empty override.
            for key, value in values.items():
                if value:
                    merged[key] = value
                else:
                    merged.pop(key, None)
            if merged:
                current[section] = merged
            else:
                current.pop(section, None)
        temporary = self.path.with_name(f".config.local.yaml.{uuid.uuid4().hex}.tmp")
        try:
            with temporary.open("x", encoding="utf-8") as output:
                # The file holds API keys: readable by this user only.
                temporary.chmod(0o600)
                output.write("# 由 ScholarAIO Hub 设置页写入，覆盖 config.yaml 中的同名字段。\n")
                yaml.safe_dump(current, output, allow_unicode=True, sort_keys=True)
                output.flush()
                os.fsync(output.fileno())
            temporary.replace(self.path)
        finally:
            temporary.unlink(missing_ok=True)


__all__ = ["FIELDS", "SECRETS", "HubSettings"]
