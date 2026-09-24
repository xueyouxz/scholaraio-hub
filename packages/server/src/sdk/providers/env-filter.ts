/**
 * Filter environment variables for agent child processes.
 *
 * An agent runs in the user's project, so it gets the user's environment
 * minus what belongs to the Hub (every variable in the env schema, including
 * NODE_ENV, which would break project tooling such as Vitest), to the package
 * manager that launched it, or to the Python runtime the Hub activates.
 */
import { HUB_ENV_KEYS } from "../../env.js";

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

/** Essential variables to always keep (even if they match excluded patterns) */
const ALWAYS_KEEP = new Set([
  // Core system
  "HOME",
  "USER",
  "SHELL",
  "PATH",
  "LANG",
  "LC_ALL",
  "LC_CTYPE",
  "TERM",
  "COLORTERM",
  // Common development tools
  "EDITOR",
  "VISUAL",
  "PAGER",
  // Node/runtime
  "NODE_OPTIONS",
  "NODE_PATH",
  "NVM_DIR",
  "NVM_BIN",
  // Git
  "GIT_AUTHOR_NAME",
  "GIT_AUTHOR_EMAIL",
  "GIT_COMMITTER_NAME",
  "GIT_COMMITTER_EMAIL",
  "GIT_SSH_COMMAND",
  // SSH
  "SSH_AUTH_SOCK",
  "SSH_AGENT_PID",
  // API keys Claude might need
  "ANTHROPIC_API_KEY",
  // XDG directories
  "XDG_CONFIG_HOME",
  "XDG_DATA_HOME",
  "XDG_CACHE_HOME",
  "XDG_RUNTIME_DIR",
  // Misc
  "TZ",
  "TMPDIR",
  "TEMP",
  "TMP",
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
    // Always keep essential variables
    if (ALWAYS_KEEP.has(key)) {
      filtered[key] = value;
      continue;
    }

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
