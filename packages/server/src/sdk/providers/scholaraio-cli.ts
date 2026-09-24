import { existsSync } from "node:fs";
import path from "node:path";
import { pythonRuntime } from "../../runtime/python.js";

/** The library agents work on, and the Hub API their write commands go through. */
export interface AgentLibrary {
  dataDir: string;
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
  // Nothing bound: no Hub library to point at (a test, or a `pnpm hub` command).
  if (!library) return env;
  const { dataDir, apiBaseUrl } = library;
  const config = path.join(dataDir, "config.yaml");
  // A missing config would make the CLI treat the agent's project directory as
  // a library root and write a stray one there. The library service creates the
  // file on startup, so this only guards a degraded start.
  if (!existsSync(config)) {
    warnOnce(`未找到 ${config}，本次未向 agent 注入文献库 CLI 环境。`);
    return env;
  }
  const result: Record<string, string | undefined> = { ...env, SCHOLARAIO_CONFIG: config };
  if (apiBaseUrl) result.SCHOLARAIO_HUB_API = apiBaseUrl;
  const runtime = pythonRuntime(dataDir);
  const executable = runtime.command("scholaraio");
  if (!existsSync(executable)) {
    warnOnce(`未找到 ${executable}，agent 将使用 PATH 上已有的 scholaraio。`);
    return result;
  }
  // Only the PATH entry: an agent's own Python work must not run inside the Hub's venv.
  result.PATH = [runtime.binDir, env.PATH].filter(Boolean).join(path.delimiter);
  return result;
}

const warned = new Set<string>();

function warnOnce(message: string): void {
  if (warned.has(message)) return;
  warned.add(message);
  console.warn(`[Library] ${message}`);
}
