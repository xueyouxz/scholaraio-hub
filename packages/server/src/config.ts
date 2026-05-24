import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { resolveDerivedPorts } from "@scholaraio-hub/shared";
import type { Level as LogLevel } from "pino";
import { getDataDir } from "./data-dir.js";
import { loadRuntimeEnv } from "./env.js";
import { getDefaultCodexSessionsDir } from "./projects/codex-scanner.js";
import type { PermissionMode } from "./sdk/types.js";

export { getDataDir } from "./data-dir.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export interface Config {
  dataDir: string;
  scholarAioApiUrl: string;
  clientDistDir: string;
  claudeProjectsDir: string;
  claudeSessionsDir: string;
  codexSessionsDir: string;
  codexWatchPeriodicRescanMs: number;
  projectScanCacheTtlMs: number;
  idleTimeoutMs: number;
  defaultPermissionMode: PermissionMode;
  port: number;
  host: string;
  maxWorkers: number;
  idlePreemptThresholdMs: number;
  maxUploadSizeBytes: number;
  maxQueueSize: number;
  logDir: string;
  logFile: string;
  logLevel: LogLevel;
  logFileLevel: LogLevel;
  logToFile: boolean;
  logPretty: boolean;
  enabledProviders: string[];
  voiceInputEnabled: boolean;
  httpsSelfSigned: boolean;
  scholaraioSkillsDir: string;
}

export function loadConfig(): Config {
  const env = loadRuntimeEnv();
  const dataDir = getDataDir();
  const ports = resolveDerivedPorts({
    PORT: env.PORT?.toString(),
    CLIENT_PORT: env.CLIENT_PORT?.toString(),
    CLIENT_PREVIEW_PORT: env.CLIENT_PREVIEW_PORT?.toString(),
  });

  const claudeSessionsDir =
    env.CLAUDE_SESSIONS_DIR ??
    path.join(env.CLAUDE_CONFIG_DIR ?? path.join(os.homedir(), ".claude"), "projects");
  const codexSessionsDir = env.CODEX_SESSIONS_DIR ?? getDefaultCodexSessionsDir();

  const defaultCodexWatchPeriodicRescanMs =
    process.platform === "darwin" || process.platform === "win32" ? 5000 : 0;
  const codexWatchPeriodicRescanMs = Math.max(
    0,
    env.CODEX_WATCH_PERIODIC_RESCAN_MS ?? defaultCodexWatchPeriodicRescanMs,
  );

  return {
    dataDir,
    scholarAioApiUrl: env.SCHOLARAIO_API_URL ?? "http://127.0.0.1:8765",
    clientDistDir: env.CLIENT_DIST_DIR ?? path.resolve(__dirname, "..", "..", "client", "dist"),
    claudeProjectsDir: env.CLAUDE_PROJECTS_DIR ?? claudeSessionsDir,
    claudeSessionsDir,
    codexSessionsDir,
    codexWatchPeriodicRescanMs,
    projectScanCacheTtlMs: Math.max(0, env.PROJECT_SCAN_CACHE_TTL_MS ?? 5000),
    idleTimeoutMs: (env.IDLE_TIMEOUT ?? 5 * 60) * 1000,
    defaultPermissionMode: parsePermissionMode(env.PERMISSION_MODE),
    port: ports.app,
    host: env.HOST ?? "127.0.0.1",
    maxWorkers: env.MAX_WORKERS ?? 0,
    idlePreemptThresholdMs: (env.IDLE_PREEMPT_THRESHOLD ?? 10) * 1000,
    maxUploadSizeBytes: (env.MAX_UPLOAD_SIZE_MB ?? 100) * 1024 * 1024,
    maxQueueSize: env.MAX_QUEUE_SIZE ?? 100,
    logDir: env.LOG_DIR ?? path.join(dataDir, "logs"),
    logFile: env.LOG_FILE ?? "server.log",
    logLevel: parseLogLevel(env.LOG_LEVEL),
    logFileLevel: parseLogLevel(env.LOG_FILE_LEVEL),
    logToFile: env.LOG_TO_FILE ?? false,
    logPretty: env.LOG_PRETTY ?? true,
    enabledProviders: parseEnabledProviders(env.ENABLED_PROVIDERS),
    voiceInputEnabled: env.VOICE_INPUT_ENABLED ?? true,
    httpsSelfSigned: env.HTTPS_SELF_SIGNED ?? false,
    scholaraioSkillsDir:
      env.SCHOLARAIO_SKILLS_DIR ?? path.join(os.homedir(), "scholaraio", "skills"),
  };
}

function parsePermissionMode(value: PermissionMode | undefined): PermissionMode {
  switch (value) {
    case "acceptEdits":
    case "bypassPermissions":
    case "default":
    case "plan":
      return value;
    default:
      return "default";
  }
}

function parseLogLevel(value: LogLevel | undefined): LogLevel {
  switch (value) {
    case "fatal":
    case "error":
    case "warn":
    case "info":
    case "debug":
    case "trace":
      return value;
    default:
      return "info";
  }
}

function parseEnabledProviders(value: string[] | undefined): string[] {
  if (!value?.length) {
    return ["claude", "codex"];
  }

  return value.filter((item) => item === "claude" || item === "codex");
}
