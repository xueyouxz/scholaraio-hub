import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { PROVIDER_NAMES, type ProviderName, isProviderName } from "@scholaraio-hub/shared";
import type { Level as LogLevel } from "pino";
import { type RuntimeEnv, loadRuntimeEnv } from "./env.js";
import { skillsDirectory } from "./skills/skillsDirectory.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export interface Config {
  /** Which instance this is; the launcher resolves it (`packages/cli/src/profile.ts`). */
  profile: string;
  nodeEnv: string;
  dataDir: string;
  clientDistDir: string;
  idleTimeoutMs: number;
  port: number;
  host: string;
  /** The library service the launcher started beside this server. */
  libraryUrl: string;
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
  /** What an agent's `scholaraio` CLI needs to work on this Hub's library. */
  agentLibrary: { configFile?: string; cliBinDir?: string };
  /** 各 Provider 的配置（`CLAUDE_*`）。 */
  claude: ClaudeSettings;
}

/** Claude Provider 读取的配置；也供 doctor 在没有启动器变量时使用。 */
export interface ClaudeSettings {
  executable?: string;
  keychainService?: string;
  usageUrl?: string;
}

/** 从环境变量读取 Claude Provider 的配置。 */
export function loadClaudeSettings(env: RuntimeEnv = loadRuntimeEnv()): ClaudeSettings {
  return {
    executable: env.CLAUDE_CODE_EXECUTABLE ?? env.CLAUDE_CODE_PATH,
    keychainService: env.CLAUDE_CODE_KEYCHAIN_SERVICE,
    usageUrl: env.CLAUDE_OAUTH_USAGE_URL,
  };
}

/** A variable the launcher always sets; without it this is not a launched server. */
function required<T>(name: string, value: T | undefined): T {
  if (value === undefined)
    throw new Error(`${name} 未设置：服务端由启动器启动（pnpm dev / pnpm start），不单独运行。`);
  return value;
}

/** The server's configuration, from the variables the launcher set; frozen. */
export function loadConfig(): Readonly<Config> {
  const env = loadRuntimeEnv();
  const dataDir = required("SCHOLARAIO_HUB_DATA_DIR", env.SCHOLARAIO_HUB_DATA_DIR);
  const nodeEnv = env.NODE_ENV ?? "development";
  return Object.freeze({
    profile: env.SCHOLARAIO_HUB_PROFILE ?? (nodeEnv === "production" ? "production" : "dev"),
    nodeEnv,
    dataDir,
    clientDistDir: env.CLIENT_DIST_DIR ?? path.resolve(__dirname, "..", "..", "client", "dist"),
    idleTimeoutMs: (env.IDLE_TIMEOUT ?? 5 * 60) * 1000,
    port: required("PORT", env.PORT),
    host: env.HOST ?? "127.0.0.1",
    libraryUrl: required("LIBRARY_URL", env.LIBRARY_URL),
    logDir: env.LOG_DIR ?? path.join(dataDir, "logs"),
    logFile: env.LOG_FILE ?? "server.log",
    logLevel: env.LOG_LEVEL ?? "info",
    logFileLevel: env.LOG_FILE_LEVEL ?? "info",
    // A production server keeps a log to read afterwards; a terminal gets readable lines.
    logToFile: env.LOG_TO_FILE ?? nodeEnv === "production",
    logPretty: env.LOG_PRETTY ?? Boolean(process.stdout.isTTY),
    enabledProviders: parseEnabledProviders(env.ENABLED_PROVIDERS),
    skillsDir: env.SCHOLARAIO_SKILLS_DIR ?? skillsDirectory(dataDir),
    allowedHosts: env.ALLOWED_HOSTS,
    logSdkMessages: env.LOG_SDK_MESSAGES ?? false,
    agentLibrary: {
      configFile: env.SCHOLARAIO_CONFIG,
      cliBinDir: env.SCHOLARAIO_CLI_BIN,
    },
    claude: loadClaudeSettings(env),
  });
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
