import { describe, expect, it } from "vitest";
import { DEFAULT_PORT, resolveBasePort, resolveDerivedPorts } from "../src/ports.js";

describe("ports", () => {
  it("separates development from production ports", () => {
    expect(resolveDerivedPorts({ NODE_ENV: "development" }).app).toBe(3500);
    expect(resolveDerivedPorts({ NODE_ENV: "production" }).app).toBe(3400);
  });
  it("uses 3400 as the default base port", () => {
    expect(resolveBasePort({})).toBe(DEFAULT_PORT);
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
