import { spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { UV_MISSING_HINT, planRuntimeSync } from "../install.js";
import { currentProfile } from "../profile.js";

/** Install or update the data directory's Python runtime, keeping its capabilities. */
export async function setup(): Promise<number> {
  const { dataDir } = currentProfile();
  mkdirSync(dataDir, { recursive: true });
  const sync = planRuntimeSync(dataDir);
  console.log(`Data directory: ${dataDir}`);
  console.log(`Python runtime: core${sync.capabilities.map((item) => ` + ${item}`).join("")}`);
  const result = spawnSync(sync.command, sync.args, { stdio: "inherit", env: sync.env });
  if (result.error) console.error(UV_MISSING_HINT, result.error.message);
  if (result.status !== 0) return result.status ?? 1;
  sync.commit();
  return 0;
}
