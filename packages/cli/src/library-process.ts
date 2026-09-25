/**
 * The library service: the Python process the launcher starts beside the
 * server. It listens on the profile's library port and serves the browser, the
 * server and the agents' `scholaraio` CLI; nothing else starts or stops it.
 *
 * Its stdin is a pipe this process holds (`--watch-stdin`): when the launcher
 * goes, even by SIGKILL, the pipe closes and the service exits with it.
 */
import { type ChildProcess, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { pythonRuntime, scholaraioSourceDir } from "./python.js";

/** The service's "restart me", after it installed into its own runtime (`server.py`). */
export const RESTART_EXIT_CODE = 75;
/** A first start reindexes the library before it answers; give it time. */
const START_TIMEOUT_MS = 120_000;
/** How long the service may take to exit once its pipe closes; it bounds itself to 5s. */
const STOP_GRACE_MS = 8000;
/**
 * A service that exits on its own is started again after this delay, at most
 * `RESTART_LIMIT` times within `RESTART_WINDOW_MS`; one that keeps dying stays
 * down so its log can be read.
 */
const RESTART_DELAY_MS = 1000;
const RESTART_LIMIT = 3;
const RESTART_WINDOW_MS = 5 * 60 * 1000;

export interface LibraryOptions {
  dataDir: string;
  host: string;
  port: number;
  /** The Hub's port: its page calls the service from the browser. */
  hubPort: number;
  /** `ALLOWED_HOSTS`: extra host names besides loopback, or "*". */
  allowedHosts?: string;
  /** Where the service also writes its log; the console always gets it. */
  logFile?: string;
  /** The interpreter; the data directory's runtime unless a test names another. */
  executable?: string;
  /** The environment it starts with, before the runtime is activated. */
  env?: NodeJS.ProcessEnv;
}

/** Where to reach a service listening on `host`: a wildcard address is reached on loopback. */
function connectHost(host: string): string {
  if (host === "0.0.0.0" || host === "::" || host === "localhost") return "127.0.0.1";
  return host.includes(":") ? `[${host}]` : host;
}

export class LibraryProcess {
  private child?: ChildProcess;
  /** Set while the launcher stops the service, so its exit is not taken for a crash. */
  private stopping = false;
  private restartTimer?: ReturnType<typeof setTimeout>;
  private readonly restarts: number[] = [];

  constructor(
    private readonly options: LibraryOptions,
    private readonly log: (message: string) => void = (message) => console.log(`[hub] ${message}`),
  ) {}

  /** Where the service answers. */
  get url(): string {
    return `http://${connectHost(this.options.host)}:${this.options.port}`;
  }

  /** Start the service and wait until it answers; a service that exits first fails the start. */
  async start(): Promise<void> {
    const runtime = pythonRuntime(this.options.dataDir);
    const executable = this.options.executable ?? runtime.executable;
    if (!existsSync(executable))
      throw new Error(`未找到文献运行环境：${executable}，请先运行 pnpm hub setup。`);
    this.stopping = false;
    const { dataDir, host, port, hubPort, allowedHosts, logFile } = this.options;
    const args = [
      "-m",
      "scholaraio.interfaces.api",
      "--data-dir",
      dataDir,
      "--host",
      host,
      "--port",
      String(port),
      "--hub-port",
      String(hubPort),
      "--allowed-hosts",
      allowedHosts ?? "",
      "--watch-stdin",
      ...(logFile ? ["--log-file", logFile] : []),
    ];
    const child = spawn(executable, args, {
      cwd: scholaraioSourceDir,
      env: { ...runtime.env(this.options.env ?? process.env), PYTHONUNBUFFERED: "1" },
      stdio: ["pipe", "inherit", "inherit"],
    });
    this.child = child;
    const exited = new Promise<string>((resolve) => {
      child.once("error", (error) => resolve(error.message));
      child.once("exit", (code, signal) => resolve(String(signal ?? code)));
    });
    child.once("exit", (code, signal) => {
      if (this.child !== child || this.stopping) return;
      this.child = undefined;
      this.onUnexpectedExit(code, signal);
    });
    await this.waitUntilHealthy(exited);
  }

  private async waitUntilHealthy(exited: Promise<string>): Promise<void> {
    let exit: string | undefined;
    void exited.then((reason) => {
      exit = reason;
    });
    const deadline = Date.now() + START_TIMEOUT_MS;
    while (exit === undefined) {
      try {
        const response = await fetch(`${this.url}/health`, { signal: AbortSignal.timeout(2000) });
        if (response.ok) return;
      } catch {
        // Not listening yet: keep waiting until it answers, exits or runs out of time.
      }
      if (Date.now() >= deadline) {
        await this.stop();
        throw new Error("文献服务启动超时");
      }
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    throw new Error(`文献服务启动失败 (${exit})，详见上方输出`);
  }

  private onUnexpectedExit(code: number | null, signal: NodeJS.Signals | null): void {
    if (code === RESTART_EXIT_CODE) {
      this.log("文献服务请求重启");
      this.restart();
      return;
    }
    const now = Date.now();
    while (this.restarts.length && now - (this.restarts[0] ?? now) > RESTART_WINDOW_MS)
      this.restarts.shift();
    if (this.restarts.length >= RESTART_LIMIT) {
      this.log(`文献服务反复退出 (${signal ?? code})，已停止重启；请查看上方日志后重启 Hub。`);
      return;
    }
    this.restarts.push(now);
    this.log(`文献服务已退出 (${signal ?? code})，正在重启`);
    this.restartTimer = setTimeout(() => this.restart(), RESTART_DELAY_MS);
  }

  private restart(): void {
    this.restartTimer = undefined;
    this.start().catch((error: unknown) =>
      this.log(`文献服务重启失败：${error instanceof Error ? error.message : String(error)}`),
    );
  }

  /**
   * From now on an exit is expected, not a crash to restart from. Ctrl+C
   * reaches the service with the rest of the terminal's group, before `stop`.
   */
  expectExit(): void {
    this.stopping = true;
    clearTimeout(this.restartTimer);
    this.restartTimer = undefined;
  }

  /** Close the service's pipe and wait for it to go; kill it if it does not. */
  async stop(): Promise<void> {
    this.expectExit();
    const child = this.child;
    this.child = undefined;
    if (!child || child.exitCode !== null || child.signalCode !== null) return;
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => child.kill("SIGKILL"), STOP_GRACE_MS);
      child.once("exit", () => {
        clearTimeout(timer);
        resolve();
      });
      child.stdin?.end();
    });
  }
}
