import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { pythonRuntime } from "../../src/runtime/python.js";
import { LibraryService } from "../../src/services/LibraryService.js";

/**
 * A stand-in for the Python service: it announces a port, answers /health,
 * logs a WARNING record on stderr, and exits when asked to /crash.
 */
const FAKE_SERVICE = `#!/usr/bin/env node
const http = require("node:http");
const server = http.createServer((request, response) => {
  if (request.url === "/crash") process.exit(3);
  response.setHeader("content-type", "application/json");
  response.end(JSON.stringify({ status: "ok", pid: process.pid }));
});
server.listen(0, "127.0.0.1", () => {
  console.log(JSON.stringify({ port: server.address().port }));
  console.error("WARNING\\tscholaraio: started");
});
process.stdin.on("end", () => process.exit(0));
process.stdin.resume();
`;

describe("LibraryService", () => {
  let root: string;
  let library: LibraryService;
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "hub-library-"));
    const runtime = pythonRuntime(root);
    await mkdir(runtime.binDir, { recursive: true });
    await writeFile(runtime.executable, FAKE_SERVICE);
    await chmod(runtime.executable, 0o755);
    library = new LibraryService(root);
  });
  afterEach(async () => {
    await library.close();
    await rm(root, { recursive: true, force: true });
  });

  it("starts a service that exited on its own again", async () => {
    await library.start();
    const first = await library.json<{ pid: number }>("/health");
    await library.request("/crash").catch(() => undefined);
    await expect.poll(() => library.available, { timeout: 5000 }).toBe(false);
    await expect.poll(() => library.available, { timeout: 5000 }).toBe(true);
    const second = await library.json<{ pid: number }>("/health");
    expect(second.pid).not.toBe(first.pid);
  });

  it("does not restart a service its owner stopped", async () => {
    await library.start();
    await library.close();
    await new Promise((resolve) => setTimeout(resolve, 1500));
    expect(library.available).toBe(false);
  });
});
