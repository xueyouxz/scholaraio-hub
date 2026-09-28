import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CSRF_HEADER } from "@scholaraio-hub/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ProviderRegistry } from "../../src/providers/ProviderRegistry.js";
import { WorkbenchProvider } from "../helpers/WorkbenchProvider.js";
import { createTestApp } from "../helpers/app.js";
import { offlineLibrary } from "../helpers/library.js";

const headers = { "content-type": "application/json", [CSRF_HEADER.name]: CSRF_HEADER.value };

describe("ENABLED_PROVIDERS", () => {
  let root: string;
  let server: ReturnType<typeof createTestApp>;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "hub-enabled-providers-"));
    // Only Codex is enabled on this Hub.
    server = createTestApp({
      dataDir: root,
      library: offlineLibrary(),
      provider: new WorkbenchProvider("codex"),
    });
    await server.ready;
  });

  afterEach(async () => {
    await server.close();
    await rm(root, { recursive: true, force: true });
  });

  const create = (body: object) =>
    server.app.request("/api/sessions", {
      method: "POST",
      headers,
      body: JSON.stringify({ message: { id: crypto.randomUUID(), text: "hello" }, ...body }),
    });

  it("lists only the enabled providers", async () => {
    const body = await (await server.app.request("/api/providers")).json();
    expect(body.data.providers.map((provider: { name: string }) => provider.name)).toEqual([
      "codex",
    ]);
  });

  it("starts a session without a provider on the first enabled one", async () => {
    const response = await create({});
    expect(response.status).toBe(201);
    expect((await response.json()).data.provider).toBe("codex");
  });

  it("refuses a new session on a provider that is not enabled", async () => {
    const response = await create({ provider: "claude" });
    expect(response.status).toBe(422);
    expect((await response.json()).message).toContain("claude");
  });

  it("does not run a session whose provider was disabled since", async () => {
    const { id } = (await (await create({})).json()).data;
    await expect.poll(async () => (await server.sessions.detail(id)).state).toBe("idle");
    await server.close();
    server = createTestApp({
      dataDir: root,
      library: offlineLibrary(),
      provider: new WorkbenchProvider("claude"),
    });
    await server.ready;
    const response = await server.app.request(`/api/sessions/${encodeURIComponent(id)}/messages`, {
      method: "POST",
      headers,
      body: JSON.stringify({ id: "m1", text: "hello" }),
    });
    expect(response.status).toBe(409);
  });

  it("refuses the commands of a provider that is not enabled", async () => {
    const response = await server.app.request("/api/sessions/commands?provider=claude");
    expect(response.status).toBe(422);
  });
});

describe("ProviderRegistry", () => {
  it("builds only the providers ENABLED_PROVIDERS names, in that order", () => {
    const registry = ProviderRegistry.create({ enabled: ["codex", "claude"] });
    expect(registry.list().map((provider) => provider.name)).toEqual(["codex", "claude"]);
    expect(registry.defaultProvider.name).toBe("claude");
  });

  it("refuses to run with nothing enabled", () => {
    expect(() => new ProviderRegistry([])).toThrow();
  });
});
