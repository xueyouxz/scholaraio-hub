import { Hono } from "hono";

export function createScholarRoutes({ scholarAioApiUrl }: { scholarAioApiUrl: string }) {
  const app = new Hono();

  app.all("/*", async (c) => {
    const path = c.req.path.replace(/^\/api\/scholar/, "");
    const url = `${scholarAioApiUrl}${path}${c.req.url.includes("?") ? `?${c.req.url.split("?")[1]}` : ""}`;

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

    const body = await res.text();
    return new Response(body, {
      status: res.status,
      headers: { "content-type": res.headers.get("content-type") ?? "application/json" },
    });
  });

  return app;
}
