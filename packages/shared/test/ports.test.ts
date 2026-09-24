import { describe, expect, it } from "vitest";
import {
  DEFAULT_DEV_PORT,
  resolveBasePort,
  resolveDerivedPorts,
  resolveProfileName,
} from "../src/ports.js";

describe("profiles", () => {
  it("names the instance from NODE_ENV when no profile is given", () => {
    expect(resolveProfileName({})).toBe("dev");
    expect(resolveProfileName({ NODE_ENV: "development" })).toBe("dev");
    expect(resolveProfileName({ NODE_ENV: "production" })).toBe("production");
  });

  it("lets an explicit profile choose the instance", () => {
    expect(resolveProfileName({ SCHOLARAIO_HUB_PROFILE: "production" })).toBe("production");
    expect(resolveProfileName({ NODE_ENV: "production", SCHOLARAIO_HUB_PROFILE: "demo" })).toBe(
      "demo",
    );
  });

  it("keeps tests on the test profile whatever else is set", () => {
    expect(resolveProfileName({ NODE_ENV: "test", SCHOLARAIO_HUB_PROFILE: "production" })).toBe(
      "test",
    );
  });
});

describe("ports", () => {
  it("gives each profile its own default port", () => {
    expect(resolveBasePort({ SCHOLARAIO_HUB_PROFILE: "production" })).toBe(3400);
    expect(resolveBasePort({ SCHOLARAIO_HUB_PROFILE: "dev" })).toBe(3500);
    expect(resolveBasePort({ NODE_ENV: "test" })).toBe(3600);
    expect(resolveBasePort({ SCHOLARAIO_HUB_PROFILE: "demo" })).toBe(DEFAULT_DEV_PORT);
  });

  it("follows the profile rather than NODE_ENV", () => {
    expect(resolveBasePort({ NODE_ENV: "production", SCHOLARAIO_HUB_PROFILE: "dev" })).toBe(3500);
    expect(resolveBasePort({ NODE_ENV: "development", SCHOLARAIO_HUB_PROFILE: "production" })).toBe(
      3400,
    );
  });

  it("honors an explicit port without adding an offset", () => {
    expect(resolveBasePort({ NODE_ENV: "test", PORT: "65535" })).toBe(65535);
  });

  it("derives client and preview ports from PORT", () => {
    expect(resolveDerivedPorts({ PORT: "4100" })).toEqual({
      app: 4100,
      client: 4101,
      preview: 4102,
    });
  });

  it("allows explicit client and preview overrides", () => {
    expect(
      resolveDerivedPorts({
        PORT: "4100",
        CLIENT_PORT: "5100",
        CLIENT_PREVIEW_PORT: "6100",
      }),
    ).toEqual({
      app: 4100,
      client: 5100,
      preview: 6100,
    });
  });
});
