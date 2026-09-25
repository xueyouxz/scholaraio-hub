import { Hono } from "hono";
import type { VectorRuntimeService } from "../services/VectorRuntimeService.js";

/**
 * The optional embedding packages, installed on request.
 *
 * Registered before the library proxy so these two paths stay with the Hub:
 * the Python service cannot install into the environment it is running in.
 */
export function createLibraryRuntimeRoutes(runtime: VectorRuntimeService) {
  const routes = new Hono();
  routes.get("/", (c) => c.json(runtime.read()));
  routes.post("/embed", (c) => {
    if (runtime.installing) return c.json(runtime.read(), 409);
    try {
      return c.json(runtime.install(), 202);
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : "安装失败" }, 500);
    }
  });
  return routes;
}
