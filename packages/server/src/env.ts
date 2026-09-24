import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolveProfileName } from "@scholaraio-hub/shared";
import { parse as parseDotenv } from "dotenv";
import { z } from "zod";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
// env.ts lives at packages/server/src (and builds to packages/server/dist), so the
// repo root is three levels up. Using "../.." pointed at packages/, where no .env
// files exist, so repo-root .env/.env.local were silently never loaded.
const repoRoot = path.resolve(__dirname, "../../..");

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
    SCHOLARAIO_HUB_DATA_DIR: z.string().optional(),
    SCHOLARAIO_HUB_PROFILE: z.string().optional(),
    CLAUDE_CONFIG_DIR: z.string().optional(),
    CLIENT_DIST_DIR: z.string().optional(),
    SCHOLARAIO_SKILLS_DIR: z.string().optional(),
    IDLE_TIMEOUT: optionalInteger,
    PERMISSION_MODE: PermissionModeSchema.optional(),
    LOG_DIR: z.string().optional(),
    LOG_FILE: z.string().optional(),
    LOG_LEVEL: LogLevelSchema.optional(),
    LOG_FILE_LEVEL: LogLevelSchema.optional(),
    LOG_TO_FILE: optionalBoolean,
    LOG_PRETTY: optionalBoolean,
    ENABLED_PROVIDERS: optionalStringArray,
    HTTPS_SELF_SIGNED: optionalBoolean,
  })
  .passthrough();

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
      Object.assign(loadedValues, parseDotenv(readFileSync(filePath, "utf-8")));
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
