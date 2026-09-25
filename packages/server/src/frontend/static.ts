/**
 * Production client: the built Vite output, served by this server so the page
 * and the API share one port. Development serves it through Vite (`dev.ts`).
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";

export interface StaticServeOptions {
  /** Path to the built client dist directory (startup has checked it exists). */
  distPath: string;
}

// frame-ancestors must be an HTTP header; a meta tag cannot set it.
const FRAME_POLICY = "frame-ancestors 'self'";

// The page names the current build's assets, so it is never cached.
const PAGE_HEADERS = { "Content-Security-Policy": FRAME_POLICY, "Cache-Control": "no-cache" };

/**
 * Files from the build, and the page for every other path (the client routes
 * it). Vite names everything under `/assets/` by content hash, so those files
 * never change and are cached for good.
 */
export function createStaticRoutes(options: StaticServeOptions): Hono {
  const root = path.resolve(options.distPath);
  const indexPath = path.join(root, "index.html");
  const app = new Hono();

  // Headers go on after the response is made: serveStatic's onFound runs too late to add any.
  app.get("*", async (c, next) => {
    await next();
    if (c.res.headers.get("content-type")?.startsWith("text/html"))
      for (const [name, value] of Object.entries(PAGE_HEADERS)) c.res.headers.set(name, value);
    else
      c.res.headers.set(
        "Cache-Control",
        c.req.path.startsWith("/assets/")
          ? "public, max-age=31536000, immutable"
          : "public, max-age=0, must-revalidate",
      );
  });
  app.get("*", serveStatic({ root }));

  // Read on each request, so a rebuild shows without restarting the server.
  app.get("*", async (c) => {
    try {
      return c.html(await readFile(indexPath, "utf-8"));
    } catch (error) {
      console.error(`[Static] Cannot read ${indexPath}:`, error);
      return c.text("Not found. Did you run 'pnpm build' to build the client?", 404);
    }
  });

  return app;
}
