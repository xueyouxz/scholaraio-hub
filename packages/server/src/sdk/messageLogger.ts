import * as fs from "node:fs";
import * as path from "node:path";

/**
 * Simple JSONL logger for raw SDK messages.
 * Captures exact message shapes for analysis.
 *
 * Disabled by default (LOG_SDK_MESSAGES). Output: {logDir}/sdk-raw.jsonl
 */

let writeStream: fs.WriteStream | null = null;
let enabled = false;

/**
 * Initialize the SDK message logger.
 * Call once at server startup.
 */
export function initMessageLogger(options: { enabled: boolean; logDir: string }): void {
  enabled = options.enabled;
  if (!enabled) return;

  const logPath = path.join(options.logDir, "sdk-raw.jsonl");

  // Ensure log directory exists
  fs.mkdirSync(options.logDir, { recursive: true });

  // Open append stream
  writeStream = fs.createWriteStream(logPath, { flags: "a" });

  // Log startup
  logRaw({
    _meta: "logger_started",
    timestamp: new Date().toISOString(),
    pid: process.pid,
  });
}

/**
 * Log a raw SDK message.
 */
export function logSDKMessage(
  sessionId: string,
  message: unknown,
  options?: {
    provider?: string;
  },
): void {
  if (!enabled || !writeStream) return;

  const base = {
    _ts: Date.now(),
    _sid: sessionId,
    ...(options?.provider ? { _provider: options.provider } : {}),
  };

  if (message && typeof message === "object" && !Array.isArray(message)) {
    logRaw({
      ...base,
      ...(message as Record<string, unknown>),
    });
    return;
  }

  logRaw({
    ...base,
    _message: message,
  });
}

/**
 * Log any object as a raw line.
 */
function logRaw(obj: unknown): void {
  if (!writeStream) return;
  try {
    writeStream.write(`${JSON.stringify(obj)}\n`);
  } catch {
    // Ignore write errors
  }
}

/**
 * Close the logger.
 */
export function closeMessageLogger(): void {
  if (writeStream) {
    writeStream.end();
    writeStream = null;
  }
}
