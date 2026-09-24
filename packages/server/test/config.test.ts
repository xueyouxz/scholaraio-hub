import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

describe("application data configuration", () => {
  it("isolates tests from profile and home data", async () => {
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("SCHOLARAIO_HUB_PROFILE", "production");
    const { currentProfile } = await import("../src/runtime/profile.js");
    expect(currentProfile().dataDir).toContain("scholaraio-hub-test-");
    expect(currentProfile().dataDir).not.toContain(os.homedir());
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("keeps CLI directories out of application configuration", async () => {
    const { loadConfig } = await import("../src/config.js");
    expect(loadConfig()).not.toHaveProperty("codexSessionsDir");
    expect(loadConfig()).not.toHaveProperty("claudeProjectsDir");
  });

  it("uses ~/.scholaraio-hub-dev outside production by default", async () => {
    vi.stubEnv("NODE_ENV", "development");

    const { currentProfile } = await import("../src/runtime/profile.js");

    expect(currentProfile().dataDir).toBe(path.join(os.homedir(), ".scholaraio-hub-dev"));
  });

  it("uses ~/.scholaraio-hub in production", async () => {
    vi.stubEnv("NODE_ENV", "production");

    const { currentProfile } = await import("../src/runtime/profile.js");

    expect(currentProfile().dataDir).toBe(path.join(os.homedir(), ".scholaraio-hub"));
  });

  it("uses profile-specific data directories when SCHOLARAIO_HUB_PROFILE is set", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("SCHOLARAIO_HUB_PROFILE", "staging");

    const { currentProfile } = await import("../src/runtime/profile.js");

    expect(currentProfile().dataDir).toBe(path.join(os.homedir(), ".scholaraio-hub-staging"));
  });
});
