"""Installing an optional capability into the service's own runtime, from the browser."""
from __future__ import annotations

import json
import stat
import time
from pathlib import Path

import pytest

from scholaraio.hub.errors import Conflict, InvalidRequest
from scholaraio.hub.runtime import LibraryRuntime
from scholaraio.hub.runtime_install import CAPABILITIES_FILE, RuntimeInstaller, read_capabilities
from tests.hub_client import hub_client


def fake_uv(tmp_path: Path, *, code: int = 0, pause: float = 0) -> Path:
    """A uv that records its arguments, prints two lines and exits with ``code``."""
    script = tmp_path / "uv"
    script.write_text(
        f"#!/bin/sh\necho \"$@\" > {tmp_path / 'uv-args'}\necho Resolved\nsleep {pause}\necho Installed\nexit {code}\n"
    )
    script.chmod(script.stat().st_mode | stat.S_IEXEC)
    return script


def settled(installer: RuntimeInstaller) -> dict:
    for _ in range(200):
        status = installer.read()
        if status["state"] != "installing":
            return status
        time.sleep(0.02)
    pytest.fail("install never finished")


@pytest.fixture
def runtime(tmp_path):
    return LibraryRuntime(tmp_path / "data")


def installer_for(runtime, tmp_path, restarts, **uv):
    environment = tmp_path / "data" / "runtime" / "python"
    return RuntimeInstaller(runtime, lambda: restarts.append(True), environment=environment,
                            uv=str(fake_uv(tmp_path, **uv)))


def test_the_capability_list_is_shared_with_setup():
    core, extras = read_capabilities(CAPABILITIES_FILE)
    assert "hub" in core
    assert extras["semantic"]


def test_an_install_records_the_capability_and_asks_for_a_restart(runtime, tmp_path):
    restarts: list[bool] = []
    installer = installer_for(runtime, tmp_path, restarts)
    manifest = tmp_path / "data" / "runtime" / "manifest.json"
    manifest.parent.mkdir(parents=True)
    manifest.write_text(json.dumps({"version": 1, "capabilities": []}))
    assert installer.install("semantic")["state"] == "installing"
    status = settled(installer)
    assert status["state"] == "ready"
    assert status["log"][:2] == ["Resolved", "Installed"]
    assert restarts == [True]
    assert json.loads(manifest.read_text()) == {"version": 1, "capabilities": ["semantic"]}
    args = (tmp_path / "uv-args").read_text().split()
    assert args[:2] == ["sync", "--project"]
    assert "topics" in args and "hub" in args
    # The restarted service still knows how the install went.
    assert RuntimeInstaller(runtime, lambda: None, environment=installer.environment).read()["state"] == "ready"


def test_a_failed_install_leaves_the_manifest_and_the_process_alone(runtime, tmp_path):
    restarts: list[bool] = []
    installer = installer_for(runtime, tmp_path, restarts, code=3)
    installer.install("semantic")
    status = settled(installer)
    assert status["state"] == "failed"
    assert "exit 3" in status["error"]
    assert restarts == []
    assert not (tmp_path / "data" / "runtime" / "manifest.json").exists()


def test_one_install_at_a_time(runtime, tmp_path):
    installer = installer_for(runtime, tmp_path, [], pause=0.5)
    installer.install("semantic")
    with pytest.raises(Conflict):
        installer.install("semantic")
    settled(installer)
    with pytest.raises(InvalidRequest):
        installer.install("gpu")


def test_an_install_the_process_did_not_finish_is_reported_failed(runtime, tmp_path):
    status_file = runtime.cfg.state_root / "runtime-install.json"
    status_file.write_text(json.dumps({"state": "installing", "log": ["Resolved"], "startedAt": "then"}))
    status = RuntimeInstaller(runtime, lambda: None, environment=tmp_path / "env").read()
    assert status["state"] == "failed"
    assert status["log"] == ["Resolved"]


def test_the_routes_answer_with_the_status(tmp_path):
    with hub_client(tmp_path / "app") as client:
        assert client.get("/runtime").json() == {"state": "idle", "log": []}
        assert client.post("/runtime/gpu").status_code == 422
