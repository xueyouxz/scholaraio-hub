import { type ChildProcess, spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { createInterface } from "node:readline";
import { pythonRuntime, scholarSourceDir } from "../runtime/python.js";

/** Owns the Python child. All callers share this instance and its shutdown path. */
export class LibraryService {
  private child?: ChildProcess;
  private baseUrl?: string;
  private readonly token = randomBytes(32).toString("hex");
  private failure?: string;

  constructor(readonly dataDir: string) {}

  get available(): boolean {
    return this.baseUrl !== undefined;
  }

  async start(): Promise<void> {
    const runtime = pythonRuntime(this.dataDir);
    if (!existsSync(runtime.executable))
      throw new Error("文献运行环境尚未安装，请先运行 pnpm hub setup（正式环境加 --production）。");
    // The open stdin pipe owns the Python lifetime, including watch restarts and
    // uncatchable Node exits. Python shuts down when this pipe reaches EOF.
    const child = spawn(
      runtime.executable,
      ["-m", "scholaraio.interfaces.api", "--data-dir", this.dataDir, "--watch-stdin"],
      {
        cwd: scholarSourceDir,
        env: {
          ...runtime.env(),
          SCHOLARAIO_HUB_INTERNAL_TOKEN: this.token,
          PYTHONUNBUFFERED: "1",
        },
        stdio: ["pipe", "pipe", "pipe"],
      },
    );
    this.child = child;
    child.stderr?.on("data", (data: Buffer) =>
      console.error(`[Library] ${data.toString().trim()}`),
    );
    child.on("exit", (code, signal) => {
      this.baseUrl = undefined;
      this.failure = `文献服务已退出 (${signal ?? code})`;
    });
    try {
      const port = await new Promise<number>((resolve, reject) => {
        if (!child.stdout) return reject(new Error("Missing Python stdout"));
        const lines = createInterface({ input: child.stdout });
        const timer = setTimeout(() => finish(new Error("文献服务启动超时")), 30_000);
        const onError = (error: Error) => finish(error);
        const onExit = () => finish(new Error(this.failure ?? "文献服务启动失败"));
        const finish = (error?: Error, value?: number) => {
          clearTimeout(timer);
          lines.close();
          child.off("error", onError);
          child.off("exit", onExit);
          if (error) reject(error);
          else if (value) resolve(value);
        };
        child.once("error", onError);
        child.once("exit", onExit);
        lines.on("line", (line) => {
          try {
            const data: unknown = JSON.parse(line);
            if (data && typeof data === "object" && "port" in data && typeof data.port === "number")
              finish(undefined, data.port);
          } catch {
            console.log(`[Library] ${line}`);
          }
        });
      });
      this.baseUrl = `http://127.0.0.1:${port}`;
      const deadline = Date.now() + 30_000;
      while (true) {
        try {
          const response = await this.request("/health");
          if (response.ok) break;
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

  request(resource: string, init: RequestInit = {}): Promise<Response> {
    if (!this.baseUrl) throw new Error(this.failure ?? "文献服务未启动");
    const headers = new Headers(init.headers);
    headers.set("x-hub-token", this.token);
    return fetch(`${this.baseUrl}${resource}`, {
      ...init,
      headers,
      signal: init.signal ?? AbortSignal.timeout(30_000),
    });
  }

  async json<T>(resource: string, init?: RequestInit): Promise<T> {
    const response = await this.request(resource, init);
    if (!response.ok)
      throw new Error(`文献请求失败 (${response.status}): ${await response.text()}`);
    return response.json() as Promise<T>;
  }

  async close(): Promise<void> {
    const child = this.child;
    this.child = undefined;
    this.baseUrl = undefined;
    if (!child || child.exitCode !== null || child.signalCode !== null) return;
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => child.kill("SIGKILL"), 5000);
      child.once("exit", () => {
        clearTimeout(timer);
        resolve();
      });
      child.stdin?.end();
      child.kill("SIGTERM");
    });
  }
}
