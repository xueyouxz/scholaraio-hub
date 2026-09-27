"""The library settings the browser owns, written to ``config.local.yaml``.

``config.yaml`` stays the documented file a user edits by hand; anything the
settings page changes is written to the local overlay beside it, which the
config loader merges on top. Keys are stored but never read back out: the
browser only learns whether one is configured, and how long it is, so the
field can show a mask of the right length instead of looking empty.
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
# Write-only: stored in the overlay, reported only as configured or not (and length).
SECRETS: dict[str, tuple[str, str]] = {
    "mineruApiKey": ("ingest", "mineru_api_key"),
    "llmApiKey": ("llm", "api_key"),
    "embedApiKey": ("embed", "api_key"),
}


OVERLAY_HEADER = "# 由 ScholarAIO Hub 设置页写入，覆盖 config.yaml 中的同名字段。\n"

MINERU_CLOUD_API = "https://mineru.net/api/v4"
# A task id no account owns: asking for it proves the token without costing a parse.
MINERU_PROBE_TASK = "00000000-0000-0000-0000-000000000000"
CHECK_TIMEOUT_SECONDS = 20


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
                field: str(getattr(getattr(cfg, section), key) or "") for field, (section, key, _) in FIELDS.items()
            }
            mineru_key = cfg.resolved_mineru_api_key().strip()
            llm_key = cfg.resolved_api_key().strip()
            return {
                **settings,
                # An environment variable counts as configured just as a stored key does.
                "mineruConfigured": bool(mineru_key),
                "mineruKeyLength": len(mineru_key),
                "llmConfigured": bool(llm_key),
                "llmKeyLength": len(llm_key),
                "embedApiConfigured": bool((cfg.embed.api_key or "").strip()),
                "configPath": str(config_path(self.runtime.root)),
                # Where the library keeps papers and where workspaces live.
                "papersDir": str(cfg.papers_dir.resolve()),
                "workspaceDir": str(cfg.workspace_dir.resolve()),
            }

    def check(self, target: str) -> dict:
        """Try one configured service and say, in the user's terms, whether it works.

        A check never raises for the service's own failure: an unreachable
        endpoint or a refused key is the answer, not an error.
        """
        checks = {"mineru": self.check_mineru, "llm": self.check_llm, "embed": self.check_embed}
        if target not in checks:
            raise InvalidRequest(f"Unknown check target: {target}")
        level, message = checks[target]()
        return {"target": target, "ok": level != "error", "level": level, "message": message}

    def check_mineru(self) -> tuple[str, str]:
        import shutil

        import requests

        cfg = self.runtime.cfg
        token = cfg.resolved_mineru_api_key()
        if not token:
            return "error", "MinerU token is missing. Imports will use local parsing"
        try:
            response = requests.get(
                f"{MINERU_CLOUD_API}/extract/task/{MINERU_PROBE_TASK}",
                headers={"Authorization": f"Bearer {token}"},
                timeout=CHECK_TIMEOUT_SECONDS,
            )
        except requests.RequestException as error:
            return "error", f"Unable to connect to MinerU: {error}"
        if response.status_code in (401, 403) or "token" in response.text.casefold()[:400]:
            return "error", "MinerU rejected the token. Verify that it is complete and has not expired"
        if shutil.which("mineru-open-api") is None:
            return "warning", "Token is valid, but mineru-open-api is not installed. Cloud parsing is unavailable"
        return "ok", "Token is valid. Imports will use MinerU cloud parsing"

    def check_llm(self) -> tuple[str, str]:
        from scholaraio.services.metrics import call_llm

        cfg = self.runtime.cfg
        if not cfg.resolved_api_key():
            return "error", "API key is missing. Metadata uses rule-based extraction and deep parsing is unavailable"
        try:
            result = call_llm(
                "Reply with OK.",
                cfg,
                json_mode=False,
                max_tokens=8,
                timeout=CHECK_TIMEOUT_SECONDS,
                purpose="settings.check",
            )
        except Exception as error:  # any backend failure is what the user needs to read
            return "error", f"Request failed: {error}"
        return "ok", f"{result.model or cfg.llm.model} is responding"

    def check_embed(self) -> tuple[str, str]:
        from scholaraio.services import vectors

        cfg = self.runtime.cfg
        if vectors.embedding_provider(cfg) == "none":
            return "error", "Vector embeddings are disabled in the configuration"
        if not vectors.runtime_available():
            return "warning", "Semantic search runtime is not installed. Install it from the library analytics page"
        if not vectors.model_available(cfg):
            return (
                "warning",
                f"{cfg.embed.model} is not downloaded. It will be downloaded when semantic search is prepared",
            )
        return "ok", f"{cfg.embed.model} is ready"

    def update(self, fields: dict) -> dict:
        """Apply a settings change and reload the configuration it describes."""
        changes: dict[str, dict[str, str]] = {}
        for field, value in fields.items():
            if field in SECRETS:
                section, key = SECRETS[field]
                changes.setdefault(section, {})[key] = str(value).strip()
                continue
            if field not in FIELDS:
                raise InvalidRequest(f"Cannot modify setting: {field}")
            section, key, allowed = FIELDS[field]
            text = str(value).strip()
            if allowed is not None and text not in allowed:
                raise InvalidRequest(f"{field} must be one of: {', '.join(sorted(allowed))}")
            changes.setdefault(section, {})[key] = text
        if not changes:
            raise InvalidRequest("No settings to update")
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
                raise RuntimeError(f"Invalid config.local.yaml. Check the file: {self.path}")
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
