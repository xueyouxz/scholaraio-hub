import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { PROVIDER_NAMES, type ProviderName, isProviderName } from "@scholaraio-hub/shared";
import type { Level as LogLevel } from "pino";
import { loadRuntimeEnv } from "./env.js";
import { resolveProfile } from "./runtime/profile.js";
import { skillsDirectory } from "./skills/skillsDirectory.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export interface Config {
  /** Which instance this is; see `resolveProfile`. */
  profile: string;
  nodeEnv: string;
  dataDir: string;
  clientDistDir: string;
  idleTimeoutMs: number;
  port: number;
  host: string;
  logDir: string;
  logFile: string;
  logLevel: LogLevel;
  logFileLevel: LogLevel;
  logToFile: boolean;
  logPretty: boolean;
  enabledProviders: ProviderName[];
  /** Research skills: `SCHOLARAIO_SKILLS_DIR`, else `<dataDir>/skills`. */
  skillsDir: string;
  /** Extra hostnames the API answers besides loopback, or "*"; see `hostCheck`. */
  allowedHosts?: string;
  /** Debug: trace every raw provider message to `sdk-raw.jsonl` (see providers/trace.ts). */
  logSdkMessages: boolean;
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
    port: profile.port,
    host: env.HOST ?? "127.0.0.1",
    logDir: env.LOG_DIR ?? path.join(dataDir, "logs"),
    logFile: env.LOG_FILE ?? "server.log",
    logLevel: env.LOG_LEVEL ?? "info",
    logFileLevel: env.LOG_FILE_LEVEL ?? "info",
    // A production server keeps a log to read afterwards; a terminal gets readable lines.
    logToFile: env.LOG_TO_FILE ?? profile.nodeEnv === "production",
    logPretty: env.LOG_PRETTY ?? Boolean(process.stdout.isTTY),
    enabledProviders: parseEnabledProviders(env.ENABLED_PROVIDERS),
    skillsDir: env.SCHOLARAIO_SKILLS_DIR ?? skillsDirectory(dataDir),
    allowedHosts: env.ALLOWED_HOSTS,
    logSdkMessages: env.LOG_SDK_MESSAGES ?? false,
  };
}

/** The providers `ENABLED_PROVIDERS` names, or all of them; unknown names are refused. */
function parseEnabledProviders(value: string[] | undefined): ProviderName[] {
  if (!value?.length) return [...PROVIDER_NAMES];
  const unknown = value.filter((item) => !isProviderName(item));
  if (unknown.length)
    throw new Error(
      `ENABLED_PROVIDERS names unknown providers: ${unknown.join(", ")} (known: ${PROVIDER_NAMES.join(", ")})`,
    );
  return value.filter(isProviderName);
}
