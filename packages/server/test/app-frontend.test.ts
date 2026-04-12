import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { MockClaudeSDK } from "../src/sdk/mock.js";

describe("App frontend integration", () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
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

    const { app } = createApp({
      frontendDistPath: distDir,
      sdk: new MockClaudeSDK(),
    });

    const res = await app.request("/");
    const html = await res.text();

    expect(res.status).toBe(200);
    expect(html).toContain("client");
  });
});
