"""Exercise real service processes so pipe ownership and exit behavior are verified."""
import json
import os
import select
import subprocess
import sys
import time
from contextlib import contextmanager
from pathlib import Path
from urllib.error import URLError
from urllib.request import Request, urlopen

import pytest

PROJECT = Path(__file__).resolve().parents[1]
TOKEN = "lifecycle-test-token"


def read_json_line(stream):
    assert select.select([stream], [], [], 15)[0], "Service startup timed out"
    line = stream.readline()
    assert line, "Service exited before announcing its port"
    return json.loads(line)


def healthy(port):
    try:
        with urlopen(Request(f"http://127.0.0.1:{port}/health", headers={"x-hub-token": TOKEN}), timeout=0.5) as response:
            return response.status == 200
    except (URLError, TimeoutError, ConnectionError):
        return False


def wait_for(predicate, message):
    deadline = time.monotonic() + 15
    while time.monotonic() < deadline:
        if predicate():
            return
        time.sleep(0.05)
    pytest.fail(message)


@contextmanager
def service(tmp_path, *, watch=True, blocked_cleanup=False):
    command = [sys.executable, "-m", "scholaraio.interfaces.api"]
    if blocked_cleanup:
        command = [sys.executable, "-c", """
import time
from scholaraio.interfaces.api.__main__ import HubLibrary, main
HubLibrary.close = lambda self: time.sleep(60)
main()
"""]
    command += ["--data-dir", str(tmp_path / "data")]
    if watch:
        command.append("--watch-stdin")
    with (tmp_path / "service.log").open("w+") as log:
        child = subprocess.Popen(command, cwd=PROJECT, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                 stderr=log, env={**os.environ, "SCHOLARAIO_HUB_INTERNAL_TOKEN": TOKEN})
        try:
            port = read_json_line(child.stdout)["port"]
            wait_for(lambda: healthy(port), "Service never became healthy")
            yield child, port
        finally:
            if child.poll() is None:
                child.kill()
            child.wait(timeout=5)
            child.stdin.close()
            child.stdout.close()


def test_pipe_eof_shuts_down_healthy_service(tmp_path):
    with service(tmp_path) as (child, port):
        # Data is not a shutdown signal; only EOF transfers ownership.
        child.stdin.write(b"still owned\n")
        child.stdin.flush()
        assert healthy(port)
        child.stdin.close()
        assert child.wait(timeout=10) == 0
        assert not healthy(port)


def test_standalone_service_does_not_watch_stdin(tmp_path):
    with service(tmp_path, watch=False) as (child, port):
        child.stdin.close()
        # Allow several server ticks: stdin EOF must not stop standalone mode.
        time.sleep(0.4)
        assert child.poll() is None
        assert healthy(port)


def test_pipe_eof_bounds_blocked_cleanup(tmp_path):
    with service(tmp_path, blocked_cleanup=True) as (child, port):
        child.stdin.close()
        assert child.wait(timeout=10) == 1
        assert not healthy(port)


@pytest.mark.parametrize("parent_exit", ["normal", "kill"])
def test_service_exits_when_parent_disappears(tmp_path, parent_exit):
    # Keep the parent alive on its own stdin. Killing it must close the *other*
    # pipe it owns, even though no graceful signal reaches the service.
    launcher = """
import json, subprocess, sys
child = subprocess.Popen([sys.executable, '-m', 'scholaraio.interfaces.api',
                          '--data-dir', sys.argv[1], '--watch-stdin'],
                         stdin=subprocess.PIPE, stdout=subprocess.PIPE)
info = json.loads(child.stdout.readline())
print(json.dumps({**info, 'pid': child.pid}), flush=True)
sys.stdin.read()
"""
    with (tmp_path / "parent.log").open("w+") as log:
        parent = subprocess.Popen([sys.executable, "-c", launcher, str(tmp_path / "data")], cwd=PROJECT,
                                  stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=log,
                                  env={**os.environ, "SCHOLARAIO_HUB_INTERNAL_TOKEN": TOKEN})
        info = None
        try:
            info = read_json_line(parent.stdout)
            wait_for(lambda: healthy(info["port"]), "Service never became healthy")
            if parent_exit == "normal":
                parent.stdin.close()
            else:
                parent.kill()
            parent.wait(timeout=5)
            wait_for(lambda: not healthy(info["port"]), "Orphan service still accepts requests")
        finally:
            if parent.poll() is None:
                parent.kill()
            parent.wait(timeout=5)
            parent.stdin.close()
            parent.stdout.close()
            if info and healthy(info["port"]):
                os.kill(info["pid"], 9)
