import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { createScriptedProvider } from "./helpers/scriptedProvider.js";

describe("App frontend integration", () => {
  const tempDirs: string[] = [];
  const apps: ReturnType<typeof createApp>[] = [];

  afterEach(async () => {
    for (const server of apps) {
      await server.ready;
      await server.close();
    }
    apps.length = 0;
    await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })));
    tempDirs.length = 0;
  });

  it("serves client index from root when frontend dist path is configured", async () => {
    const distDir = await mkdtemp(join(tmpdir(), "client-dist-"));
    tempDirs.push(distDir);
    await writeFile(
      join(distDir, "index.html"),
      "<!doctype html><html><body><div id='app'>client</div></body></html>",
      "utf-8",
    );

    const server = createApp({
      dataDir: distDir,
      frontendDistPath: distDir,
      provider: createScriptedProvider(),
    });

    apps.push(server);
    const res = await server.app.request("/");
    const html = await res.text();

    expect(res.status).toBe(200);
    expect(html).toContain("client");
  });
});
