import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

describe("loadConfig codex paths", () => {
  it("isolates tests from profile and home data", async () => {
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("SCHOLARAIO_HUB_PROFILE", "production");
    const { getDataDir } = await import("../src/config.js");
    expect(getDataDir()).toContain("scholaraio-hub-test-");
    expect(getDataDir()).not.toContain(os.homedir());
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("uses CODEX_HOME/sessions when CODEX_SESSIONS_DIR is unset", async () => {
    vi.stubEnv("CODEX_HOME", "/tmp/custom-codex-home");

    const { loadConfig } = await import("../src/config.js");
    const config = loadConfig();

    expect(config.codexSessionsDir).toBe("/tmp/custom-codex-home/sessions");
  });

  it("prefers CODEX_SESSIONS_DIR over CODEX_HOME", async () => {
    vi.stubEnv("CODEX_HOME", "/tmp/custom-codex-home");
    vi.stubEnv("CODEX_SESSIONS_DIR", "/tmp/explicit-codex-sessions");

    const { loadConfig } = await import("../src/config.js");
    const config = loadConfig();

    expect(config.codexSessionsDir).toBe("/tmp/explicit-codex-sessions");
  });

  it("falls back to ~/.codex/sessions when neither env var is set", async () => {
    const { loadConfig } = await import("../src/config.js");
    const config = loadConfig();

    expect(config.codexSessionsDir).toBe(path.join(os.homedir(), ".codex", "sessions"));
  });

  it("uses ~/.scholaraio-hub-dev outside production by default", async () => {
    vi.stubEnv("NODE_ENV", "development");

    const { getDataDir } = await import("../src/config.js");

    expect(getDataDir()).toBe(path.join(os.homedir(), ".scholaraio-hub-dev"));
  });

  it("uses ~/.scholaraio-hub in production", async () => {
    vi.stubEnv("NODE_ENV", "production");

    const { getDataDir } = await import("../src/config.js");

    expect(getDataDir()).toBe(path.join(os.homedir(), ".scholaraio-hub"));
  });

  it("uses profile-specific data directories when SCHOLARAIO_HUB_PROFILE is set", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("SCHOLARAIO_HUB_PROFILE", "staging");

    const { getDataDir } = await import("../src/config.js");

    expect(getDataDir()).toBe(path.join(os.homedir(), ".scholaraio-hub-staging"));
  });
});
