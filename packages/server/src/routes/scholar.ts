import { Hono } from "hono";
import { getLogger } from "../logging/logger.js";

export const SCHOLAR_PROXY_TIMEOUT_MS = 30_000;

export function normalizeScholarProxyPath(path: string): string {
  const stripped = path.replace(/^\/api\/scholar/, "") || "/";
  if (stripped === "/api" || stripped === "/api/") {
    return "/api/v1";
  }
  if (stripped.startsWith("/api/v1")) {
    return stripped;
  }
  if (stripped.startsWith("/api/")) {
    return `/api/v1/${stripped.slice("/api/".length)}`;
  }
  if (stripped === "/v1" || stripped.startsWith("/v1/")) {
    return `/api${stripped}`;
  }
  return stripped;
}

export function createScholarRoutes({ scholarAioApiUrl }: { scholarAioApiUrl: string }) {
  const app = new Hono();
  const targetBase = scholarAioApiUrl.replace(/\/+$/, "");
  const log = getLogger().child({ component: "scholar-proxy" });

  app.all("/*", async (c) => {
    const requestUrl = new URL(c.req.url);
    const path = normalizeScholarProxyPath(c.req.path);
    const url = `${targetBase}${path}${requestUrl.search}`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), SCHOLAR_PROXY_TIMEOUT_MS);

    const headers = new Headers();
    const accept = c.req.header("accept");
    const contentType = c.req.header("content-type");
    if (accept) headers.set("accept", accept);
    if (contentType) headers.set("content-type", contentType);

    const init: RequestInit = {
      method: c.req.method,
      headers,
      signal: controller.signal,
    };

    if (c.req.method !== "GET" && c.req.method !== "HEAD") {
      if (!headers.has("content-type")) {
        headers.set("content-type", "application/json");
      }
      init.body = await c.req.text();
    }

    let res: Response;
    try {
      res = await fetch(url, init);
    } catch (error) {
      const isAbort = error instanceof Error && error.name === "AbortError";
      log.warn(
        { event: "scholar_proxy_request_failed", url, error, timeout: isAbort },
        "ScholarAIO proxy request failed",
      );
      if (isAbort) {
        return c.json({ error: "ScholarAIO API request timed out" }, 504);
      }
      return c.json({ error: "ScholarAIO API unavailable. Run: scholaraio serve" }, 503);
    } finally {
      clearTimeout(timeout);
    }

    return new Response(res.body, {
      status: res.status,
      headers: { "content-type": res.headers.get("content-type") ?? "application/json" },
    });
  });

  return app;
}
