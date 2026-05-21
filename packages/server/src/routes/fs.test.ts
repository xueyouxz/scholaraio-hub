import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type FsBrowseResponse, createFsRoutes } from "./fs.js";

function makeClient() {
  const app = new Hono();
  app.route("/hub/fs", createFsRoutes());
  return app;
}

describe("GET /hub/fs/browse", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "fs-test-"));
    await mkdir(join(tmpDir, "subdir-a"));
    await mkdir(join(tmpDir, "subdir-b"));
    await mkdir(join(tmpDir, ".hidden"));
    await writeFile(join(tmpDir, "file.txt"), "data");
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("returns directories but not files or hidden dirs", async () => {
    const app = await makeClient();
    const res = await app.request(`/hub/fs/browse?path=${encodeURIComponent(tmpDir)}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as FsBrowseResponse;
    expect(body.path).toBe(tmpDir);
    const names = body.entries.map((e) => e.name);
    expect(names).toContain("subdir-a");
    expect(names).toContain("subdir-b");
    expect(names).not.toContain(".hidden");
    expect(names).not.toContain("file.txt");
  });

  it("returns 404 for non-existent path", async () => {
    const app = await makeClient();
    const res = await app.request(
      `/hub/fs/browse?path=${encodeURIComponent(`${tmpDir}/does-not-exist`)}`,
    );
    expect(res.status).toBe(404);
  });

  it("returns 400 for non-directory path", async () => {
    const app = await makeClient();
    const res = await app.request(
      `/hub/fs/browse?path=${encodeURIComponent(join(tmpDir, "file.txt"))}`,
    );
    expect(res.status).toBe(400);
  });

  it("rejects path traversal attempt", async () => {
    const app = await makeClient();
    const res = await app.request("/hub/fs/browse?path=/tmp/../etc");
    expect(res.status).toBe(400);
  });

  it("rejects hidden path components", async () => {
    const app = await makeClient();
    const res = await app.request(
      `/hub/fs/browse?path=${encodeURIComponent(join(tmpDir, ".hidden"))}`,
    );
    expect(res.status).toBe(400);
  });

  it("entries are sorted alphabetically", async () => {
    const app = await makeClient();
    const res = await app.request(`/hub/fs/browse?path=${encodeURIComponent(tmpDir)}`);
    const body = (await res.json()) as FsBrowseResponse;
    const names = body.entries.map((e) => e.name);
    expect(names).toEqual([...names].sort());
  });
});
