import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { type AddressInfo, createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { LibraryProcess, RESTART_EXIT_CODE } from "../src/library-process.js";

/**
 * A stand-in for the Python service: it listens on the port it is given,
 * answers /health with its pid, exits when asked to /crash or /restart, and
 * exits when its stdin pipe closes, as `--watch-stdin` does.
 */
const FAKE_SERVICE = `#!/usr/bin/env node
const http = require("node:http");
const port = Number(process.argv[process.argv.indexOf("--port") + 1]);
if (process.argv.includes("--fail")) process.exit(2);
const server = http.createServer((request, response) => {
  if (request.url === "/crash") process.exit(3);
  if (request.url === "/restart") process.exit(${RESTART_EXIT_CODE});
  response.setHeader("content-type", "application/json");
  response.end(JSON.stringify({ status: "ok", pid: process.pid }));
});
server.listen(port, "127.0.0.1");
process.stdin.on("end", () => process.exit(0));
process.stdin.resume();
`;

function freePort(): Promise<number> {
  return new Promise((resolve) => {
    const probe = createServer().listen(0, "127.0.0.1", () => {
      const { port } = probe.address() as AddressInfo;
      probe.close(() => resolve(port));
    });
  });
}

describe("LibraryProcess", () => {
  let root: string;
  let executable: string;
  let library: LibraryProcess;
  const logged: string[] = [];

  async function pid(): Promise<number> {
    const response = await fetch(`${library.url}/health`);
    return ((await response.json()) as { pid: number }).pid;
  }

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "hub-library-"));
    executable = join(root, "fake-python");
    await writeFile(executable, FAKE_SERVICE);
    await chmod(executable, 0o755);
    library = new LibraryProcess(
      { dataDir: root, host: "127.0.0.1", port: await freePort(), hubPort: 1, executable },
      (message) => logged.push(message),
    );
  });
  afterEach(async () => {
    await library.stop();
    await rm(root, { recursive: true, force: true });
  });

  it("answers once started, and stops when its pipe closes", async () => {
    await library.start();
    expect(await pid()).toBeGreaterThan(0);
    await library.stop();
    await expect(fetch(`${library.url}/health`)).rejects.toThrow();
  });

  it("starts a service that exited on its own again", async () => {
    await library.start();
    const first = await pid();
    await fetch(`${library.url}/crash`).catch(() => undefined);
    await expect.poll(() => pid().catch(() => first), { timeout: 5000 }).not.toBe(first);
    expect(logged.some((line) => line.includes("正在重启"))).toBe(true);
  });

  it("restarts a service that asks for it without counting it as a crash", async () => {
    await library.start();
    let previous = await pid();
    // More requested restarts than crashes are allowed: none of them counts.
    for (let round = 0; round < 4; round += 1) {
      await fetch(`${library.url}/restart`).catch(() => undefined);
      await expect.poll(() => pid().catch(() => previous), { timeout: 5000 }).not.toBe(previous);
      previous = await pid();
    }
    expect(logged.filter((line) => line.includes("请求重启"))).toHaveLength(4);
  });

  it("fails the start when the service exits before answering", async () => {
    // The fake exits at once when its arguments name "--fail".
    const failing = new LibraryProcess(
      {
        dataDir: root,
        host: "127.0.0.1",
        port: await freePort(),
        hubPort: 1,
        executable,
        allowedHosts: "--fail",
      },
      () => undefined,
    );
    await expect(failing.start()).rejects.toThrow("文献服务启动失败");
    await failing.stop();
  });
});
