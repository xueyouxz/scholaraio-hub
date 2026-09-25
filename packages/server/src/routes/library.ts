import { Hono } from "hono";
import { loggerFor } from "../logging/logger.js";
import type { LibraryService } from "../services/LibraryService.js";

/**
 * The upstream body, except that a browser leaving mid-stream (a page change
 * closing the event stream) ends it instead of failing it: that is how such a
 * stream normally stops, not an error to report.
 */
function endsQuietly(body: ReadableStream<Uint8Array>, signal: AbortSignal) {
  const reader = body.getReader();
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const { done, value } = await reader.read();
        if (done) controller.close();
        else controller.enqueue(value);
      } catch (error) {
        if (signal.aborted) controller.close();
        else controller.error(error);
      }
    },
    cancel(reason) {
      return reader.cancel(reason);
    },
  });
}

/**
 * Explicit application routes; no arbitrary upstream URL or filesystem proxy.
 * Only what the client requests is listed. Renaming and archiving a project go
 * through routes/projects.ts, which also moves the project's sessions.
 */
export function createLibraryRoutes(service: LibraryService) {
  const routes = new Hono();
  const resources: ReadonlyArray<readonly ["GET" | "POST" | "PATCH" | "PUT" | "DELETE", string]> = [
    ["GET", "/analytics"],
    ["GET", "/projects"],
    ["POST", "/projects"],
    ["GET", "/projects/:id"],
    ["POST", "/projects/:id/papers"],
    ["GET", "/papers"],
    ["GET", "/search"],
    ["GET", "/discover"],
    ["GET", "/papers/:id"],
    ["GET", "/papers/:id/pdf"],
    ["GET", "/papers/:id/images"],
    ["PATCH", "/papers/:id"],
    ["POST", "/papers/:id/refetch"],
    ["GET", "/papers/:id/references"],
    ["GET", "/papers/:id/citing"],
    ["POST", "/citations/export"],
    ["GET", "/papers/:id/attachments/*"],
    ["GET", "/papers/:id/position"],
    ["PUT", "/papers/:id/position"],
    ["GET", "/events"],
    ["GET", "/settings"],
    ["PATCH", "/settings"],
    ["POST", "/settings/check"],
    ["GET", "/tasks"],
    ["POST", "/tasks/:kind"],
    ["DELETE", "/tasks/:kind"],
    ["GET", "/imports"],
    ["POST", "/imports"],
    ["POST", "/imports/fetch"],
    ["POST", "/imports/:id/retry"],
    ["POST", "/directories/:target/reveal"],
    ["GET", "/runtime"],
    ["POST", "/runtime/:capability"],
  ];
  for (const [method, resource] of resources) {
    routes.on(method, resource, async (c) => {
      const headers = new Headers();
      for (const name of [
        "content-type",
        "range",
        "if-range",
        "if-none-match",
        "if-modified-since",
      ]) {
        const value = c.req.header(name);
        if (value) headers.set(name, value);
      }
      const url = new URL(c.req.url);
      const upstreamPath = url.pathname.slice("/api/library".length);
      const init: RequestInit & { duplex?: "half" } = { method, headers, signal: c.req.raw.signal };
      if (method !== "GET") {
        init.body = c.req.raw.body;
        init.duplex = "half";
      }
      try {
        const response = await service.request(`${upstreamPath}${url.search}`, init);
        const output = new Headers();
        for (const name of [
          "content-type",
          "content-length",
          "etag",
          "last-modified",
          "cache-control",
          "content-range",
          "accept-ranges",
          "x-content-type-options",
        ]) {
          const value = response.headers.get(name);
          if (value) output.set(name, value);
        }
        if (response.status === 200 && c.req.header("if-none-match") === output.get("etag")) {
          await response.body?.cancel();
          return new Response(null, { status: 304, headers: output });
        }
        return new Response(response.body && endsQuietly(response.body, c.req.raw.signal), {
          status: response.status,
          headers: output,
        });
      } catch (error) {
        // The browser went away before the library answered: nobody to tell.
        if (c.req.raw.signal.aborted) return new Response(null, { status: 499 });
        loggerFor("library").error({ err: error, method, path: upstreamPath }, "Request failed");
        return c.json({ error: "文献服务不可用，请检查启动日志。" }, 503);
      }
    });
  }
  return routes;
}
