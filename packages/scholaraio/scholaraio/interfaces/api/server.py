"""Run the library service on the port its profile gives it.

The Hub's launcher (``pnpm dev`` / ``pnpm start``) starts this process beside
the Hub server and passes every setting on the command line: the data
directory, where to listen, the Hub's port (whose page may call this service
from the browser) and the extra host names the user allowed. With
``--watch-stdin`` the service exits when the launcher's pipe closes, so it never
outlives the launcher, even one that was killed.

The service exits with :data:`RESTART_EXIT_CODE` when it needs a new process
(after installing packages into its own runtime); the launcher restarts it.
"""
from __future__ import annotations

import argparse
import logging
import logging.handlers
import os
import socket
import sys
import threading
from pathlib import Path

import uvicorn

from scholaraio.interfaces.api.app import create_app
from scholaraio.interfaces.api.security import AccessPolicy

# "Restart me": EX_TEMPFAIL, which the launcher answers by starting the service again.
RESTART_EXIT_CODE = 75
# Once the owner is gone, how long cleanup may take before the process is killed.
SHUTDOWN_GRACE_SECONDS = 5
LOG_FORMAT = "%(asctime)s %(levelname)s %(name)s: %(message)s"
# How much one log file may hold, and how many rotated files are kept.
LOG_FILE_BYTES = 10 * 1024 * 1024
LOG_FILE_COUNT = 7

_log = logging.getLogger("scholaraio.api")


def configure_logging(log_file: Path | None) -> None:
    """Log to stderr, and to ``log_file`` when one is given."""
    handlers: list[logging.Handler] = [logging.StreamHandler(sys.stderr)]
    if log_file:
        log_file.parent.mkdir(parents=True, exist_ok=True)
        # Logs hold queries and paths: readable by this user only.
        os.close(os.open(log_file, os.O_CREAT | os.O_APPEND | os.O_WRONLY, 0o600))
        handlers.append(
            logging.handlers.RotatingFileHandler(
                log_file, maxBytes=LOG_FILE_BYTES, backupCount=LOG_FILE_COUNT, encoding="utf-8"
            )
        )
    logging.basicConfig(level=logging.INFO, format=LOG_FORMAT, datefmt="%H:%M:%S", handlers=handlers, force=True)
    for name in ("httpx", "urllib3", "httpcore", "sentence_transformers"):
        logging.getLogger(name).setLevel(logging.WARNING)


def watch_parent(server: uvicorn.Server, stopped: threading.Event) -> None:
    """An EOF on the launcher-owned pipe also covers SIGKILL of the launcher."""
    try:
        while os.read(sys.stdin.fileno(), 1024):
            pass
    except OSError as exc:
        _log.warning("Parent pipe failed: %s", exc)
    if stopped.is_set():
        return
    server.should_exit = True
    # An import worker or a request may block graceful shutdown. Once the owner
    # is gone, bound cleanup time; persisted imports are recovered on next start.
    if not stopped.wait(SHUTDOWN_GRACE_SECONDS):
        os._exit(1)


def listen(host: str, port: int) -> socket.socket:
    """Bind before starting, so a taken port is one clear message, not a traceback."""
    family = socket.getaddrinfo(host, port, type=socket.SOCK_STREAM)[0][0]
    try:
        return socket.create_server((host, port), family=family)
    except OSError as error:
        raise SystemExit(f"文献服务无法监听 {host}:{port}：{error.strerror}（端口被占用时可设 LIBRARY_PORT 换一个）") from error


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(prog="python -m scholaraio.interfaces.api")
    parser.add_argument("--data-dir", type=Path, required=True)
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, required=True)
    parser.add_argument("--hub-port", type=int, help="the Hub's port; its page may call this service")
    parser.add_argument("--allowed-hosts", default="", help='extra host names besides loopback, or "*"')
    parser.add_argument("--log-file", type=Path)
    parser.add_argument("--watch-stdin", action="store_true")
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> None:
    args = parse_args(argv)
    configure_logging(args.log_file)
    policy = AccessPolicy.parse(args.allowed_hosts, args.hub_port)
    sock = listen(args.host, args.port)
    restart = threading.Event()

    def request_restart() -> None:
        restart.set()
        server.should_exit = True

    config = uvicorn.Config(
        create_app(args.data_dir, policy, request_restart),
        # Our handlers, not uvicorn's: its records reach the same outputs.
        log_config=None,
        log_level="warning",
        access_log=False,
    )
    server = uvicorn.Server(config)
    stopped = threading.Event()
    if args.watch_stdin:
        # Process-owned daemon: a normal server exit ends a pending pipe read;
        # stopped cancels the forced-exit deadline if graceful cleanup completes.
        threading.Thread(target=watch_parent, args=(server, stopped), daemon=True).start()
    _log.info("Library service on http://%s:%d", args.host, args.port)
    try:
        server.run(sockets=[sock])
    finally:
        stopped.set()
        sock.close()
    if restart.is_set():
        _log.info("Exiting for a restart")
        sys.exit(RESTART_EXIT_CODE)


__all__ = ["RESTART_EXIT_CODE", "main"]
