import type { LiteratureProject } from "@scholaraio-hub/shared";
import { Hono } from "hono";
import type { LibraryService } from "../services/LibraryService.js";
import type { SessionStore } from "../sessions/SessionStore.js";

/**
 * Project changes the library service cannot make alone: renaming or removing a
 * project also decides where its sessions run next, and sessions belong to this
 * server.
 */
export function createProjectRoutes(service: LibraryService, store: SessionStore) {
  const routes = new Hono();

  routes.post("/:id/rename", async (c) => {
    const id = c.req.param("id");
    const body = await c.req.json<{ name?: string }>();
    if (!body.name?.trim()) return c.json({ error: "项目名称不能为空" }, 400);
    const project = await service.json<LiteratureProject>(
      `/projects/${encodeURIComponent(id)}/rename`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: body.name.trim() }),
      },
    );
    const sessions = await store.retargetProject(id, project.id);
    return c.json({ project, sessions });
  });

  routes.delete("/:id", async (c) => {
    const id = c.req.param("id");
    const archived = await service.json<{ id: string; archivedAt: string }>(
      `/projects/${encodeURIComponent(id)}`,
      { method: "DELETE" },
    );
    // The sessions survive; without a project they continue in their own
    // directory rather than following a project that is no longer there.
    const sessions = await store.retargetProject(id, undefined);
    return c.json({ archived, sessions });
  });

  return routes;
}
