import { beforeEach, describe, expect, it, vi } from "vitest";

async function importVersion() {
  return await import("../src/routes/version.js");
}

describe("GET /version", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("returns the current minimal version payload", async () => {
    const { createVersionRoutes } = await importVersion();
    const routes = createVersionRoutes();

    const res = await routes.request("/");
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.current).toBe("0.0.1");
    expect(json.latest).toBe("0.0.1");
    expect(json.updateAvailable).toBe(false);
    expect(json.resumeProtocolVersion).toBeTypeOf("number");
    expect(json.capabilities).toContain("voiceInput");
  });

  it("omits voiceInput capability when disabled", async () => {
    const { createVersionRoutes } = await importVersion();
    const routes = createVersionRoutes({ voiceInputEnabled: false });

    const res = await routes.request("/");
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.capabilities).toEqual([]);
    expect(json.capabilities).not.toContain("voiceInput");
  });

  it("returns compatibility info consistent with route capabilities", async () => {
    const { getServerCompatibilityInfo } = await importVersion();

    const info = await getServerCompatibilityInfo({ voiceInputEnabled: false });

    expect(info.appVersion).toBe("0.0.1");
    expect(info.resumeProtocolVersion).toBeTypeOf("number");
    expect(info.capabilities).toEqual([]);
    expect(info.capabilities).not.toContain("voiceInput");
  });
});
