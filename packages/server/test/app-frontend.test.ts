import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createTestApp } from "./helpers/app.js";
import { offlineLibrary } from "./helpers/library.js";
import { createScriptedProvider } from "./helpers/scriptedProvider.js";

describe("App frontend integration", () => {
  const tempDirs: string[] = [];
  const apps: ReturnType<typeof createTestApp>[] = [];

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

    const server = createTestApp({
      dataDir: distDir,
      frontendDistPath: distDir,
      provider: createScriptedProvider(),
      library: offlineLibrary(),
    });

    apps.push(server);
    const res = await server.app.request("/");
    const html = await res.text();

    expect(res.status).toBe(200);
    expect(html).toContain("client");
    // The browser calls the library service itself, on the port the page names.
    expect(html).toContain(`<meta name="scholaraio-library-port" content="9" />`);
    const direct = await server.app.request("/index.html");
    expect(await direct.text()).toContain("scholaraio-library-port");
  });

  it("no longer relays the library API", async () => {
    const distDir = await mkdtemp(join(tmpdir(), "client-dist-"));
    tempDirs.push(distDir);
    await writeFile(join(distDir, "index.html"), "<!doctype html>", "utf-8");
    const server = createTestApp({
      dataDir: distDir,
      frontendDistPath: distDir,
      provider: createScriptedProvider(),
      library: offlineLibrary(),
    });
    apps.push(server);
    expect((await server.app.request("/api/library/papers")).status).toBe(404);
  });

  it("caches hashed assets for good and never the page", async () => {
    const distDir = await mkdtemp(join(tmpdir(), "client-dist-"));
    tempDirs.push(distDir);
    await writeFile(join(distDir, "index.html"), "<!doctype html><title>client</title>", "utf-8");
    await mkdir(join(distDir, "assets"));
    await writeFile(join(distDir, "assets", "index-BrUm1Kv-.js"), "export {};", "utf-8");
    const server = createTestApp({
      dataDir: distDir,
      frontendDistPath: distDir,
      provider: createScriptedProvider(),
      library: offlineLibrary(),
    });
    apps.push(server);

    const asset = await server.app.request("/assets/index-BrUm1Kv-.js");
    expect(asset.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
    expect(asset.headers.get("content-type")).toContain("javascript");
    // A client route, and a path that tries to leave dist, both get the page.
    for (const url of ["/sessions/abc", "/%2e%2e/%2e%2e/etc/passwd"]) {
      const page = await server.app.request(url);
      expect(await page.text()).toContain("client");
      expect(page.headers.get("cache-control")).toBe("no-cache");
      const policy = page.headers.get("content-security-policy");
      expect(policy).toContain("script-src 'self' 'wasm-unsafe-eval'");
      expect(policy).toContain("frame-ancestors 'self'");
    }
    expect((await server.app.request("/api/nope")).status).toBe(404);
  });
});
