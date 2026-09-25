import { afterEach, describe, expect, it, vi } from "vitest";
import { loadConfig } from "../src/config.js";

/** What the launcher sets for every server it starts. */
function launched(): void {
  vi.stubEnv("SCHOLARAIO_HUB_DATA_DIR", "/srv/hub");
  vi.stubEnv("PORT", "4100");
  vi.stubEnv("LIBRARY_URL", "http://127.0.0.1:4101");
}

describe("loadConfig", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("takes the instance from what the launcher set", () => {
    launched();
    vi.stubEnv("SCHOLARAIO_HUB_PROFILE", "demo");
    vi.stubEnv("SCHOLARAIO_CONFIG", "/srv/hub/config.yaml");
    const config = loadConfig();
    expect(config).toMatchObject({
      profile: "demo",
      dataDir: "/srv/hub",
      port: 4100,
      libraryUrl: "http://127.0.0.1:4101",
      skillsDir: "/srv/hub/skills",
      agentLibrary: { configFile: "/srv/hub/config.yaml" },
    });
    expect(Object.isFrozen(config)).toBe(true);
  });

  it("refuses to start without the launcher's variables", () => {
    launched();
    vi.stubEnv("LIBRARY_URL", undefined);
    expect(() => loadConfig()).toThrow("LIBRARY_URL");
  });

  it("keeps CLI directories out of application configuration", () => {
    launched();
    expect(loadConfig()).not.toHaveProperty("codexSessionsDir");
    expect(loadConfig()).not.toHaveProperty("claudeProjectsDir");
  });
});
