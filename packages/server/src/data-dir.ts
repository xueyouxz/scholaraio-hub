import * as os from "node:os";
import * as path from "node:path";
import { loadRuntimeEnv } from "./env.js";

export function getDataDir(): string {
  const env = loadRuntimeEnv();

  if (env.SCHOLARAIO_HUB_DATA_DIR) {
    return env.SCHOLARAIO_HUB_DATA_DIR;
  }

  const profile = env.SCHOLARAIO_HUB_PROFILE?.trim();
  if (profile) {
    return path.join(
      os.homedir(),
      profile === "production" ? ".scholaraio-hub" : `.scholaraio-hub-${profile}`,
    );
  }

  if (env.NODE_ENV === "test") {
    return path.join(os.tmpdir(), ".scholaraio-hub-test");
  }

  return path.join(
    os.homedir(),
    env.NODE_ENV === "production" ? ".scholaraio-hub" : ".scholaraio-hub-dev",
  );
}
