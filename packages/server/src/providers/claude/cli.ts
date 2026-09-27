/**
 * The Claude Code CLI on this machine: where it is, whether it runs, whether
 * it is logged in, and the OAuth credentials it stored.
 */

import { execFile } from "node:child_process";
import { constants, accessSync, existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { delimiter, join } from "node:path";
import { promisify } from "node:util";
import { loggerFor } from "../../logging/logger.js";
import type { AuthStatus } from "../types.js";

const execFileAsync = promisify(execFile);
const log = () => loggerFor("claude-cli");

const requireFromHere = createRequire(import.meta.url);
const requireFromClaudeSdk = createRequire(
  requireFromHere.resolve("@anthropic-ai/claude-agent-sdk"),
);
const CLAUDE_CODE_KEYCHAIN_SERVICE = "Claude Code-credentials";
/** How long reading the Keychain may take. */
const KEYCHAIN_TIMEOUT_MS = 8000;

/**
 * Absolute path to the local `claude` executable the SDK should spawn.
 *
 * The SDK defaults to a bundled `cli.js` that is absent in standalone installs
 * (and ships no native binary package for every platform). When the SDK can't
 * find an executable, `query()` spawns nothing, the init handshake never lands,
 * and `supportedModels()` hangs until the probe timeout — stalling
 * `/api/providers` for 15s. Resolving the executable ourselves and passing it as
 * `pathToClaudeCodeExecutable` makes the spawn deterministic.
 *
 * Resolution order (first hit wins): explicit env override → the SDK's optional
 * native binary package → `claude` on `PATH`. `undefined` lets the SDK fall back
 * to its own default (preserving prior behavior when nothing is found).
 */
const resolvedExecutables = new Map<string, string | null>();

function isExecutableFile(filePath: string | undefined): filePath is string {
  if (!filePath) return false;
  try {
    accessSync(filePath, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function resolvePathExecutable(command: string): string | undefined {
  if (!command.trim()) return undefined;

  // An explicit path is used as-is (when executable); a bare name is searched on PATH.
  if (command.includes("/") || command.includes("\\")) {
    return isExecutableFile(command) ? command : undefined;
  }

  const pathEnv = process.env.PATH ?? "";
  for (const dir of pathEnv.split(delimiter)) {
    const candidate = join(dir, command);
    if (isExecutableFile(candidate)) {
      return candidate;
    }
  }
  return undefined;
}

function hasGlibcRuntime(): boolean {
  if (typeof process.report?.getReport !== "function") {
    return false;
  }
  const report = process.report.getReport() as {
    header?: { glibcVersionRuntime?: string };
  };
  return Boolean(report.header?.glibcVersionRuntime);
}

function getClaudeSdkNativePackageNames(): string[] {
  const binaryArch = process.arch;
  if (process.platform === "linux") {
    const glibcPackage = `@anthropic-ai/claude-agent-sdk-linux-${binaryArch}`;
    const muslPackage = `${glibcPackage}-musl`;
    return hasGlibcRuntime() ? [glibcPackage, muslPackage] : [muslPackage, glibcPackage];
  }
  return [`@anthropic-ai/claude-agent-sdk-${process.platform}-${binaryArch}`];
}

function resolveClaudeSdkNativeExecutable(): string | undefined {
  const binaryName = process.platform === "win32" ? "claude.exe" : "claude";
  for (const packageName of getClaudeSdkNativePackageNames()) {
    try {
      const executable = requireFromClaudeSdk.resolve(`${packageName}/${binaryName}`);
      if (isExecutableFile(executable)) {
        return executable;
      }
    } catch {
      // Optional native package not installed for this platform — try the next.
    }
  }
  return undefined;
}

/** 解析要运行的 Claude Code 可执行文件：`configured`（配置指定）优先，结果按配置缓存。 */
export function resolveLocalClaudeCodeExecutable(configured?: string): string | undefined {
  const key = configured ?? "";
  const cached = resolvedExecutables.get(key);
  if (cached !== undefined) return cached ?? undefined;
  const executable = configured
    ? resolvePathExecutable(configured)
    : (resolveClaudeSdkNativeExecutable() ?? resolvePathExecutable("claude"));
  resolvedExecutables.set(key, executable ?? null);
  return executable;
}

/** Whether `executable` runs at all (a path on disk does not prove it). */
export async function canRunClaude(executable: string): Promise<boolean> {
  try {
    await execFileAsync(executable, ["--version"], { encoding: "utf8", timeout: 10000 });
    return true;
  } catch (error) {
    log().warn({ err: error }, "Claude CLI cannot run");
    return false;
  }
}

/**
 * Ask the Claude CLI directly whether it is logged in. Returns null (so callers
 * fall through to credential inspection) when the CLI doesn't support
 * `auth status`, times out, or emits non-JSON output — those are expected, not
 * failures worth surfacing.
 */
export async function claudeAuthStatus(executable: string): Promise<AuthStatus | null> {
  try {
    const { stdout } = await execFileAsync(executable, ["auth", "status"], {
      encoding: "utf-8",
      timeout: 5000,
    });
    const parsed = JSON.parse(stdout) as {
      loggedIn?: boolean;
      email?: string;
      subscriptionType?: string | null;
    };
    if (typeof parsed.loggedIn !== "boolean") return null;
    return {
      installed: true,
      authenticated: parsed.loggedIn,
      enabled: parsed.loggedIn,
      user: parsed.email ? { email: parsed.email } : undefined,
      plan: parsed.subscriptionType || undefined,
    };
  } catch (error) {
    log().debug({ err: error }, "`claude auth status` unavailable, falling back");
    return null;
  }
}

/** The `claudeAiOauth` block Claude Code stores after a login. */
export interface ClaudeOAuthCredentials {
  accessToken?: string;
  refreshToken?: string;
  expiresAt?: number;
  subscriptionType?: string | null;
}

/**
 * Read the stored OAuth credentials: from the Keychain on macOS (under
 * `keychainService`), from a plaintext `~/.claude/.credentials.json`
 * elsewhere. Null when absent or unreadable.
 */
export async function readClaudeOAuthCredentials(
  keychainService = CLAUDE_CODE_KEYCHAIN_SERVICE,
): Promise<ClaudeOAuthCredentials | null> {
  try {
    let raw: string;
    if (process.platform === "darwin") {
      const { stdout } = await execFileAsync(
        "security",
        ["find-generic-password", "-s", keychainService, "-w"],
        { timeout: KEYCHAIN_TIMEOUT_MS },
      );
      raw = stdout;
    } else {
      const credentialsPath = join(homedir(), ".claude", ".credentials.json");
      if (!existsSync(credentialsPath)) return null;
      raw = readFileSync(credentialsPath, "utf-8");
    }
    const parsed = JSON.parse(raw) as { claudeAiOauth?: ClaudeOAuthCredentials };
    return parsed.claudeAiOauth ?? null;
  } catch (error) {
    log().debug({ err: error }, "No readable OAuth credentials");
    return null;
  }
}
