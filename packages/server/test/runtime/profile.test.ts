import * as os from "node:os";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import { resolveProfile } from "../../src/runtime/profile.js";

describe("resolveProfile", () => {
  it("runs development against the dev data directory and port", () => {
    expect(resolveProfile({ NODE_ENV: "development" })).toEqual({
      name: "dev",
      nodeEnv: "development",
      dataDir: path.join(os.homedir(), ".scholaraio-hub-dev"),
      port: 3500,
      libraryPort: 3501,
    });
  });

  it("derives production mode from the production profile", () => {
    expect(resolveProfile({ SCHOLARAIO_HUB_PROFILE: "production" })).toEqual({
      name: "production",
      nodeEnv: "production",
      dataDir: path.join(os.homedir(), ".scholaraio-hub"),
      port: 3400,
      libraryPort: 3401,
    });
  });

  it("keeps a built server on another profile's data and port", () => {
    const profile = resolveProfile({ NODE_ENV: "production", SCHOLARAIO_HUB_PROFILE: "demo" });
    expect(profile).toMatchObject({ name: "demo", nodeEnv: "production", port: 3500 });
    expect(profile.dataDir).toBe(path.join(os.homedir(), ".scholaraio-hub-demo"));
  });

  it("isolates tests in a temporary directory", () => {
    const profile = resolveProfile({ NODE_ENV: "test", SCHOLARAIO_HUB_PROFILE: "production" });
    expect(profile.name).toBe("test");
    expect(profile.dataDir.startsWith(os.tmpdir())).toBe(true);
    expect(profile.port).toBe(3600);
  });

  it("lets explicit overrides win", () => {
    expect(
      resolveProfile({ SCHOLARAIO_HUB_DATA_DIR: "/srv/hub", PORT: "4100", NODE_ENV: "production" }),
    ).toMatchObject({ dataDir: "/srv/hub", port: 4100 });
  });
});
