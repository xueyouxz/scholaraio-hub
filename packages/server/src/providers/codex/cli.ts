import { exec, execFile } from "node:child_process";
import { existsSync } from "node:fs";
import * as os from "node:os";
import { promisify } from "node:util";

const isWindows = os.platform() === "win32";
const execAsync = promisify(exec);
const execFileAsync = promisify(execFile);

/**
 * Every `codex` on PATH, in PATH order: `where` lists them all on Windows,
 * `which` needs `-a` to go past the first.
 */
async function codexOnPath(): Promise<string[]> {
  try {
    const { stdout } = await execAsync(isWindows ? "where codex" : "which -a codex", {
      encoding: "utf-8",
    });
    return stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
  } catch {
    // Not on PATH; the install locations may still have one.
    return [];
  }
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
 * The Codex CLI this machine can run: of every one on PATH and in the usual
 * install locations whose `--version` succeeds, the newest. OpenAI serves each
 * CLI the model catalog its version supports, so an older copy that happens to
 * come first on PATH would hide newer models. Null when none runs.
 */
export async function findCodexCli(): Promise<{ path: string; version: string } | null> {
  const candidates = [
    ...new Set([
      ...(await codexOnPath()),
      ...getCodexCommonPaths().filter((path) => existsSync(path)),
    ]),
  ];
  const found = await Promise.all(
    candidates.map(async (path) => ({ path, version: await codexVersion(path) })),
  );
  let newest: { path: string; version: string } | null = null;
  for (const { path, version } of found) {
    if (!version) continue;
    // A tie keeps the earlier candidate: PATH order still decides between equals.
    if (!newest || compareCodexVersions(version, newest.version) > 0) newest = { path, version };
  }
  return newest;
}

/**
 * The Codex CLI to run: the configured one — and only it, so a broken setting
 * shows instead of silently running another — else the newest found.
 */
export async function resolveCodexCli(
  configured?: string,
): Promise<{ path: string; version: string } | null> {
  if (!configured) return findCodexCli();
  const version = await codexVersion(configured);
  return version ? { path: configured, version } : null;
}

/**
 * Order two `codex --version` outputs ("codex-cli 0.155.1", "codex-cli
 * 0.158.0-alpha.2") by the semver in them; a pre-release comes before its
 * release, and output without a version sorts first.
 */
export function compareCodexVersions(a: string, b: string): number {
  const parse = (output: string) => {
    const match = output.match(/(\d+)\.(\d+)\.(\d+)(?:-([\w.]+))?/);
    return match
      ? { parts: [Number(match[1]), Number(match[2]), Number(match[3])], pre: match[4] }
      : { parts: [-1, -1, -1], pre: undefined };
  };
  const left = parse(a);
  const right = parse(b);
  for (let i = 0; i < 3; i++) {
    const diff = (left.parts[i] as number) - (right.parts[i] as number);
    if (diff) return diff;
  }
  if (left.pre === right.pre) return 0;
  if (left.pre === undefined) return 1;
  if (right.pre === undefined) return -1;
  return left.pre.localeCompare(right.pre, undefined, { numeric: true });
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
