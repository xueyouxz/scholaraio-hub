import { afterEach, describe, expect, it, vi } from "vitest";
import { createScholarRoutes, normalizeScholarProxyPath } from "../../src/routes/scholar.js";

describe("Scholar routes", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("maps legacy /api paths to ScholarAIO /api/v1", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true })));
    vi.stubGlobal("fetch", fetchMock);
    const routes = createScholarRoutes({ scholarAioApiUrl: "http://127.0.0.1:8765/" });

    const response = await routes.request("/api/scholar/api/papers?limit=1");

    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:8765/api/v1/papers?limit=1",
      expect.objectContaining({ method: "GET" }),
    );
  });

  it("preserves explicit /api/v1 paths", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true })));
    vi.stubGlobal("fetch", fetchMock);
    const routes = createScholarRoutes({ scholarAioApiUrl: "http://127.0.0.1:8765" });

    await routes.request("/api/scholar/api/v1/health");

    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:8765/api/v1/health",
      expect.objectContaining({ method: "GET" }),
    );
  });

  it("forwards JSON bodies to the normalized endpoint", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true })));
    vi.stubGlobal("fetch", fetchMock);
    const routes = createScholarRoutes({ scholarAioApiUrl: "http://127.0.0.1:8765" });

    await routes.request("/api/scholar/api/search", {
      method: "POST",
      body: JSON.stringify({ query: "turbulence" }),
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:8765/api/v1/search",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ query: "turbulence" }),
      }),
    );
  });

  it("normalizes route paths without requiring a Hono context", () => {
    expect(normalizeScholarProxyPath("/api/scholar/api")).toBe("/api/v1");
    expect(normalizeScholarProxyPath("/api/scholar/api/papers")).toBe("/api/v1/papers");
    expect(normalizeScholarProxyPath("/api/scholar/api/jobs")).toBe("/api/v1/jobs");
    expect(normalizeScholarProxyPath("/api/scholar/api/v1/papers")).toBe("/api/v1/papers");
    expect(normalizeScholarProxyPath("/api/scholar/v1/papers")).toBe("/api/v1/papers");
  });
});
