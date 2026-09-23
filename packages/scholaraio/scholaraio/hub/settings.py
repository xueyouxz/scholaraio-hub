"""The library settings the browser owns, written to ``config.local.yaml``.

``config.yaml`` stays the documented file a user edits by hand; anything the
settings page changes is written to the local overlay beside it, which the
config loader merges on top. Keys are stored but never read back out: the
browser only learns whether one is configured.
"""
from __future__ import annotations

from pathlib import Path

import yaml

from scholaraio.core.config import VALID_PDF_PREFERRED_PARSERS
from scholaraio.hub.config import config_path, local_config_path
from scholaraio.hub.errors import InvalidRequest
from scholaraio.hub.runtime import LibraryRuntime
from scholaraio.hub.storage import atomic_write_text

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


OVERLAY_HEADER = "# 由 ScholarAIO Hub 设置页写入，覆盖 config.yaml 中的同名字段。\n"


class SettingsService:
    def __init__(self, runtime: LibraryRuntime):
        self.runtime = runtime

    @property
    def path(self) -> Path:
        return local_config_path(self.runtime.root)

    def read(self) -> dict:
        with self.runtime.lock:
            cfg = self.runtime.cfg
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
                "configPath": str(config_path(self.runtime.root)),
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
                raise InvalidRequest(f"无法修改该配置项：{field}")
            section, key, allowed = FIELDS[field]
            text = str(value).strip()
            if allowed is not None and text not in allowed:
                raise InvalidRequest(f"{field} 只能是：{'、'.join(sorted(allowed))}")
            changes.setdefault(section, {})[key] = text
        if not changes:
            raise InvalidRequest("没有要修改的配置项")
        self.normalize(changes)
        with self.runtime.lock:
            self.write(changes)
            self.runtime.reload_config()
            return self.read()

    def normalize(self, changes: dict[str, dict[str, str]]) -> None:
        """Hold the two settings the browser no longer offers a choice for.

        Parsing runs on MinerU and embedding runs on the downloaded local
        model. Someone who edits ``config.yaml`` by hand can still say
        otherwise; saving from the settings page says this instead.
        """
        if "embed" in changes:
            changes["embed"]["provider"] = "local"
        if "ingest" in changes:
            changes["ingest"]["pdf_preferred_parser"] = "mineru"

    def write(self, changes: dict[str, dict[str, str]]) -> None:
        """Merge the change into the overlay, keeping every other stored value."""
        current = {}
        if self.path.exists():
            loaded = yaml.safe_load(self.path.read_text(encoding="utf-8"))
            if loaded is not None and not isinstance(loaded, dict):
                # Exists but unreadable: a storage fault the user must fix by hand.
                raise RuntimeError(f"config.local.yaml 格式无效，请手动检查：{self.path}")
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
        # The file holds API keys: atomic_write_text keeps it readable by this user only.
        atomic_write_text(self.path, OVERLAY_HEADER + yaml.safe_dump(current, allow_unicode=True, sort_keys=True))


__all__ = ["FIELDS", "SECRETS", "SettingsService"]
