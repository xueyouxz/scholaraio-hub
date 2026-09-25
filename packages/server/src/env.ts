import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";
import { resolveProfileName } from "@scholaraio-hub/shared";
import { z } from "zod";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
// env.ts lives at packages/server/src (and builds to packages/server/dist).
const repoRoot = path.resolve(__dirname, "../../..");

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

const RuntimeEnvSchema = z
  .object({
    NODE_ENV: z.string().optional(),
    HOST: z.string().optional(),
    PORT: optionalInteger,
    LIBRARY_PORT: optionalInteger,
    SCHOLARAIO_HUB_DATA_DIR: z.string().optional(),
    SCHOLARAIO_HUB_PROFILE: z.string().optional(),
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
    SCHOLARAIO_HUB_UV: z.string().optional(),
    // Which Claude Code executable to run, and where its login lives.
    CLAUDE_CODE_EXECUTABLE: z.string().optional(),
    CLAUDE_CODE_PATH: z.string().optional(),
    CLAUDE_CODE_KEYCHAIN_SERVICE: z.string().optional(),
    // Debug: another usage endpoint for Claude's rate-limit windows.
    CLAUDE_OAUTH_USAGE_URL: z.string().optional(),
  })
  .passthrough();

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

let hasLoadedEnvFiles = false;

/**
 * Fill unset variables from the repo-root env files: `.env`, `.env.local`,
 * then `.env.<profile>` and `.env.<profile>.local`, later files winning. The
 * shell always wins over every file. The profile is read after the first two,
 * so `.env.local` may choose it.
 */
function loadEnvFilesIntoProcessEnv(env: NodeJS.ProcessEnv): void {
  if (hasLoadedEnvFiles) {
    return;
  }

  hasLoadedEnvFiles = true;

  const loadedValues: Record<string, string> = {};
  const load = (fileName: string) => {
    const filePath = path.join(repoRoot, fileName);
    if (existsSync(filePath)) {
      Object.assign(loadedValues, parseEnv(readFileSync(filePath, "utf-8")));
    }
  };

  load(".env");
  load(".env.local");
  const profile = resolveProfileName({ ...loadedValues, ...env });
  load(`.env.${profile}`);
  load(`.env.${profile}.local`);

  for (const [key, value] of Object.entries(loadedValues)) {
    if (env[key] === undefined) {
      env[key] = value;
    }
  }
}

export type RuntimeEnv = z.infer<typeof RuntimeEnvSchema>;

export function loadRuntimeEnv(env: NodeJS.ProcessEnv = process.env): RuntimeEnv {
  loadEnvFilesIntoProcessEnv(env);
  return RuntimeEnvSchema.parse(env);
}
