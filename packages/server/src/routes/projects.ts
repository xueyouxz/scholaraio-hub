import { PROVIDER_NAMES } from "@scholaraio-hub/shared";
import { Hono } from "hono";
import { z } from "zod";
import { type AppEnv, created, emptyBody, success, validate } from "../http.js";
import type { FolderPicker } from "../projects/FolderPicker.js";
import type { ProjectCatalog } from "../projects/ProjectCatalog.js";

const PAGE_SCHEMA = z.object({
  offset: z.coerce.number().int().min(0).default(0),
  limit: z.coerce.number().int().min(1).max(200).default(20),
  provider: z.enum(PROVIDER_NAMES).optional(),
});
const ADD_SCHEMA = z.object({ path: z.string().trim().min(1).max(4096) }).strict();

/** 项目领域接口：各 Provider 自己保存的会话按工作目录分组后的项目，以及项目下的会话。 */
export function createProjectRoutes({
  catalog,
  folders,
}: { catalog: ProjectCatalog; folders: FolderPicker }) {
  const routes = new Hono<AppEnv>();
  routes.get("/", async (c) => success(c, await catalog.projects()));
  // The system's own dialog on this computer: the folder chosen, or null when cancelled.
  routes.post("/pick-folder", async (c) =>
    success(c, { path: await folders.choose(c.req.raw.signal) }),
  );
  routes.post("/", validate("json", ADD_SCHEMA), async (c) =>
    created(c, await catalog.add(c.req.valid("json").path)),
  );
  // Sessions that ran in no project's directory; registered before `/:id/sessions`.
  routes.get("/unassigned/sessions", validate("query", PAGE_SCHEMA), async (c) =>
    success(c, await catalog.sessions(null, c.req.valid("query"))),
  );
  routes.get("/:id/sessions", validate("query", PAGE_SCHEMA), async (c) =>
    success(c, await catalog.sessions(c.req.param("id"), c.req.valid("query"))),
  );
  routes.delete("/:id", async (c) => {
    await catalog.hide(c.req.param("id"));
    return emptyBody(c);
  });
  return routes;
}
