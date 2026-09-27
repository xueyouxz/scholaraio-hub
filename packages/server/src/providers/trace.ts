import * as fs from "node:fs";
import * as path from "node:path";
import { loggerFor } from "../logging/logger.js";

/**
 * Opt-in trace of what providers send before any translation — Claude SDK
 * messages and Codex app-server notifications — one JSON line each in
 * `{logDir}/sdk-raw.jsonl` (LOG_SDK_MESSAGES). For checking a provider's
 * translation into AgentEvent against its real input. Off by default.
 */

let writeStream: fs.WriteStream | null = null;

/** Call once at server startup. */
export function initProviderTrace(options: { enabled: boolean; logDir: string }): void {
  if (!options.enabled) return;
  fs.mkdirSync(options.logDir, { recursive: true });
  // The trace holds whole prompts, files and tool output: readable by this user only.
  const stream = fs.createWriteStream(path.join(options.logDir, "sdk-raw.jsonl"), {
    flags: "a",
    mode: 0o600,
  });
  // Write errors (a full disk, a revoked permission) arrive here, not at write():
  // unheard, they would be an uncaught exception that shuts the server down.
  stream.on("error", (error) => stopTracing(stream, error));
  writeStream = stream;
  write({ _meta: "trace_started", timestamp: new Date().toISOString(), pid: process.pid });
}

export function traceProviderMessage(provider: string, sessionId: string, message: unknown): void {
  if (!writeStream) return;
  const base = { _ts: Date.now(), _sid: sessionId, _provider: provider };
  write(
    message && typeof message === "object" && !Array.isArray(message)
      ? { ...base, ...(message as Record<string, unknown>) }
      : { ...base, _message: message },
  );
}

export function closeProviderTrace(): void {
  writeStream?.end();
  writeStream = null;
}

function write(record: unknown): void {
  const stream = writeStream;
  if (!stream) return;
  try {
    stream.write(`${JSON.stringify(record)}\n`);
  } catch (error) {
    stopTracing(stream, error);
  }
}

/** A debug trace must never break a session; say once why it stopped. */
function stopTracing(stream: fs.WriteStream, error: unknown): void {
  if (writeStream !== stream) return;
  writeStream = null;
  loggerFor("trace").warn({ err: error }, "Provider trace write failed; tracing stops");
  stream.destroy();
}
