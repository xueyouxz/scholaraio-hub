/**
 * Transport for `codex app-server`: process lifecycle, JSON-RPC framing, and
 * the notification queue. Knows nothing about what the messages mean.
 */

import { loggerFor } from "../../logging/logger.js";
import { AsyncQueue } from "../AsyncQueue.js";
import { CliProcess } from "../cli-process.js";

const log = () => loggerFor("codex-app-server");

/** How long an exited app-server's remaining output may take to arrive. */
const EXIT_FLUSH_MS = 500;

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

export type AppServerRequestHandler = (request: JsonRpcServerRequest) => Promise<unknown>;

export class CodexAppServerClient {
  private process: CliProcess | null = null;
  private stdoutBuffer = "";

  isAlive(): boolean {
    return this.process?.isAlive() ?? false;
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
  /** Settles once a closed app-server has exited. */
  private exited: Promise<void> = Promise.resolve();
  private readonly closeListeners = new Set<(error: Error) => void>();

  constructor(
    private readonly command: string,
    private readonly cwd: string,
    private readonly env: NodeJS.ProcessEnv,
  ) {}

  setServerRequestHandler(handler: AppServerRequestHandler): void {
    this.onServerRequest = handler;
  }

  /**
   * Hear the app-server go away on its own (exit, spawn or pipe failure); a
   * `close()` of ours is not reported. Returns the unsubscribe.
   */
  onClose(listener: (error: Error) => void): () => void {
    this.closeListeners.add(listener);
    return () => this.closeListeners.delete(listener);
  }

  /** Start the app-server and complete the JSON-RPC initialize handshake. */
  async open(): Promise<void> {
    await this.connect();
    await this.request<{ userAgent: string }>("initialize", {
      clientInfo: { name: "scholaraio-hub", version: "dev" },
      capabilities: null,
    });
    this.notify("initialized");
  }

  async connect(): Promise<void> {
    if (this.process) {
      throw new Error("Codex app-server already connected");
    }

    const cli = CliProcess.spawn(this.command, ["app-server", "--listen", "stdio://"], {
      cwd: this.cwd,
      env: this.env,
      group: true,
      onStderr: (text) => {
        const stderr = text.trim();
        if (stderr) log().debug({ stderr }, "codex app-server stderr");
      },
    });
    const child = cli.child;
    this.process = cli;

    child.stdout.on("data", (chunk: Buffer) => {
      this.stdoutBuffer += chunk.toString("utf-8");
      const lines = this.stdoutBuffer.split("\n");
      this.stdoutBuffer = lines.pop() ?? "";
      for (const raw of lines) {
        const line = raw.trim();
        if (!line) continue;
        this.handleJsonRpcLine(line);
      }
    });

    child.on("error", (error) => {
      this.handleProcessClose(error);
    });

    child.on("exit", (code, signal) => {
      // Output written just before the exit may still be in the pipe: read it
      // first, so its last notifications (often the reason) are not lost.
      const report = () => {
        clearTimeout(timer);
        const tail = cli.stderrTail;
        this.handleProcessClose(
          new Error(
            `Codex app-server exited (code=${code ?? "null"}, signal=${signal ?? "null"})${tail ? `: ${tail}` : ""}`,
          ),
        );
      };
      const timer = setTimeout(report, EXIT_FLUSH_MS);
      timer.unref();
      if (child.stdout.readableEnded) report();
      else child.stdout.once("end", report);
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
      log().debug({ line }, "Ignoring non-JSON app-server line");
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

  /** Stop the app-server; settles once it has exited. */
  close(): Promise<void> {
    if (this.closed) return this.exited;
    this.closed = true;

    const closeError = new Error("Codex app-server client closed");
    for (const pending of this.pendingRequests.values()) {
      pending.reject(closeError);
    }
    this.pendingRequests.clear();
    this.notifications.close(closeError);
    this.closeListeners.clear();

    const cli = this.process;
    this.process = null;
    this.exited = cli?.terminate() ?? Promise.resolve();
    return this.exited;
  }

  private handleProcessClose(error: Error): void {
    if (this.closed) return;
    this.closed = true;

    for (const pending of this.pendingRequests.values()) {
      pending.reject(error);
    }
    this.pendingRequests.clear();
    // Readers get the notifications already received, then this error, which
    // ends the session.
    this.notifications.end(error);
    this.process = null;
    for (const listener of this.closeListeners) listener(error);
    this.closeListeners.clear();
  }

  private sendRaw(payload: Record<string, unknown>): void {
    const stdin = this.process?.child.stdin;
    if (!stdin || this.closed) {
      return;
    }

    try {
      stdin.write(`${JSON.stringify(payload)}\n`);
    } catch (error) {
      this.handleProcessClose(
        error instanceof Error ? error : new Error("Failed to write to codex app-server stdin"),
      );
    }
  }
}
