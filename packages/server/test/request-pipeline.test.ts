import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Writable } from "node:stream";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { initLogger } from "../src/logging/logger.js";
import { WorkbenchProvider } from "./helpers/WorkbenchProvider.js";
import { createTestApp } from "./helpers/app.js";
import { offlineLibrary } from "./helpers/library.js";

const HEADERS = { "Content-Type": "application/json", "ScholarAIO-Hub": "true" };

describe("请求链路", () => {
  let root: string;
  let server: ReturnType<typeof createTestApp>;
  let lines: Record<string, unknown>[];

  beforeEach(async () => {
    lines = [];
    initLogger(
      { consoleLevel: "debug" },
      new Writable({
        write(chunk, _encoding, done) {
          lines.push(JSON.parse(String(chunk)));
          done();
        },
      }),
    );
    root = await mkdtemp(join(tmpdir(), "hub-pipeline-"));
    server = createTestApp({
      dataDir: root,
      library: offlineLibrary(),
      provider: new WorkbenchProvider("claude"),
    });
    await server.ready;
  });

  afterEach(async () => {
    await server.close();
    await rm(root, { recursive: true, force: true });
    initLogger();
  });

  it("给接口响应加上安全响应头，本机 HTTP 不发 HSTS", async () => {
    const response = await server.app.request("/api/projects");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("cross-origin-resource-policy")).toBe("same-origin");
    expect(response.headers.get("x-frame-options")).toBe("SAMEORIGIN");
    expect(response.headers.get("strict-transport-security")).toBeNull();
  });

  it("每个请求记一条访问日志，带与响应头一致的请求标识", async () => {
    const response = await server.app.request("/api/sessions", {
      method: "POST",
      headers: HEADERS,
      body: JSON.stringify({ message: { id: "first", text: "hello" } }),
    });
    const requestId = response.headers.get("x-request-id");
    const access = lines.find((line) => line.msg === "Request" && line.method === "POST");
    expect(access).toMatchObject({
      component: "api",
      requestId,
      path: "/api/sessions",
      status: 201,
      level: 30,
    });
    expect(typeof access?.durationMs).toBe("number");
  });

  it("成功的读取只记 debug，失败的请求记 info，并与拒绝原因共用请求标识", async () => {
    await server.app.request("/api/projects");
    const missing = await server.app.request("/api/sessions/nope");
    const requestId = missing.headers.get("x-request-id");
    const reads = lines.filter((line) => line.msg === "Request" && line.path === "/api/projects");
    expect(reads.map((line) => line.level)).toEqual([20]);
    const rejected = lines.filter((line) => line.requestId === requestId);
    expect(rejected.map((line) => line.msg).sort()).toEqual(["Request", "Request rejected"]);
    expect(rejected.find((line) => line.msg === "Request")).toMatchObject({
      status: 404,
      level: 30,
    });
  });
});
