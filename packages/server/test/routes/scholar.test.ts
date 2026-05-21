import { afterEach, describe, expect, it, vi } from "vitest";
import {
  SCHOLAR_PROXY_TIMEOUT_MS,
  createScholarRoutes,
  normalizeScholarProxyPath,
} from "../../src/routes/scholar.js";

describe("Scholar routes", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
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

  it("returns 503 when the upstream ScholarAIO API is unavailable", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("connect ECONNREFUSED");
      }),
    );
    const routes = createScholarRoutes({ scholarAioApiUrl: "http://127.0.0.1:8765" });

    const response = await routes.request("/api/scholar/api/health");

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: "ScholarAIO API unavailable. Run: scholaraio serve",
    });
  });

  it("returns 504 when the upstream ScholarAIO API times out", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn((_url: string, init?: RequestInit) => {
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          reject(new DOMException("The operation was aborted", "AbortError"));
        });
      });
    });
    vi.stubGlobal("fetch", fetchMock);
    const routes = createScholarRoutes({ scholarAioApiUrl: "http://127.0.0.1:8765" });

    const responsePromise = routes.request("/api/scholar/api/health");
    await vi.advanceTimersByTimeAsync(SCHOLAR_PROXY_TIMEOUT_MS);
    const response = await responsePromise;

    expect(response.status).toBe(504);
    await expect(response.json()).resolves.toEqual({
      error: "ScholarAIO API request timed out",
    });
  });

  it("normalizes route paths without requiring a Hono context", () => {
    expect(normalizeScholarProxyPath("/api/scholar/api")).toBe("/api/v1");
    expect(normalizeScholarProxyPath("/api/scholar/api/papers")).toBe("/api/v1/papers");
    expect(normalizeScholarProxyPath("/api/scholar/api/jobs")).toBe("/api/v1/jobs");
    expect(normalizeScholarProxyPath("/api/scholar/api/v1/papers")).toBe("/api/v1/papers");
    expect(normalizeScholarProxyPath("/api/scholar/v1/papers")).toBe("/api/v1/papers");
  });
});
