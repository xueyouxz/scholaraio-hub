import { existsSync } from "node:fs";
import path from "node:path";
import { getDataDir } from "../../data-dir.js";

let apiBaseUrl: string | undefined;
let libraryDataDir: string | undefined;

/**
 * Which data directory the running application owns. Providers are shared
 * singletons, so they cannot read it from the app they belong to.
 */
export function setLibraryDataDir(dataDir: string): void {
  libraryDataDir = dataDir;
}

/**
 * Tell agent CLI runs where this server listens, so their write commands go
 * through the Hub instead of editing the data directory behind its back.
 */
export function setHubApiBaseUrl(url: string | undefined): void {
  apiBaseUrl = url;
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
  dataDir: string = libraryDataDir ?? getDataDir(),
): Record<string, string | undefined> {
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
  const binDir = path.join(
    dataDir,
    "runtime",
    "python",
    process.platform === "win32" ? "Scripts" : "bin",
  );
  const executable = path.join(
    binDir,
    process.platform === "win32" ? "scholaraio.exe" : "scholaraio",
  );
  if (!existsSync(executable)) {
    warnOnce(`未找到 ${executable}，agent 将使用 PATH 上已有的 scholaraio。`);
    return result;
  }
  result.PATH = [binDir, env.PATH].filter(Boolean).join(path.delimiter);
  return result;
}

const warned = new Set<string>();

function warnOnce(message: string): void {
  if (warned.has(message)) return;
  warned.add(message);
  console.warn(`[Library] ${message}`);
}
