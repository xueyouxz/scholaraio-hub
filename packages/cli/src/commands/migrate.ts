import { spawnSync } from "node:child_process";
import { currentProfile } from "../profile.js";
import { pythonRuntime, scholaraioSourceDir } from "../python.js";

/** Move an old ScholarAIO library into this data directory: plan, apply or rollback. */
export async function migrate(args: string[]): Promise<number> {
  const runtime = pythonRuntime(currentProfile().dataDir);
  const result = spawnSync(runtime.executable, ["-m", "scholaraio.hub.migration", ...args], {
    stdio: "inherit",
    cwd: scholaraioSourceDir,
    env: runtime.env(),
  });
  if (result.error) console.error(result.error.message);
  return result.status ?? 1;
}
