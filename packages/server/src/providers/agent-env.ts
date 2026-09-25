/**
 * The environment an agent's process gets. An agent runs in the user's
 * project, so it gets the user's environment minus what belongs to the Hub
 * (every variable in the env schema, including NODE_ENV, which would break
 * project tooling such as Vitest), to the package manager that launched it, or
 * to the Python runtime the Hub activates — plus the library CLI pointed at
 * this Hub's library.
 */
import { existsSync } from "node:fs";
import path from "node:path";
import { HUB_ENV_KEYS } from "../env.js";
import { loggerFor } from "../logging/logger.js";

/** What every agent process of this server starts with. */
export function agentEnv(): Record<string, string | undefined> {
  return withScholaraioCli(filterEnvForChildProcess());
}

/** Prefixes to exclude from child process environment */
const EXCLUDED_PREFIXES = [
  "npm_", // npm/pnpm lifecycle variables
  "SCHOLARAIO_HUB_", // The Hub's namespace, including variables it sets for itself
  "VITE_", // Vite dev server variables
  "VITEST", // Vitest test runner
];

/** Exact variable names to exclude */
const EXCLUDED_VARS = new Set([
  ...HUB_ENV_KEYS,
  // Development tools
  "INIT_CWD",
  "COLOR",
  "FORCE_COLOR",
  // Prevent nested session detection when server runs inside Claude Code
  "CLAUDECODE",
  // Let the CLI settings or the explicit SDK model option select the model.
  "ANTHROPIC_MODEL",
  // The Hub's own Python runtime, not the project's
  "UV_PROJECT_ENVIRONMENT",
  "UV_CACHE_DIR",
]);

/**
 * Filter environment variables for spawning child Claude processes.
 *
 * @param env - Environment object to filter (defaults to process.env)
 * @returns Filtered environment object suitable for child processes
 */
export function filterEnvForChildProcess(
  env: Record<string, string | undefined> = process.env,
): Record<string, string | undefined> {
  const filtered: Record<string, string | undefined> = {};

  for (const [key, value] of Object.entries(env)) {
    // Exclude exact matches
    if (EXCLUDED_VARS.has(key)) {
      continue;
    }

    // Exclude by prefix
    if (EXCLUDED_PREFIXES.some((prefix) => key.startsWith(prefix))) {
      continue;
    }

    // Keep everything else
    filtered[key] = value;
  }

  return filtered;
}

/** The library agents work on, as the launcher describes it, and the API their writes go through. */
export interface AgentLibrary {
  /** The library's `config.yaml`, which the CLI resolves the library from. */
  configFile?: string;
  /** The directory holding the library runtime's `scholaraio` CLI. */
  cliBinDir?: string;
  /** Where this server listens, so the CLI does not edit the library behind its back. */
  apiBaseUrl?: string;
}

let bound: AgentLibrary | undefined;

/**
 * Name the library for every agent this process starts. The server's entry
 * point binds it once; providers are shared singletons and cannot ask their app.
 */
export function bindAgentLibrary(library: AgentLibrary | undefined): void {
  bound = library;
}

/**
 * Point an agent's `scholaraio` CLI at this application's library.
 *
 * Without this, the CLI a skill invokes resolves to whatever is on the user's
 * PATH and discovers its config from the working directory or `~/.scholaraio`,
 * so the agent and the browser end up reading two different libraries.
 */
export function withScholaraioCli(
  env: Record<string, string | undefined>,
  library: AgentLibrary | undefined = bound,
): Record<string, string | undefined> {
  // Nothing bound: no Hub library to point at (a test, or the doctor).
  if (!library?.configFile) return env;
  const { configFile, cliBinDir, apiBaseUrl } = library;
  // A missing config would make the CLI treat the agent's project directory as
  // a library root and write a stray one there. The library service creates the
  // file on startup, so this only guards a degraded start.
  if (!existsSync(configFile)) {
    warnOnce(`未找到 ${configFile}，本次未向 agent 注入文献库 CLI 环境。`);
    return env;
  }
  const result: Record<string, string | undefined> = { ...env, SCHOLARAIO_CONFIG: configFile };
  if (apiBaseUrl) result.SCHOLARAIO_HUB_API = apiBaseUrl;
  const executable = cliBinDir && path.join(cliBinDir, cliName("scholaraio"));
  if (!cliBinDir || !executable || !existsSync(executable)) {
    warnOnce(`未找到 ${executable ?? "文献库 CLI"}，agent 将使用 PATH 上已有的 scholaraio。`);
    return result;
  }
  // Only the PATH entry: an agent's own Python work must not run inside the Hub's venv.
  result.PATH = [cliBinDir, env.PATH].filter(Boolean).join(path.delimiter);
  return result;
}

/** A console script's file name on this platform. */
function cliName(name: string): string {
  return process.platform === "win32" ? `${name}.exe` : name;
}

const warned = new Set<string>();

function warnOnce(message: string): void {
  if (warned.has(message)) return;
  warned.add(message);
  loggerFor("agent-env").warn(message);
}
