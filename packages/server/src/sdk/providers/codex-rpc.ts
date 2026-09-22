/**
 * Transport for `codex app-server`: process lifecycle, JSON-RPC framing, and
 * the notification queue. Knows nothing about what the messages mean.
 */

import type { ChildProcess } from "node:child_process";
import { spawn } from "node:child_process";
import { getLogger } from "../../logging/logger.js";

const log = getLogger().child({ component: "codex-rpc" });

/** How long a terminating app-server gets before SIGKILL. */
const APP_SERVER_SHUTDOWN_GRACE_MS = 1500;

export type JsonRpcId = string | number;

export interface JsonRpcError {
  message?: string;
  code?: number;
  data?: unknown;
}

export interface JsonRpcResponse {
  id?: JsonRpcId;
  result?: unknown;
  error?: JsonRpcError;
}

export interface JsonRpcNotification {
  method: string;
  params?: unknown;
}

export interface JsonRpcServerRequest extends JsonRpcNotification {
  id: JsonRpcId;
}

export async function terminateChildProcess(
  child: ChildProcess | null | undefined,
  graceMs = APP_SERVER_SHUTDOWN_GRACE_MS,
): Promise<void> {
  if (!child?.pid || child.killed || child.exitCode !== null) {
    return;
  }

  const exited = new Promise<void>((resolve) => {
    child.once("exit", () => resolve());
  });

  const killTarget = process.platform !== "win32" && child.pid > 0 ? -child.pid : child.pid;

  try {
    process.kill(killTarget, "SIGTERM");
  } catch {
    return;
  }

  const timer = setTimeout(() => {
    if (child.exitCode !== null || child.killed) {
      return;
    }
    try {
      process.kill(killTarget, "SIGKILL");
    } catch {
      // Ignore escalation failures during shutdown.
    }
  }, graceMs);

  try {
    await exited;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Configuration for Codex provider.
 */

export class AsyncQueue<T> {
  private items: T[] = [];
  private waiters: Array<{
    resolve: (value: T) => void;
    reject: (error: Error) => void;
    signal?: AbortSignal;
    onAbort?: () => void;
  }> = [];
  private closedError: Error | null = null;

  push(item: T): void {
    if (this.closedError) return;
    const waiter = this.waiters.shift();
    if (waiter) {
      if (waiter.signal && waiter.onAbort) {
        waiter.signal.removeEventListener("abort", waiter.onAbort);
      }
      waiter.resolve(item);
      return;
    }
    this.items.push(item);
  }

  close(error?: Error): void {
    if (this.closedError) return;
    this.closedError = error ?? new Error("Queue closed");
    for (const waiter of this.waiters) {
      if (waiter.signal && waiter.onAbort) {
        waiter.signal.removeEventListener("abort", waiter.onAbort);
      }
      waiter.reject(this.closedError);
    }
    this.waiters = [];
    this.items = [];
  }

  async shift(signal?: AbortSignal): Promise<T> {
    if (this.items.length > 0) {
      const item = this.items.shift();
      if (item === undefined) {
        throw new Error("Queue underflow");
      }
      return item;
    }

    if (this.closedError) {
      throw this.closedError;
    }

    return await new Promise<T>((resolve, reject) => {
      const waiter: {
        resolve: (value: T) => void;
        reject: (error: Error) => void;
        signal?: AbortSignal;
        onAbort?: () => void;
      } = { resolve, reject, signal };

      if (signal) {
        const onAbort = () => {
          this.waiters = this.waiters.filter((w) => w !== waiter);
          reject(new Error("Operation aborted"));
        };
        waiter.onAbort = onAbort;
        signal.addEventListener("abort", onAbort, { once: true });
      }

      this.waiters.push(waiter);
    });
  }
}

export type AppServerRequestHandler = (request: JsonRpcServerRequest) => Promise<unknown>;

export class CodexAppServerClient {
  private process: ChildProcess | null = null;
  private stdoutBuffer = "";

  /** OS PID of the spawned app-server child process */
  get pid(): number | undefined {
    return this.process?.pid;
  }

  isAlive(): boolean {
    const child = this.process;
    return Boolean(child?.pid && child.exitCode === null && !child.killed);
  }
  private nextRequestId = 1;
  private readonly pendingRequests = new Map<
    JsonRpcId,
    {
      resolve: (result: unknown) => void;
      reject: (error: Error) => void;
    }
  >();
  private readonly notifications = new AsyncQueue<JsonRpcNotification>();
  private onServerRequest: AppServerRequestHandler | null = null;
  private closed = false;

  constructor(
    private readonly command: string,
    private readonly cwd: string,
    private readonly env: NodeJS.ProcessEnv,
  ) {}

  setServerRequestHandler(handler: AppServerRequestHandler): void {
    this.onServerRequest = handler;
  }

  async connect(): Promise<void> {
    if (this.process) {
      throw new Error("Codex app-server already connected");
    }

    const child = spawn(this.command, ["app-server", "--listen", "stdio://"], {
      cwd: this.cwd,
      detached: process.platform !== "win32",
      stdio: ["pipe", "pipe", "pipe"],
      env: this.env,
      shell: process.platform === "win32",
    });

    this.process = child;

    child.stdout?.on("data", (chunk: Buffer) => {
      this.stdoutBuffer += chunk.toString("utf-8");
      const lines = this.stdoutBuffer.split("\n");
      this.stdoutBuffer = lines.pop() ?? "";
      for (const raw of lines) {
        const line = raw.trim();
        if (!line) continue;
        this.handleJsonRpcLine(line);
      }
    });

    child.stderr?.on("data", (chunk: Buffer) => {
      const stderr = chunk.toString("utf-8").trim();
      if (stderr) {
        log.debug({ stderr }, "codex app-server stderr");
      }
    });

    child.on("error", (error) => {
      this.handleProcessClose(error);
    });

    child.on("exit", (code, signal) => {
      this.handleProcessClose(
        new Error(`Codex app-server exited (code=${code ?? "null"}, signal=${signal ?? "null"})`),
      );
    });

    await new Promise<void>((resolve, reject) => {
      const onSpawn = () => {
        child.off("error", onError);
        resolve();
      };
      const onError = (error: Error) => {
        child.off("spawn", onSpawn);
        reject(error);
      };
      child.once("spawn", onSpawn);
      child.once("error", onError);
    });
  }

  private handleJsonRpcLine(line: string): void {
    let message: Record<string, unknown>;
    try {
      message = JSON.parse(line) as Record<string, unknown>;
    } catch {
      log.debug({ line }, "Ignoring non-JSON app-server line");
      return;
    }

    const method = typeof message.method === "string" ? (message.method as string) : null;
    const hasId = typeof message.id === "string" || typeof message.id === "number";

    // Server request/notification
    if (method) {
      if (hasId) {
        const request: JsonRpcServerRequest = {
          id: message.id as JsonRpcId,
          method,
          params: message.params,
        };
        this.handleServerRequest(request);
        return;
      }

      this.notifications.push({ method, params: message.params });
      return;
    }

    // Response to our request
    if (hasId) {
      const id = message.id as JsonRpcId;
      const pending = this.pendingRequests.get(id);
      if (!pending) {
        return;
      }
      this.pendingRequests.delete(id);

      if (message.error && typeof message.error === "object") {
        const error = message.error as JsonRpcError;
        pending.reject(new Error(error.message ?? "JSON-RPC request failed"));
        return;
      }

      pending.resolve(message.result);
    }
  }

  private handleServerRequest(request: JsonRpcServerRequest): void {
    const respond = (payload: Record<string, unknown>) => {
      this.sendRaw({
        jsonrpc: "2.0",
        id: request.id,
        ...payload,
      });
    };

    if (!this.onServerRequest) {
      respond({
        error: {
          code: -32601,
          message: `Unhandled server request: ${request.method}`,
        },
      });
      return;
    }

    void this.onServerRequest(request)
      .then((result) => {
        respond({ result: result ?? {} });
      })
      .catch((error) => {
        respond({
          error: {
            code: -32000,
            message: error instanceof Error ? error.message : "Server request failed",
          },
        });
      });
  }

  async request<T>(method: string, params?: unknown): Promise<T> {
    if (this.closed) {
      throw new Error("Codex app-server client is closed");
    }

    const id = this.nextRequestId++;

    const resultPromise = new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new Error(`Codex ${method} request timed out`));
      }, 30000);
      this.pendingRequests.set(id, {
        resolve: (result) => {
          clearTimeout(timer);
          resolve(result as T);
        },
        reject: (error) => {
          clearTimeout(timer);
          reject(error);
        },
      });
    });

    this.sendRaw({
      jsonrpc: "2.0",
      id,
      method,
      params,
    });

    return await resultPromise;
  }

  notify(method: string, params?: unknown): void {
    this.sendRaw({
      jsonrpc: "2.0",
      method,
      ...(params === undefined ? {} : { params }),
    });
  }

  async nextNotification(signal?: AbortSignal): Promise<JsonRpcNotification> {
    return await this.notifications.shift(signal);
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;

    const closeError = new Error("Codex app-server client closed");
    for (const pending of this.pendingRequests.values()) {
      pending.reject(closeError);
    }
    this.pendingRequests.clear();
    this.notifications.close(closeError);

    const child = this.process;
    this.process = null;
    void terminateChildProcess(child);
  }

  private handleProcessClose(error: Error): void {
    if (this.closed) return;
    this.closed = true;

    for (const pending of this.pendingRequests.values()) {
      pending.reject(error);
    }
    this.pendingRequests.clear();

    // Emit a terminal error notification so consumers can surface it.
    this.notifications.push({
      method: "error",
      params: {
        error: { message: error.message },
        willRetry: false,
      },
    });
    this.notifications.close(error);
    this.process = null;
  }

  private sendRaw(payload: Record<string, unknown>): void {
    if (!this.process?.stdin || this.closed) {
      return;
    }

    try {
      this.process.stdin.write(`${JSON.stringify(payload)}\n`);
    } catch (error) {
      this.handleProcessClose(
        error instanceof Error ? error : new Error("Failed to write to codex app-server stdin"),
      );
    }
  }
}
