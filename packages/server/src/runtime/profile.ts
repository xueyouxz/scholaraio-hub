import { mkdtempSync } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { resolveDerivedPorts, resolveProfileName } from "@scholaraio-hub/shared";

type Env = Record<string, string | undefined>;

export interface Profile {
  /** `production`, `dev`, `test` or any other name for a separate instance. */
  name: string;
  /** Build mode. Defaults from the profile; only the entry that runs the code sets it. */
  nodeEnv: string;
  dataDir: string;
  port: number;
}

let testDataDir: string | undefined;

/** Where this data directory lives when nothing overrides it. */
function defaultDataDir(name: string): string {
  if (name === "test") {
    // One per process, so a test run never reads or writes real data.
    testDataDir ??= mkdtempSync(path.join(os.tmpdir(), "scholaraio-hub-test-"));
    return testDataDir;
  }
  return path.join(
    os.homedir(),
    name === "production" ? ".scholaraio-hub" : `.scholaraio-hub-${name}`,
  );
}

/**
 * The single answer to "which Hub instance is this": its data directory and
 * port follow from the profile, so every entry point (server, CLI, dev
 * launcher) agrees on both.
 */
export function resolveProfile(env: Env): Profile {
  const name = resolveProfileName(env);
  return {
    name,
    nodeEnv: env.NODE_ENV || (name === "production" ? "production" : "development"),
    dataDir: env.SCHOLARAIO_HUB_DATA_DIR || defaultDataDir(name),
    port: resolveDerivedPorts(env).app,
  };
}
