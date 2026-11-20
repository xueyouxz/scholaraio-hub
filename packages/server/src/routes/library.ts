import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { proxy } from "hono/proxy";
import { Agent, fetch as fetchUpstream } from "undici";
import type { AppEnv } from "../http.js";
import { type LibraryClient, LibraryUnavailableError } from "../lib/LibraryClient.js";
import { requireCsrfHeader } from "../middleware/security.js";

/** Relay library traffic on the page's origin, including uploads, PDF ranges and SSE. */
export function createLibraryRoutes(library: LibraryClient) {
  const routes = new Hono<AppEnv>();
  routes.all("*", async (c) => {
    const resource = c.req.path.slice("/api/library".length) || "/";
    const isMcp = resource === "/mcp" || resource === "/mcp/";
    // Native MCP has its own browser-Origin guard in the library service.
    if (!isMcp) {
      const rejected = await requireCsrfHeader(c, async () => {});
      if (rejected) return rejected;
    }
    const target = new URL(library.baseUrl);
    target.pathname = `${target.pathname.replace(/\/$/, "")}${resource}`;
    target.search = new URL(c.req.url).search;
    const headers = new Headers(c.req.raw.headers);
    headers.set("host", target.host);
    // The outer Host/CSRF checks protect web requests; no cross-origin hop is needed.
    // Preserve MCP Origin so browser clients are still refused by the library.
    if (!isMcp) headers.delete("origin");
    const raw = new Request(c.req.raw, { headers });
    let response: Response;
    try {
      response = await proxy(target, {
        raw,
        redirect: "manual",
        strictConnectionProcessing: true,
        customFetch:
          resource === "/documents/import" && raw.method === "POST"
            ? fetchLibraryImport
            : undefined,
      });
    } catch (error) {
      if (raw.signal.aborted || error instanceof HTTPException) throw error;
      throw new LibraryUnavailableError(library.baseUrl, error);
    }
    // Starlette adds trailing-slash redirects; keep them on the public origin.
    const location = response.headers.get("location");
    if (location) {
      const redirect = new URL(location, target);
      const base = new URL(library.baseUrl);
      const basePath = base.pathname.replace(/\/$/, "");
      if (redirect.origin === base.origin && redirect.pathname.startsWith(`${basePath}/`)) {
        response.headers.set(
          "location",
          `/api/library${redirect.pathname.slice(basePath.length)}${redirect.search}${redirect.hash}`,
        );
      }
    }
    if (response.headers.get("content-type")?.startsWith("text/event-stream")) {
      response.headers.set("x-accel-buffering", "no");
    }
    return response;
  });
  return routes;
}

/** Keep a bulk upload open through indexing, and release its connection on every exit. */
async function fetchLibraryImport(request: Request): Promise<Response> {
  const dispatcher = new Agent({ headersTimeout: 0, bodyTimeout: 0 });
  try {
    const response = await fetchUpstream(request.url, {
      method: request.method,
      headers: Object.fromEntries(request.headers),
      body: request.body,
      duplex: "half",
      dispatcher,
      signal: request.signal,
      redirect: request.redirect,
    });
    // Only the small JSON result is buffered; the uploaded archive streams upstream.
    return new Response(await response.arrayBuffer(), {
      status: response.status,
      statusText: response.statusText,
      headers: Object.fromEntries(response.headers),
    });
  } finally {
    await dispatcher.destroy();
  }
}
