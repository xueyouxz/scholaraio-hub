import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { hostCheck, isAllowedHost, parseAllowedHosts } from "../../src/middleware/security.js";

describe("host check", () => {
  const loopback = parseAllowedHosts(undefined);

  it("allows the loopback names, with or without a port", () => {
    for (const host of ["localhost", "127.0.0.1", "LOCALHOST:3400", "[::1]", "[::1]:3400"]) {
      expect(isAllowedHost(host, loopback)).toBe(true);
    }
  });

  it("rejects every other host, including LAN and tunnel names", () => {
    for (const host of ["evil.com", "localhost.evil.com", "192.168.1.1", "box.ts.net", "[::1"]) {
      expect(isAllowedHost(host, loopback)).toBe(false);
    }
  });

  it("allows a request without a Host header", () => {
    expect(isAllowedHost(undefined, loopback)).toBe(true);
  });

  it("adds ALLOWED_HOSTS entries, trimmed and case-insensitive", () => {
    const allowed = parseAllowedHosts(" Hub.Local , my.dev ,");
    expect(isAllowedHost("hub.local:3400", allowed)).toBe(true);
    expect(isAllowedHost("MY.DEV", allowed)).toBe(true);
    expect(isAllowedHost("localhost", allowed)).toBe(true);
    expect(isAllowedHost("other.dev", allowed)).toBe(false);
  });

  it("turns the check off for ALLOWED_HOSTS=*", () => {
    expect(isAllowedHost("anything.example", parseAllowedHosts("*"))).toBe(true);
  });

  it("answers a rejected host with 403", async () => {
    const app = new Hono();
    app.use("*", hostCheck(loopback));
    app.get("/", (c) => c.text("ok"));
    expect((await app.request("/", { headers: { host: "evil.com" } })).status).toBe(403);
    expect((await app.request("/", { headers: { host: "localhost:3400" } })).status).toBe(200);
  });
});
