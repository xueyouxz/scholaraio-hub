import { type ChildProcess, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { type Interface, createInterface } from "node:readline";
import { CSRF_HEADER, resolveLibraryPort, resolvePort } from "@scholaraio-hub/shared";
import type { Level } from "pino";
import { loggerFor } from "../logging/logger.js";
import { pythonRuntime, scholaraioSourceDir } from "../runtime/python.js";

const log = () => loggerFor("library");

/** How long the Python service may take to answer once started. */
const START_TIMEOUT_MS = 30_000;
/** How long a request to the service may take unless the caller gives its own signal. */
const REQUEST_TIMEOUT_MS = 30_000;
/** How long the service may take to exit before it is killed. */
const STOP_GRACE_MS = 5000;
/**
 * A service that exits on its own is started again after this delay, at most
 * `RESTART_LIMIT` times within `RESTART_WINDOW_MS`; one that keeps dying stays
 * down so its logs can be read.
 */
const RESTART_DELAY_MS = 1000;
const RESTART_LIMIT = 3;
const RESTART_WINDOW_MS = 5 * 60 * 1000;

/** Python's level names, as the service's log lines name them (see `interfaces/api/server.py`). */
const PYTHON_LEVELS: Record<string, Level> = {
  DEBUG: "debug",
  INFO: "info",
  WARNING: "warn",
  ERROR: "error",
  CRITICAL: "fatal",
};

/** The library answered a request with an error status; `detail` is its message. */
export class LibraryRequestError extends Error {
  constructor(
    readonly status: number,
    readonly detail: string,
  ) {
    super(`文献请求失败 (${status}): ${detail}`);
  }
}

/** Where the Python service listens, and whose page may call it. */
export interface LibraryEndpoint {
  host: string;
  port: number;
  /** The Hub's port: its page calls the service from the browser. */
  hubPort: number;
  /** `ALLOWED_HOSTS`: extra host names besides loopback, or "*". */
  allowedHosts?: string;
}

/** Owns the Python child. All callers share this instance and its shutdown path. */
export class LibraryService {
  private child?: ChildProcess;
  private baseUrl?: string;
  /** Set once the running child answered its health check. */
  private ready = false;
  private failure?: string;
  /** Set while the owner stops the service, so its exit is not taken for a crash. */
  private stopping = false;
  private restartTimer?: ReturnType<typeof setTimeout>;
  private readonly restarts: number[] = [];

  constructor(
    readonly dataDir: string,
    private readonly endpoint: LibraryEndpoint = {
      host: "127.0.0.1",
      port: resolveLibraryPort(process.env),
      hubPort: resolvePort(process.env),
    },
  ) {}

  get available(): boolean {
    return this.ready;
  }

  async start(): Promise<void> {
    const runtime = pythonRuntime(this.dataDir);
    if (!existsSync(runtime.executable))
      throw new Error("文献运行环境尚未安装，请先运行 pnpm hub setup（正式环境加 --production）。");
    this.stopping = false;
    // The open stdin pipe owns the Python lifetime, including watch restarts and
    // uncatchable Node exits. Python shuts down when this pipe reaches EOF.
    const { host, port, hubPort, allowedHosts } = this.endpoint;
    const child = spawn(
      runtime.executable,
      [
        "-m",
        "scholaraio.interfaces.api",
        "--data-dir",
        this.dataDir,
        "--host",
        host,
        "--port",
        String(port),
        "--hub-port",
        String(hubPort),
        "--allowed-hosts",
        allowedHosts ?? "",
        "--watch-stdin",
      ],
      {
        cwd: scholaraioSourceDir,
        env: { ...runtime.env(), PYTHONUNBUFFERED: "1" },
        stdio: ["pipe", "pipe", "pipe"],
      },
    );
    this.child = child;
    // A failure belongs to the child that had it; a restart starts clean.
    this.failure = undefined;
    const stderr = relayStderr(child);
    const stdout = child.stdout && createInterface({ input: child.stdout });
    stdout?.on("line", (line) => log().info({ stream: "stdout" }, line));
    child.on("exit", (code, signal) => {
      stderr?.close();
      stdout?.close();
      if (this.child !== child) return;
      this.baseUrl = undefined;
      this.ready = false;
      this.failure = `文献服务已退出 (${signal ?? code})`;
      if (!this.stopping) this.scheduleRestart(this.failure);
    });
    try {
      this.baseUrl = `http://${connectHost(host)}:${port}`;
      const deadline = Date.now() + START_TIMEOUT_MS;
      while (true) {
        try {
          const response = await this.request("/health");
          if (response.ok) {
            this.ready = true;
            break;
          }
        } catch (error) {
          if (this.failure || Date.now() >= deadline) throw error;
        }
        if (Date.now() >= deadline) throw new Error("文献服务就绪超时");
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    } catch (error) {
      await this.close();
      throw error;
    }
  }

  /** Start a service that exited on its own again, unless it keeps doing so. */
  private scheduleRestart(reason: string): void {
    const now = Date.now();
    while (this.restarts.length && now - (this.restarts[0] ?? now) > RESTART_WINDOW_MS)
      this.restarts.shift();
    if (this.restarts.length >= RESTART_LIMIT) {
      log().error(
        { reason, restarts: this.restarts.length },
        "Library service keeps exiting; left stopped",
      );
      return;
    }
    this.restarts.push(now);
    log().warn({ reason }, "Library service exited; restarting");
    this.restartTimer = setTimeout(() => {
      this.restartTimer = undefined;
      this.start().catch((error) => log().error({ err: error }, "Library service restart failed"));
    }, RESTART_DELAY_MS);
    this.restartTimer.unref();
  }

  async request(resource: string, init: RequestInit = {}): Promise<Response> {
    if (!this.baseUrl) throw new Error(this.failure ?? "文献服务未启动");
    const headers = new Headers(init.headers);
    headers.set(CSRF_HEADER.name, CSRF_HEADER.value);
    return fetch(`${this.baseUrl}${resource}`, {
      ...init,
      headers,
      signal: init.signal ?? AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  }

  async json<T>(resource: string, init?: RequestInit): Promise<T> {
    const response = await this.request(resource, init);
    if (!response.ok) throw new LibraryRequestError(response.status, await errorText(response));
    return response.json() as Promise<T>;
  }

  async close(): Promise<void> {
    this.stopping = true;
    clearTimeout(this.restartTimer);
    this.restartTimer = undefined;
    const child = this.child;
    this.child = undefined;
    this.baseUrl = undefined;
    this.ready = false;
    if (!child || child.exitCode !== null || child.signalCode !== null) return;
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => child.kill("SIGKILL"), STOP_GRACE_MS);
      child.once("exit", () => {
        clearTimeout(timer);
        resolve();
      });
      child.stdin?.end();
      child.kill("SIGTERM");
    });
  }
}

/** The service's `{"error": ...}` message, or its whole body when it has none. */
async function errorText(response: Response): Promise<string> {
  const text = await response.text();
  try {
    const body = JSON.parse(text) as { error?: unknown };
    if (typeof body.error === "string") return body.error;
  } catch {
    // Not JSON: the text itself is the message.
  }
  return text;
}

/** Where to reach a service listening on `host`: a wildcard address is reached on loopback. */
function connectHost(host: string): string {
  if (host === "0.0.0.0" || host === "::" || host === "localhost") return "127.0.0.1";
  return host.includes(":") ? `[${host}]` : host;
}

/**
 * Log the child's stderr at the level each Python log record names; lines
 * that continue a record (a traceback) keep its level.
 */
function relayStderr(child: ChildProcess): Interface | undefined {
  if (!child.stderr) return undefined;
  const lines = createInterface({ input: child.stderr });
  let level: Level = "warn";
  lines.on("line", (line) => {
    // "HH:MM:SS LEVEL name: message"
    const named = PYTHON_LEVELS[line.split(" ", 3)[1] ?? ""];
    if (named) level = named;
    log()[level]({ stream: "stderr" }, line);
  });
  return lines;
}
