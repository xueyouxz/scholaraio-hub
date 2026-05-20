import { Hono } from "hono";

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

  app.all("/*", async (c) => {
    const requestUrl = new URL(c.req.url);
    const path = normalizeScholarProxyPath(c.req.path);
    const url = `${targetBase}${path}${requestUrl.search}`;

    const init: RequestInit = {
      method: c.req.method,
      headers: { "content-type": "application/json" },
    };

    if (c.req.method !== "GET" && c.req.method !== "HEAD") {
      init.body = await c.req.text();
    }

    let res: Response;
    try {
      res = await fetch(url, init);
    } catch {
      return c.json({ error: "ScholarAIO API unavailable. Run: scholaraio serve" }, 503);
    }

    return new Response(res.body, {
      status: res.status,
      headers: { "content-type": res.headers.get("content-type") ?? "application/json" },
    });
  });

  return app;
}
