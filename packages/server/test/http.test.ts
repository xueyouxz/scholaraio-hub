import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MAX_ATTACHMENT_BYTES } from "../src/sessions/SessionAttachments.js";
import { WorkbenchProvider } from "./helpers/WorkbenchProvider.js";
import { createTestApp } from "./helpers/app.js";
import { offlineLibrary } from "./helpers/library.js";

const HEADERS = { "Content-Type": "application/json", "ScholarAIO-Hub": "true" };

describe("统一 HTTP 契约", () => {
  let root: string;
  let server: ReturnType<typeof createTestApp>;
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "hub-http-"));
    server = createTestApp({
      dataDir: root,
      library: offlineLibrary(),
      provider: new WorkbenchProvider("claude"),
    });
    await server.ready;
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    await server.close();
    await rm(root, { recursive: true, force: true });
  });

  it("创建响应关联请求标识，资源地址指向业务 ID", async () => {
    const response = await server.app.request("/api/sessions", {
      method: "POST",
      headers: HEADERS,
      body: "{}",
    });
    const body = await response.json();
    expect(response.status).toBe(201);
    expect(Object.keys(body).sort()).toEqual(["code", "data", "id", "message"]);
    expect(body.code).toBe("success");
    expect(body.message).toBe("success");
    expect(body.id).toBe(response.headers.get("X-Request-ID"));
    expect(body.id).not.toBe(body.data.id);
    expect(response.headers.get("Location")).toBe(`/api/sessions/${body.data.id}`);
    const next = await server.app.request("/api/sessions");
    expect(next.headers.get("X-Request-ID")).not.toBe(body.id);
    expect(await next.json()).toMatchObject({ code: "success", message: "success" });
    const stream = await server.app.request(`/api/sessions/${body.data.id}/stream`);
    expect(stream.status).toBe(204);
    expect(await stream.text()).toBe("");
    expect(stream.headers.get("X-Request-ID")).toBeTruthy();
  });

  it.each([
    ["{", "application/json", 400, "INVALID_JSON"],
    ['{"provider":"unknown"}', "application/json", 422, "VALIDATION_FAILED"],
    ["{}", "text/plain", 415, "UNSUPPORTED_MEDIA_TYPE"],
  ])("区分 JSON、字段及媒体类型错误：%s", async (body, contentType, status, code) => {
    const response = await server.app.request("/api/sessions", {
      method: "POST",
      headers: { ...HEADERS, "Content-Type": contentType },
      body,
    });
    const payload = await response.json();
    expect(response.status).toBe(status);
    expect(payload.code).toBe(code);
    expect(payload.id).toBe(response.headers.get("X-Request-ID"));
    if (code === "VALIDATION_FAILED")
      expect(payload.data.issues[0]).toMatchObject({ location: "body", path: ["provider"] });
    expect(server.sessions.store.list()).toHaveLength(0);
  });

  it("无请求体的操作接受空流且不要求媒体类型", async () => {
    const stop = vi.spyOn(server.sessions, "stop").mockResolvedValue();
    const response = await server.app.request("/api/sessions/example/stop", {
      method: "POST",
      headers: { "ScholarAIO-Hub": "true", "Content-Length": "0" },
      body: "",
    });
    expect(response.status).toBe(200);
    expect((await response.json()).data).toEqual({ stopped: true });
    expect(stop).toHaveBeenCalledWith("example");
  });

  it("fork 不将损坏 JSON 当作空请求体，也不执行分叉", async () => {
    const fork = vi.spyOn(server.sessions, "fork");
    const malformed = await server.app.request("/api/sessions/unknown/fork", {
      method: "POST",
      headers: HEADERS,
      body: "{",
    });
    expect(malformed.status).toBe(400);
    expect((await malformed.json()).code).toBe("INVALID_JSON");
    expect(fork).not.toHaveBeenCalled();
    const empty = await server.app.request("/api/sessions/unknown/fork", {
      method: "POST",
      headers: HEADERS,
    });
    expect(empty.status).toBe(404);
    expect(fork).toHaveBeenCalledWith("unknown", undefined);
  });

  it("统一安全拒绝、未知路径、方法错误和上传限制", async () => {
    const refused = await server.app.request("/api/sessions", {
      headers: { host: "attacker.example" },
    });
    expect((await refused.json()).code).toBe("HOST_NOT_ALLOWED");
    const csrf = await server.app.request("/api/sessions", { method: "POST" });
    expect((await csrf.json()).code).toBe("CSRF_REJECTED");
    const missing = await server.app.request("/api/unknown");
    expect(missing.status).toBe(404);
    expect((await missing.json()).code).toBe("ROUTE_NOT_FOUND");
    const method = await server.app.request("/api/status", { method: "DELETE", headers: HEADERS });
    expect(method.status).toBe(405);
    expect(method.headers.get("Allow")).toBe("GET, HEAD");
    expect((await method.json()).code).toBe("METHOD_NOT_ALLOWED");
    const large = await server.app.request("/api/sessions/draft-attachments", {
      method: "POST",
      headers: {
        ...HEADERS,
        "Content-Type": "multipart/form-data; boundary=x",
        "Content-Length": String(MAX_ATTACHMENT_BYTES + 65537),
      },
      body: "x",
    });
    expect(large.status).toBe(413);
    expect((await large.json()).code).toBe("PAYLOAD_TOO_LARGE");
  });

  it("附件超过大小限制与文件缺失返回不同的错误码", async () => {
    const form = new FormData();
    form.set("file", new File([new Uint8Array(MAX_ATTACHMENT_BYTES + 1)], "large.bin"));
    const tooLarge = await server.app.request("/api/sessions/draft-attachments", {
      method: "POST",
      headers: { "ScholarAIO-Hub": "true" },
      body: form,
    });
    expect(tooLarge.status).toBe(413);
    expect((await tooLarge.json()).code).toBe("PAYLOAD_TOO_LARGE");
    const created = await server.app.request("/api/sessions", {
      method: "POST",
      headers: HEADERS,
      body: "{}",
    });
    const session = (await created.json()).data;
    const missing = await server.app.request(
      `/api/sessions/${session.id}/fs/file?path=missing.txt`,
    );
    expect(missing.status).toBe(404);
    expect((await missing.json()).code).toBe("RESOURCE_NOT_FOUND");
  });

  it("内部解析错误保持 500，审批失效返回独立业务码", async () => {
    vi.spyOn(server.sessions.store, "list").mockImplementation(() => {
      throw new SyntaxError("private storage detail");
    });
    const failed = await server.app.request("/api/sessions");
    expect(failed.status).toBe(500);
    expect((await failed.json()).message).not.toContain("private storage detail");
    const approval = await server.app.request("/api/sessions/unknown/input", {
      method: "POST",
      headers: HEADERS,
      body: JSON.stringify({ requestId: "expired", decision: "approve" }),
    });
    expect(approval.status).toBe(409);
    expect((await approval.json()).code).toBe("APPROVAL_EXPIRED");
  });
});
