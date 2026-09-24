import * as fs from "node:fs";
import * as path from "node:path";

type CodexDebugChannel = "sdk" | "jsonl";
type CodexDebugAuthority = "transient" | "durable";

export interface CodexCorrelationDebugRecord {
  sessionId: string;
  channel: CodexDebugChannel;
  authority: CodexDebugAuthority;
  transportId?: string;
  timestamp?: string;
  entryType?: string;
  payloadType?: string;
  eventKind?: string;
  turnId?: string;
  itemId?: string;
  callId?: string;
  phase?: string;
  sourceEvent?: string;
  status?: string;
  toolName?: string;
  messageType?: string;
  messageRole?: string;
  messageSubtype?: string;
  contentFingerprint?: string | null;
  contentPreview?: string | null;
}

let writeStream: fs.WriteStream | null = null;
let enabled = false;

export function initCodexCorrelationDebugLogger(options: {
  enabled: boolean;
  logDir: string;
}): void {
  enabled = options.enabled;
  if (!enabled) return;

  const logPath = path.join(options.logDir, "codex-correlation-debug.jsonl");

  fs.mkdirSync(options.logDir, { recursive: true });
  writeStream = fs.createWriteStream(logPath, { flags: "a" });

  logRaw({
    _meta: "logger_started",
    logger: "codex_correlation_debug",
    timestamp: new Date().toISOString(),
    pid: process.pid,
    path: logPath,
  });
}

export function closeCodexCorrelationDebugLogger(): void {
  if (writeStream) {
    writeStream.end();
    writeStream = null;
  }
}

export function isCodexCorrelationDebugEnabled(): boolean {
  return enabled;
}

export function logCodexCorrelationDebug(record: CodexCorrelationDebugRecord): void {
  if (!enabled || !writeStream) return;

  logRaw({
    _meta: "codex_correlation",
    _ts: Date.now(),
    ...record,
  });
}

function logRaw(obj: unknown): void {
  if (!writeStream) return;
  try {
    writeStream.write(`${JSON.stringify(obj)}\n`);
  } catch {
    // Ignore write errors for best-effort debug logging.
  }
}
