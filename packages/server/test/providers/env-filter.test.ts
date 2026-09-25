import { describe, expect, it } from "vitest";
import { HUB_ENV_KEYS } from "../../src/env.js";
import { filterEnvForChildProcess } from "../../src/providers/agent-env.js";

describe("filterEnvForChildProcess", () => {
  it("keeps every variable the Hub reads away from an agent", () => {
    const hubEnv = Object.fromEntries(HUB_ENV_KEYS.map((key) => [key, "hub"]));
    const filtered = filterEnvForChildProcess({ ...hubEnv, PATH: "/usr/bin" });
    expect(filtered).toEqual({ PATH: "/usr/bin" });
  });

  it("passes the user's own variables through", () => {
    const filtered = filterEnvForChildProcess({
      HOME: "/home/me",
      LOG_FORMAT: "json",
      MY_PROJECT_TOKEN: "t",
      npm_config_cache: "/tmp",
      SCHOLARAIO_HUB_API: "http://127.0.0.1:3400",
    });
    expect(filtered).toEqual({ HOME: "/home/me", LOG_FORMAT: "json", MY_PROJECT_TOKEN: "t" });
  });
});
