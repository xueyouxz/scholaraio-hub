import * as path from "node:path";
import { fileURLToPath } from "node:url";
import type { Level as LogLevel } from "pino";
import { loadRuntimeEnv } from "./env.js";
import { resolveProfile } from "./runtime/profile.js";
import type { PermissionMode } from "./sdk/types.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export interface Config {
  /** Which instance this is; see `resolveProfile`. */
  profile: string;
  nodeEnv: string;
  dataDir: string;
  clientDistDir: string;
  idleTimeoutMs: number;
  defaultPermissionMode: PermissionMode;
  port: number;
  host: string;
  logDir: string;
  logFile: string;
  logLevel: LogLevel;
  logFileLevel: LogLevel;
  logToFile: boolean;
  logPretty: boolean;
  enabledProviders: string[];
  httpsSelfSigned: boolean;
  scholaraioSkillsDir?: string;
  /** Debug: append every raw provider SDK message to `sdk-raw.jsonl`. */
  logSdkMessages: boolean;
  /** Debug: append Codex event correlation records to `codex-correlation-debug.jsonl`. */
  codexCorrelationDebug: boolean;
}

export function loadConfig(): Config {
  const env = loadRuntimeEnv();
  const profile = resolveProfile(process.env);
  const dataDir = profile.dataDir;

  return {
    profile: profile.name,
    nodeEnv: profile.nodeEnv,
    dataDir,
    clientDistDir: env.CLIENT_DIST_DIR ?? path.resolve(__dirname, "..", "..", "client", "dist"),
    idleTimeoutMs: (env.IDLE_TIMEOUT ?? 5 * 60) * 1000,
    defaultPermissionMode: env.PERMISSION_MODE ?? "default",
    port: profile.port,
    host: env.HOST ?? "127.0.0.1",
    logDir: env.LOG_DIR ?? path.join(dataDir, "logs"),
    logFile: env.LOG_FILE ?? "server.log",
    logLevel: env.LOG_LEVEL ?? "info",
    logFileLevel: env.LOG_FILE_LEVEL ?? "info",
    logToFile: env.LOG_TO_FILE ?? false,
    logPretty: env.LOG_PRETTY ?? true,
    enabledProviders: parseEnabledProviders(env.ENABLED_PROVIDERS),
    httpsSelfSigned: env.HTTPS_SELF_SIGNED ?? false,
    scholaraioSkillsDir: env.SCHOLARAIO_SKILLS_DIR,
    logSdkMessages: env.LOG_SDK_MESSAGES ?? false,
    codexCorrelationDebug: env.CODEX_CORRELATION_DEBUG ?? false,
  };
}

function parseEnabledProviders(value: string[] | undefined): string[] {
  if (!value?.length) {
    return ["claude", "codex"];
  }

  return value.filter((item) => item === "claude" || item === "codex");
}
