import { z } from "zod";

const LogLevelSchema = z.enum(["fatal", "error", "warn", "info", "debug", "trace"]);

/** An unset variable and an empty one mean the same: not configured. */
const blank = (value: unknown) => (value === "" ? undefined : value);
const optionalInteger = z.preprocess(blank, z.coerce.number().int().nonnegative().optional());
const optionalBoolean = z.preprocess(blank, z.stringbool().optional());
const optionalStringArray = z.preprocess(
  (value) =>
    typeof value === "string" && value.trim()
      ? value
          .split(",")
          .map((item) => item.trim())
          .filter(Boolean)
      : undefined,
  z.array(z.string()).optional(),
);

/**
 * Every variable that belongs to the Hub. The launcher (`packages/cli`) reads
 * the env files and the profile and sets the ones marked "from the launcher";
 * the rest the user may set. None of them reaches an agent's process except
 * those in `SHARED_WITH_AGENTS`.
 */
const RuntimeEnvSchema = z.object({
  NODE_ENV: z.string().optional(),
  HOST: z.string().optional(),
  // From the launcher: this instance, its data and its ports.
  PORT: optionalInteger,
  SCHOLARAIO_HUB_DATA_DIR: z.string().optional(),
  SCHOLARAIO_HUB_PROFILE: z.string().optional(),
  LIBRARY_URL: z.string().optional(),
  // The launcher's own: the library service's port and the uv it installs with.
  LIBRARY_PORT: optionalInteger,
  SCHOLARAIO_HUB_UV: z.string().optional(),
  // From the launcher: what an agent's `scholaraio` CLI needs to work on this library.
  SCHOLARAIO_CONFIG: z.string().optional(),
  SCHOLARAIO_CLI_BIN: z.string().optional(),
  CLIENT_DIST_DIR: z.string().optional(),
  SCHOLARAIO_SKILLS_DIR: z.string().optional(),
  IDLE_TIMEOUT: optionalInteger,
  LOG_DIR: z.string().optional(),
  LOG_FILE: z.string().optional(),
  LOG_LEVEL: LogLevelSchema.optional(),
  LOG_FILE_LEVEL: LogLevelSchema.optional(),
  LOG_TO_FILE: optionalBoolean,
  LOG_PRETTY: optionalBoolean,
  ENABLED_PROVIDERS: optionalStringArray,
  ALLOWED_HOSTS: z.string().optional(),
  LOG_SDK_MESSAGES: optionalBoolean,
  // Which Claude Code executable to run, and where its login lives.
  CLAUDE_CODE_EXECUTABLE: z.string().optional(),
  CLAUDE_CODE_PATH: z.string().optional(),
  CLAUDE_CODE_KEYCHAIN_SERVICE: z.string().optional(),
  // Which Codex CLI to run; unset picks the newest one found.
  CODEX_EXECUTABLE: z.string().optional(),
  // Debug: another usage endpoint for Claude's rate-limit windows.
  CLAUDE_OAUTH_USAGE_URL: z.string().optional(),
});

/** Variables the Hub reads that describe the user's Claude Code, so its agents keep them too. */
const SHARED_WITH_AGENTS = new Set([
  "CLAUDE_CODE_EXECUTABLE",
  "CLAUDE_CODE_PATH",
  "CLAUDE_CODE_KEYCHAIN_SERVICE",
]);

/** Every variable that belongs to the Hub alone; none of them reaches an agent's process. */
export const HUB_ENV_KEYS: readonly string[] = Object.keys(RuntimeEnvSchema.shape).filter(
  (key) => !SHARED_WITH_AGENTS.has(key),
);

export type RuntimeEnv = z.infer<typeof RuntimeEnvSchema>;

export function loadRuntimeEnv(env: NodeJS.ProcessEnv = process.env): RuntimeEnv {
  return RuntimeEnvSchema.parse(env);
}
