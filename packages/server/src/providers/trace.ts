import * as fs from "node:fs";
import * as path from "node:path";

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
  writeStream = fs.createWriteStream(path.join(options.logDir, "sdk-raw.jsonl"), { flags: "a" });
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
  try {
    writeStream?.write(`${JSON.stringify(record)}\n`);
  } catch (error) {
    // A debug trace must never break a session; say once why it stopped.
    console.warn("[Trace] provider trace write failed; tracing stops", error);
    writeStream = null;
  }
}
