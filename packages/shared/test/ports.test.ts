import { describe, expect, it } from "vitest";
import {
  DEFAULT_DEV_PORT,
  resolveLibraryPort,
  resolvePort,
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
    expect(resolvePort({ SCHOLARAIO_HUB_PROFILE: "production" })).toBe(3400);
    expect(resolvePort({ SCHOLARAIO_HUB_PROFILE: "dev" })).toBe(3500);
    expect(resolvePort({ NODE_ENV: "test" })).toBe(3600);
    expect(resolvePort({ SCHOLARAIO_HUB_PROFILE: "demo" })).toBe(DEFAULT_DEV_PORT);
  });

  it("follows the profile rather than NODE_ENV", () => {
    expect(resolvePort({ NODE_ENV: "production", SCHOLARAIO_HUB_PROFILE: "dev" })).toBe(3500);
    expect(resolvePort({ NODE_ENV: "development", SCHOLARAIO_HUB_PROFILE: "production" })).toBe(
      3400,
    );
  });

  it("honors an explicit port without adding an offset", () => {
    expect(resolvePort({ NODE_ENV: "test", PORT: "65535" })).toBe(65535);
  });

  it("puts the library service on the port after the Hub's unless told otherwise", () => {
    expect(resolveLibraryPort({ SCHOLARAIO_HUB_PROFILE: "production" })).toBe(3401);
    expect(resolveLibraryPort({ NODE_ENV: "test" })).toBe(3601);
    expect(resolveLibraryPort({ PORT: "4000" })).toBe(4001);
    expect(resolveLibraryPort({ PORT: "4000", LIBRARY_PORT: "5000" })).toBe(5000);
  });
});
