import { spawnSync } from "node:child_process";
import { getDataDir } from "../data-dir.js";
import { pythonRuntime, scholarSourceDir } from "../runtime/python.js";

/** Move an old ScholarAIO library into this data directory: plan, apply or rollback. */
export async function migrate(args: string[]): Promise<number> {
  const runtime = pythonRuntime(getDataDir());
  const result = spawnSync(runtime.executable, ["-m", "scholaraio.hub.migration", ...args], {
    stdio: "inherit",
    cwd: scholarSourceDir,
    env: runtime.env(),
  });
  if (result.error) console.error(result.error.message);
  return result.status ?? 1;
}
