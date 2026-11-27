import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { type Server, createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { LibraryClient } from "../../src/lib/LibraryClient.js";
import { createTestApp } from "../helpers/app.js";

describe("same-origin library transport", () => {
  let upstream: Server;
  let baseUrl: string;
  let dataDir: string;
  let server: ReturnType<typeof createTestApp>;
  let streamClosed: boolean;
  let requests: number;

  beforeEach(async () => {
    streamClosed = false;
    requests = 0;
    upstream = createServer(async (req, res) => {
      requests++;
      if (req.url === "/events") {
        res.writeHead(200, { "Content-Type": "text/event-stream" });
        res.write('data: {"type":"papers"}\n\n');
        res.once("close", () => {
          streamClosed = true;
        });
        return;
      }
      if (req.url === "/mcp") {
        res.writeHead(307, { Location: `${baseUrl}/mcp/` });
        res.end();
        return;
      }
      if (req.url === "/mcp/" && req.headers.origin) {
        res.writeHead(403);
        res.end("Browser Origin rejected");
        return;
      }
      if (req.url === "/papers/paper-1/pdf") {
        res.writeHead(206, {
          "Content-Type": "application/pdf",
          "Content-Range": "bytes 0-3/10",
          "Accept-Ranges": "bytes",
          "Content-Disposition": 'attachment; filename="paper.pdf"',
          ETag: '"paper-1"',
        });
        res.end("%PDF");
        return;
      }
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(Buffer.from(chunk));
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          url: req.url,
          method: req.method,
          host: req.headers.host,
          origin: req.headers.origin ?? null,
          contentType: req.headers["content-type"],
          csrf: req.headers["scholaraio-hub"],
          body: Buffer.concat(chunks).toString(),
        }),
      );
    });
    upstream.listen(0, "127.0.0.1");
    await once(upstream, "listening");
    const address = upstream.address();
    if (!address || typeof address === "string") throw new Error("No upstream port");
    baseUrl = `http://127.0.0.1:${address.port}`;
    dataDir = await mkdtemp(join(tmpdir(), "library-proxy-"));
    server = createTestApp({
      dataDir,
      library: new LibraryClient(baseUrl),
      allowedHosts: "hub.example",
    });
    await server.ready;
  });

  afterEach(async () => {
    upstream.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      upstream.close((error) => (error ? reject(error) : resolve())),
    );
    await server.close();
    await rm(dataDir, { recursive: true, force: true });
  });

  it("reads settings through the public origin and preserves queries", async () => {
    const response = await server.app.request(
      "https://hub.example/api/library/settings?view=parser",
      {
        headers: { Host: "hub.example", Origin: "https://hub.example" },
      },
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      url: "/settings?view=parser",
      host: new URL(baseUrl).host,
      origin: null,
    });
  });

  it("saves parser configuration with the existing CSRF protection", async () => {
    const body = JSON.stringify({ mineruEndpoint: "http://host.docker.internal:18000" });
    const response = await server.app.request("/api/library/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json", "ScholarAIO-Hub": "true" },
      body,
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ method: "PATCH", body, csrf: "true" });
    const count = requests;
    const rejected = await server.app.request("/api/library/settings", { method: "PATCH", body });
    expect(rejected.status).toBe(403);
    expect(requests).toBe(count);
  });

  it.each(["/imports", "/documents/import"])(
    "streams multipart uploads to %s without changing their boundary or contents",
    async (resource) => {
      const form = new FormData();
      form.append(
        "file",
        new Blob(["%PDF-local-upload"], { type: "application/pdf" }),
        "paper.pdf",
      );
      const response = await server.app.request(`/api/library${resource}`, {
        method: "POST",
        headers: { "ScholarAIO-Hub": "true" },
        body: form,
      });
      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.contentType).toMatch(/^multipart\/form-data; boundary=/);
      expect(data.body).toContain('filename="paper.pdf"');
      expect(data.body).toContain("%PDF-local-upload");
    },
  );

  it("keeps PDF range responses and download headers intact", async () => {
    const response = await server.app.request("/api/library/papers/paper-1/pdf", {
      headers: { Range: "bytes=0-3" },
    });
    expect(response.status).toBe(206);
    expect(response.headers.get("content-range")).toBe("bytes 0-3/10");
    expect(response.headers.get("etag")).toBe('"paper-1"');
    expect(response.headers.get("content-disposition")).toContain("paper.pdf");
    expect(await response.text()).toBe("%PDF");
  });

  it("permits native MCP requests and keeps the library's browser guard", async () => {
    const native = await server.app.request("/api/library/mcp/", { method: "POST", body: "{}" });
    expect(native.status).toBe(200);
    const browser = await server.app.request("/api/library/mcp/", {
      method: "POST",
      headers: { Origin: "https://hub.example" },
      body: "{}",
    });
    expect(browser.status).toBe(403);
  });

  it("rewrites trailing-slash redirects to the public proxy path", async () => {
    const response = await server.app.request("/api/library/mcp", { method: "POST", body: "{}" });
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("/api/library/mcp/");
  });

  it("delivers SSE immediately and releases the upstream when the reader disconnects", async () => {
    const response = await server.app.request("/api/library/events");
    expect(response.headers.get("x-accel-buffering")).toBe("no");
    const reader = response.body?.getReader();
    if (!reader) throw new Error("Missing event stream");
    try {
      const first = await reader.read();
      expect(new TextDecoder().decode(first.value)).toContain('data: {"type":"papers"}');
    } finally {
      await reader.cancel();
    }
    await expect.poll(() => streamClosed).toBe(true);
  });

  it("rejects unapproved public hosts before contacting the library", async () => {
    const count = requests;
    const response = await server.app.request("/api/library/settings", {
      headers: { Host: "evil.example" },
    });
    expect(response.status).toBe(403);
    expect(requests).toBe(count);
  });
});
