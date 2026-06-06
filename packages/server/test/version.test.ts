import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it, vi } from "vitest";

async function importVersion() {
  return await import("../src/routes/version.js");
}

async function expectedVersion(): Promise<string> {
  const packageJsonPath = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../package.json",
  );
  const packageJson = JSON.parse(await readFile(packageJsonPath, "utf-8")) as {
    version?: string;
  };
  const version = packageJson.version ?? "0.0.1";
  const gitSha = process.env.GIT_COMMIT_SHA?.trim();
  return gitSha ? `${version}+${gitSha.slice(0, 7)}` : version;
}

describe("GET /version", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("returns the current minimal version payload", async () => {
    const { createVersionRoutes } = await importVersion();
    const routes = createVersionRoutes();
    const version = await expectedVersion();

    const res = await routes.request("/");
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.current).toBe(version);
    expect(json.latest).toBe(version);
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

    expect(info.appVersion).toBe(await expectedVersion());
    expect(info.resumeProtocolVersion).toBeTypeOf("number");
    expect(info.capabilities).toEqual([]);
    expect(info.capabilities).not.toContain("voiceInput");
  });
});
