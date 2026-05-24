import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseDotenv } from "dotenv";
import { z } from "zod";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "../..");

const PermissionModeSchema = z.enum(["default", "acceptEdits", "plan", "bypassPermissions"]);

const LogLevelSchema = z.enum(["fatal", "error", "warn", "info", "debug", "trace"]);

const optionalInteger = z.preprocess((value) => {
  if (value === undefined || value === "") {
    return undefined;
  }

  const parsed = Number.parseInt(String(value), 10);
  return Number.isFinite(parsed) ? parsed : value;
}, z.number().int().nonnegative().optional());

const optionalBoolean = z.preprocess((value) => {
  if (value === undefined || value === "") {
    return undefined;
  }

  if (value === true || value === "true" || value === "1") {
    return true;
  }

  if (value === false || value === "false" || value === "0") {
    return false;
  }

  return value;
}, z.boolean().optional());

const optionalStringArray = z.preprocess((value) => {
  if (typeof value !== "string" || value.trim() === "") {
    return undefined;
  }

  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}, z.array(z.string()).optional());

const RuntimeEnvSchema = z
  .object({
    NODE_ENV: z.string().optional(),
    HOST: z.string().optional(),
    PORT: optionalInteger,
    CLIENT_PORT: optionalInteger,
    CLIENT_PREVIEW_PORT: optionalInteger,
    SCHOLARAIO_HUB_DATA_DIR: z.string().optional(),
    SCHOLARAIO_HUB_PROFILE: z.string().optional(),
    CLAUDE_SESSIONS_DIR: z.string().optional(),
    CLAUDE_CONFIG_DIR: z.string().optional(),
    CLAUDE_PROJECTS_DIR: z.string().optional(),
    CODEX_SESSIONS_DIR: z.string().optional(),
    CODEX_WATCH_PERIODIC_RESCAN_MS: optionalInteger,
    CLIENT_DIST_DIR: z.string().optional(),
    PROJECT_SCAN_CACHE_TTL_MS: optionalInteger,
    IDLE_TIMEOUT: optionalInteger,
    PERMISSION_MODE: PermissionModeSchema.optional(),
    MAX_WORKERS: optionalInteger,
    IDLE_PREEMPT_THRESHOLD: optionalInteger,
    MAX_UPLOAD_SIZE_MB: optionalInteger,
    MAX_QUEUE_SIZE: optionalInteger,
    LOG_DIR: z.string().optional(),
    LOG_FILE: z.string().optional(),
    LOG_LEVEL: LogLevelSchema.optional(),
    LOG_FILE_LEVEL: LogLevelSchema.optional(),
    LOG_TO_FILE: optionalBoolean,
    LOG_PRETTY: optionalBoolean,
    ENABLED_PROVIDERS: optionalStringArray,
    VOICE_INPUT_ENABLED: optionalBoolean,
    HTTPS_SELF_SIGNED: optionalBoolean,
    SCHOLARAIO_API_URL: z.string().optional(),
    SCHOLARAIO_SKILLS_DIR: z.string().optional(),
  })
  .passthrough();

let hasLoadedEnvFiles = false;

function loadEnvFilesIntoProcessEnv(env: NodeJS.ProcessEnv): void {
  if (hasLoadedEnvFiles) {
    return;
  }

  hasLoadedEnvFiles = true;

  const nodeEnv = env.NODE_ENV || "development";
  const profile = env.SCHOLARAIO_HUB_PROFILE;
  const fileNames = [
    ".env",
    ".env.local",
    `.env.${nodeEnv}`,
    `.env.${nodeEnv}.local`,
    profile ? `.env.profile.${profile}` : undefined,
    profile ? `.env.profile.${profile}.local` : undefined,
  ].filter((value): value is string => Boolean(value));

  const loadedValues: Record<string, string> = {};

  for (const fileName of fileNames) {
    const filePath = path.join(repoRoot, fileName);

    if (!existsSync(filePath)) {
      continue;
    }

    Object.assign(loadedValues, parseDotenv(readFileSync(filePath, "utf-8")));
  }

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
