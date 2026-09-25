import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";
import { resolveProfileName } from "@scholaraio-hub/shared";

/** The checkout: packages/cli/src → the repository root. */
const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));

let loaded = false;

/**
 * Fill unset variables from the repo-root env files: `.env`, `.env.local`,
 * then `.env.<profile>` and `.env.<profile>.local`, later files winning. The
 * shell always wins over every file. The profile is read after the first two,
 * so `.env.local` may choose it. The launcher does this once; the processes it
 * starts inherit the result.
 */
export function loadEnvFiles(env: NodeJS.ProcessEnv = process.env): void {
  if (loaded) return;
  loaded = true;
  const values: Record<string, string> = {};
  const load = (name: string) => {
    const file = path.join(repoRoot, name);
    if (existsSync(file)) Object.assign(values, parseEnv(readFileSync(file, "utf-8")));
  };
  load(".env");
  load(".env.local");
  const profile = resolveProfileName({ ...values, ...env });
  load(`.env.${profile}`);
  load(`.env.${profile}.local`);
  for (const [key, value] of Object.entries(values)) if (env[key] === undefined) env[key] = value;
}
