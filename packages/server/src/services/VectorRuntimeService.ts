import { type ChildProcess, spawn } from "node:child_process";
import type { VectorRuntimeStatus } from "@scholaraio-hub/shared";
import { type RuntimeSync, UV_MISSING_HINT, planRuntimeSync } from "../runtime/install.js";
import type { LibraryService } from "./LibraryService.js";

/** Output lines kept for the browser: enough to see progress, not the whole build. */
const LOG_LINES = 40;

/**
 * Installs the optional embedding packages the library needs for semantic work.
 *
 * Setup leaves them out until asked for — they pull a multi-gigabyte tensor
 * stack that most installs never use. They are fetched here, when the user asks
 * for semantic search, recorded in the runtime manifest so later setups keep
 * them, and the Python child is restarted so the new modules are importable.
 */
export class VectorRuntimeService {
  private status: VectorRuntimeStatus = { state: "idle", log: [] };
  private child?: ChildProcess;

  constructor(
    private readonly dataDir: string,
    private readonly library: LibraryService,
  ) {}

  get installing(): boolean {
    return this.status.state === "installing";
  }

  read(): VectorRuntimeStatus {
    return { ...this.status, log: [...this.status.log] };
  }

  /** Start the install; the caller polls `read()` for how it goes. */
  install(): VectorRuntimeStatus {
    if (this.installing) throw new Error("向量依赖正在安装中");
    this.status = { state: "installing", log: [], startedAt: new Date().toISOString() };
    let sync: RuntimeSync;
    try {
      sync = planRuntimeSync(this.dataDir, ["semantic"]);
    } catch (error) {
      this.finish(error instanceof Error ? error.message : String(error));
      return this.read();
    }
    const child = spawn(sync.command, sync.args, {
      env: sync.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    this.child = child;
    const record = (data: Buffer) => {
      for (const line of data.toString().split("\n")) {
        const text = line.trim();
        if (!text) continue;
        this.status.log = [...this.status.log, text].slice(-LOG_LINES);
      }
    };
    child.stdout?.on("data", record);
    child.stderr?.on("data", record);
    child.once("error", (error) => {
      this.child = undefined;
      this.finish(`${UV_MISSING_HINT}（${error.message}）`);
    });
    child.once("exit", (code, signal) => {
      this.child = undefined;
      if (code !== 0) {
        this.finish(`安装失败 (${signal ?? code})，详见下方输出。`);
        return;
      }
      try {
        sync.commit();
      } catch (error) {
        this.finish(`依赖已安装，但无法记录运行环境清单：${(error as Error).message}`);
        return;
      }
      void this.restartLibrary();
    });
    return this.read();
  }

  /** Python caches its imports, so the new packages only exist after a restart. */
  private async restartLibrary(): Promise<void> {
    this.status.log = [...this.status.log, "重启文献服务…"].slice(-LOG_LINES);
    try {
      await this.library.close();
      await this.library.start();
    } catch (error) {
      this.finish(error instanceof Error ? error.message : "文献服务重启失败");
      return;
    }
    this.status = {
      ...this.status,
      state: "ready",
      error: undefined,
      finishedAt: new Date().toISOString(),
    };
  }

  private finish(error: string): void {
    this.status = {
      ...this.status,
      state: "failed",
      error,
      finishedAt: new Date().toISOString(),
    };
  }

  async close(): Promise<void> {
    const child = this.child;
    this.child = undefined;
    if (!child || child.exitCode !== null || child.signalCode !== null) return;
    child.kill("SIGTERM");
  }
}
