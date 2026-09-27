"""Optional capabilities of the Python runtime this service runs in, installed on request.

Setup installs only the core: the semantic capability pulls a multi-gigabyte
tensor stack most libraries never use. When the browser asks for it, this
service syncs its own environment with ``uv``, records the capability in the
runtime manifest so a later ``pnpm hub setup`` keeps it, and asks to be
restarted: Python caches its imports, so the new packages only exist in a new
process. The launcher that started the service restarts it (see
``interfaces/api/server.py``).

Which extras each capability means lives in ``runtime-capabilities.json``
beside ``pyproject.toml``, shared with ``pnpm hub setup``.
"""

from __future__ import annotations

import json
import logging
import os
import subprocess
import sys
import threading
from collections.abc import Callable
from datetime import datetime, timezone
from pathlib import Path

from scholaraio.hub.errors import Conflict, InvalidRequest
from scholaraio.hub.runtime import LibraryRuntime
from scholaraio.hub.storage import atomic_json

_log = logging.getLogger("scholaraio.hub.runtime_install")

PROJECT_DIR = Path(__file__).resolve().parents[2]
CAPABILITIES_FILE = PROJECT_DIR / "runtime-capabilities.json"
MANIFEST_VERSION = 1
# Output lines kept for the browser: enough to see progress, not the whole build.
LOG_LINES = 40
UV_MISSING_HINT = "uv is required. Install it from https://docs.astral.sh/uv/getting-started/installation/"


def now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def read_capabilities(path: Path = CAPABILITIES_FILE) -> tuple[list[str], dict[str, list[str]]]:
    """The core extras, and the extras of each optional capability."""
    data = json.loads(path.read_text(encoding="utf-8"))
    return list(data["core"]), {name: list(extras) for name, extras in data["capabilities"].items()}


class RuntimeInstaller:
    def __init__(
        self,
        runtime: LibraryRuntime,
        request_restart: Callable[[], None],
        *,
        environment: Path | None = None,
        uv: str | None = None,
        capabilities_file: Path = CAPABILITIES_FILE,
    ):
        self.environment = environment or Path(sys.prefix)
        # Beside the environment, where `pnpm hub setup` reads it.
        self.manifest_file = self.environment.parent / "manifest.json"
        self.status_file = runtime.cfg.state_root / "runtime-install.json"
        self.cache_dir = runtime.root / "data" / "cache" / "uv"
        self.uv = uv or os.environ.get("SCHOLARAIO_HUB_UV") or "uv"
        self.core, self.extras = read_capabilities(capabilities_file)
        self.request_restart = request_restart
        self._lock = threading.Lock()
        self._child: subprocess.Popen | None = None
        self._status = self._load_status()

    def read(self) -> dict:
        with self._lock:
            return {**self._status, "log": list(self._status.get("log", []))}

    def install(self, capability: str) -> dict:
        """Start the install; the caller polls :meth:`read` for how it goes."""
        if capability not in self.extras:
            raise InvalidRequest(f"Unknown runtime capability: {capability}")
        with self._lock:
            if self._status["state"] == "installing":
                raise Conflict("Dependencies are being installed")
            self._set({"state": "installing", "log": [], "startedAt": now()})
        threading.Thread(target=self._run, args=(capability,), name="runtime-install", daemon=True).start()
        return self.read()

    def close(self) -> None:
        child = self._child
        if child and child.poll() is None:
            child.terminate()

    # ---- the install itself -------------------------------------------------

    def _run(self, capability: str) -> None:
        try:
            capabilities = sorted({*self._installed(), capability})
            command = [
                self.uv,
                "sync",
                "--project",
                str(PROJECT_DIR),
                "--locked",
                *[
                    flag
                    for extra in [*self.core, *(e for c in capabilities for e in self.extras[c])]
                    for flag in ("--extra", extra)
                ],
                "--no-default-groups",
            ]
            env = {**os.environ, "UV_PROJECT_ENVIRONMENT": str(self.environment), "UV_CACHE_DIR": str(self.cache_dir)}
            try:
                self._child = subprocess.Popen(
                    command,
                    env=env,
                    stdout=subprocess.PIPE,
                    stderr=subprocess.STDOUT,
                    stdin=subprocess.DEVNULL,
                    text=True,
                    errors="replace",
                )
            except OSError as error:
                self._fail(f"{UV_MISSING_HINT}（{error}）")
                return
            assert self._child.stdout is not None
            for line in self._child.stdout:
                self._log_line(line)
            code = self._child.wait()
            self._child = None
            if code != 0:
                self._fail(f"Installation failed (exit {code}). See the output below.")
                return
            self._write_manifest(capabilities)
        except Exception as error:
            # A background thread has nobody else to tell: the status is the report.
            _log.error("Runtime install failed", exc_info=error)
            self._fail(str(error))
            return
        with self._lock:
            self._set(
                {
                    **self._status,
                    "state": "ready",
                    "finishedAt": now(),
                    "log": [*self._status["log"], "Restarting the library service..."][-LOG_LINES:],
                }
            )
        _log.info("Installed %s; restarting so the new packages load", capability)
        self.request_restart()

    def _installed(self) -> list[str]:
        """What the runtime has now: its manifest, or for an older one what is importable."""
        if self.manifest_file.exists():
            manifest = json.loads(self.manifest_file.read_text(encoding="utf-8"))
            if manifest.get("version") != MANIFEST_VERSION or not isinstance(manifest.get("capabilities"), list):
                raise RuntimeError(f"Invalid runtime manifest: {self.manifest_file}")
            return list(manifest["capabilities"])
        from scholaraio.services import vectors

        return ["semantic"] if vectors.runtime_available() else []

    def _write_manifest(self, capabilities: list[str]) -> None:
        atomic_json(self.manifest_file, {"version": MANIFEST_VERSION, "capabilities": capabilities})

    def _log_line(self, line: str) -> None:
        text = line.strip()
        if not text:
            return
        with self._lock:
            self._status["log"] = [*self._status["log"], text][-LOG_LINES:]

    def _fail(self, error: str) -> None:
        with self._lock:
            self._set({**self._status, "state": "failed", "error": error, "finishedAt": now()})

    # ---- the status, kept across the restart that ends an install ----------

    def _set(self, status: dict) -> None:
        self._status = status
        atomic_json(self.status_file, status)

    def _load_status(self) -> dict:
        try:
            status = json.loads(self.status_file.read_text(encoding="utf-8"))
        except FileNotFoundError:
            return {"state": "idle", "log": []}
        except (OSError, ValueError) as error:
            _log.warning("Unreadable install status %s: %s", self.status_file, error)
            return {"state": "idle", "log": []}
        if status.get("state") == "installing":
            # The process that ran it is gone; so is the install.
            status = {
                **status,
                "state": "failed",
                "error": "Installation was interrupted. Try again.",
                "finishedAt": now(),
            }
        return status


__all__ = ["RuntimeInstaller", "read_capabilities"]
