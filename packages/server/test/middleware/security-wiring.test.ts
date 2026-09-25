import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../../src/app.js";
import { createScriptedProvider } from "../helpers/scriptedProvider.js";

describe("workbench security middleware wiring", () => {
  let root: string;
  let server: ReturnType<typeof createApp>;
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "hub-security-"));
    server = createApp({ dataDir: root, provider: createScriptedProvider() });
    await server.ready;
  });
  afterEach(async () => {
    await server.close();
    await rm(root, { recursive: true, force: true });
  });
  it("rejects DNS rebinding on the library and session APIs", async () => {
    for (const url of ["/api/library/papers", "/api/sessions"]) {
      expect((await server.app.request(url, { headers: { host: "evil.com" } })).status).toBe(403);
    }
  });
  it("requires the application header for writes", async () => {
    const request = {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ provider: "claude" }),
    };
    expect((await server.app.request("/api/sessions", request)).status).toBe(403);
    expect(
      (
        await server.app.request("/api/sessions", {
          ...request,
          headers: { ...request.headers, "ScholarAIO-Hub": "true" },
        })
      ).status,
    ).toBe(201);
  });
  it("allows reads without the write header and removes arbitrary filesystem access", async () => {
    expect((await server.app.request("/api/sessions")).status).toBe(200);
    expect((await server.app.request("/hub/fs/browse?path=/tmp")).status).toBe(404);
  });
});
