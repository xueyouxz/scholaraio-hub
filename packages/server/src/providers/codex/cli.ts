import { exec, execFile } from "node:child_process";
import { existsSync } from "node:fs";
import * as os from "node:os";
import { promisify } from "node:util";

const isWindows = os.platform() === "win32";
const execAsync = promisify(exec);
const execFileAsync = promisify(execFile);

/**
 * Returns the platform-appropriate command to locate an executable in PATH.
 * Uses `where` on Windows, `which` on Unix.
 */
function whichCommand(name: string): string {
  return isWindows ? `where ${name}` : `which ${name}`;
}

/**
 * Common Codex CLI installation paths (checked after PATH lookup).
 * Includes the Codex desktop app's sandbox-bin location.
 */
function getCodexCommonPaths(): string[] {
  const home = os.homedir();
  const ext = isWindows ? ".exe" : "";
  const sep = isWindows ? "\\" : "/";
  return isWindows
    ? [
        `${home}${sep}.codex${sep}.sandbox-bin${sep}codex${ext}`,
        `${home}${sep}.cargo${sep}bin${sep}codex${ext}`,
        `${home}${sep}.codex${sep}bin${sep}codex${ext}`,
        `${home}${sep}AppData${sep}Local${sep}bin${sep}codex${ext}`,
      ]
    : [
        `${home}/.codex/.sandbox-bin/codex`,
        `${home}/.local/bin/codex`,
        "/usr/local/bin/codex",
        `${home}/.cargo/bin/codex`,
        `${home}/.codex/bin/codex`,
      ];
}

/**
 * The Codex CLI this machine can run: PATH first, then the usual install
 * locations. A candidate counts only if `--version` succeeds. Null when none does.
 */
export async function findCodexCli(): Promise<{ path: string; version: string } | null> {
  const candidates: string[] = [];
  try {
    const { stdout } = await execAsync(whichCommand("codex"), { encoding: "utf-8" });
    const onPath = stdout.split("\n")[0]?.trim();
    if (onPath) candidates.push(onPath);
  } catch {
    // Not on PATH; try the install locations.
  }
  candidates.push(...getCodexCommonPaths().filter((path) => existsSync(path)));
  for (const path of candidates) {
    const version = await codexVersion(path);
    if (version) return { path, version };
  }
  return null;
}

/** The version the Codex CLI at `codexPath` reports, or undefined when it does not run. */
export async function codexVersion(codexPath: string): Promise<string | undefined> {
  try {
    const { stdout } = await execFileAsync(codexPath, ["--version"], {
      encoding: "utf-8",
      timeout: 10000,
    });
    const output = stdout.trim();
    return output;
  } catch {
    return undefined;
  }
}
