import { mkdtempSync } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { loadRuntimeEnv } from "./env.js";

let testDataDir: string | undefined;

export function getDataDir(): string {
  const env = loadRuntimeEnv();

  if (env.SCHOLARAIO_HUB_DATA_DIR) {
    return env.SCHOLARAIO_HUB_DATA_DIR;
  }

  if (env.NODE_ENV === "test") {
    testDataDir ??= mkdtempSync(path.join(os.tmpdir(), "scholaraio-hub-test-"));
    return testDataDir;
  }

  const profile = env.SCHOLARAIO_HUB_PROFILE?.trim();
  if (profile) {
    return path.join(
      os.homedir(),
      profile === "production" ? ".scholaraio-hub" : `.scholaraio-hub-${profile}`,
    );
  }

  return path.join(
    os.homedir(),
    env.NODE_ENV === "production" ? ".scholaraio-hub" : ".scholaraio-hub-dev",
  );
}
