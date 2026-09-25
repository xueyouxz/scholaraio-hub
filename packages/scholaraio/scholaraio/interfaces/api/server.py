"""Run the library service as a child of the Node server.

The service binds a free loopback port, announces it on stdout as one JSON
line, and — with ``--watch-stdin`` — exits when the parent's pipe closes.
"""
from __future__ import annotations

import argparse
import json
import logging
import os
import socket
import sys
import threading
from pathlib import Path

import uvicorn

from scholaraio.interfaces.api.app import create_app
from scholaraio.interfaces.api.security import TOKEN_VARIABLE

# Once the owner is gone, how long cleanup may take before the process is killed.
SHUTDOWN_GRACE_SECONDS = 5

# One record per line on stderr, led by its level: the Node server logs each
# line at that level (see LibraryService.ts). Stdout carries only the port.
LOG_FORMAT = "%(levelname)s\t%(name)s: %(message)s"


def configure_logging() -> None:
    logging.basicConfig(level=logging.INFO, stream=sys.stderr, format=LOG_FORMAT)
    for name in ("httpx", "urllib3", "httpcore", "sentence_transformers"):
        logging.getLogger(name).setLevel(logging.WARNING)


def watch_parent(server: uvicorn.Server, stopped: threading.Event) -> None:
    """An EOF on the Node-owned pipe also covers SIGKILL and watch restarts."""
    try:
        while os.read(sys.stdin.fileno(), 1024):
            pass
    except OSError as exc:
        logging.getLogger("scholaraio.api").warning("Parent pipe failed: %s", exc)
    if stopped.is_set():
        return
    server.should_exit = True
    # An import worker or a request may block graceful shutdown. Once the owner
    # is gone, bound cleanup time; persisted imports are recovered on next start.
    if not stopped.wait(SHUTDOWN_GRACE_SECONDS):
        os._exit(1)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--data-dir", type=Path, required=True)
    parser.add_argument("--watch-stdin", action="store_true")
    args = parser.parse_args()
    configure_logging()
    token = os.environ.get(TOKEN_VARIABLE, "")
    if not token:
        raise SystemExit("Missing internal service token")
    sock = socket.socket()
    sock.bind(("127.0.0.1", 0))
    print(json.dumps({"port": sock.getsockname()[1]}), flush=True)
    server = uvicorn.Server(uvicorn.Config(create_app(args.data_dir, token), log_level="warning"))
    stopped = threading.Event()
    if args.watch_stdin:
        # Process-owned daemon: a normal server exit ends a pending pipe read;
        # stopped cancels the forced-exit deadline if graceful cleanup completes.
        threading.Thread(target=watch_parent, args=(server, stopped), daemon=True).start()
    try:
        server.run(sockets=[sock])
    finally:
        stopped.set()
        sock.close()


__all__ = ["main"]
