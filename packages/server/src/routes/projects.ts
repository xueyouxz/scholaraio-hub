import type { ArchivedProject, LiteratureProject } from "@scholaraio-hub/shared";
import { Hono } from "hono";
import { z } from "zod";
import type { LibraryClient } from "../lib/LibraryClient.js";
import type { SessionStore } from "../sessions/SessionStore.js";
import { validate } from "./validate.js";

const RenameSchema = z.object({
  name: z.string({ error: "项目名称不能为空" }).trim().min(1, "项目名称不能为空"),
});

/**
 * Project changes the library service cannot make alone: renaming or removing a
 * project also decides where its sessions run next, and sessions belong to this
 * server.
 */
export function createProjectRoutes(service: LibraryClient, store: SessionStore) {
  const routes = new Hono();

  routes.post("/:id/rename", validate("json", RenameSchema), async (c) => {
    const id = c.req.param("id");
    const { name } = c.req.valid("json");
    const project = await service.json<LiteratureProject>(
      `/projects/${encodeURIComponent(id)}/rename`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name }),
      },
    );
    const sessions = await store.retargetProject(id, project.id);
    return c.json({ project, sessions });
  });

  routes.delete("/:id", async (c) => {
    const id = c.req.param("id");
    const archived = await service.json<ArchivedProject>(`/projects/${encodeURIComponent(id)}`, {
      method: "DELETE",
    });
    // The sessions survive; without a project they continue in their own
    // directory rather than following a project that is no longer there.
    const sessions = await store.retargetProject(id, undefined);
    return c.json({ archived, sessions });
  });

  return routes;
}
