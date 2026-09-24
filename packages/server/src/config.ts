import * as path from "node:path";
import { fileURLToPath } from "node:url";
import type { Level as LogLevel } from "pino";
import { loadRuntimeEnv } from "./env.js";
import { resolveProfile } from "./runtime/profile.js";
import type { PermissionMode } from "./sdk/types.js";

export { getDataDir } from "./data-dir.js";

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
    defaultPermissionMode: parsePermissionMode(env.PERMISSION_MODE),
    port: profile.port,
    host: env.HOST ?? "127.0.0.1",
    logDir: env.LOG_DIR ?? path.join(dataDir, "logs"),
    logFile: env.LOG_FILE ?? "server.log",
    logLevel: parseLogLevel(env.LOG_LEVEL),
    logFileLevel: parseLogLevel(env.LOG_FILE_LEVEL),
    logToFile: env.LOG_TO_FILE ?? false,
    logPretty: env.LOG_PRETTY ?? true,
    enabledProviders: parseEnabledProviders(env.ENABLED_PROVIDERS),
    httpsSelfSigned: env.HTTPS_SELF_SIGNED ?? false,
    scholaraioSkillsDir: env.SCHOLARAIO_SKILLS_DIR,
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
