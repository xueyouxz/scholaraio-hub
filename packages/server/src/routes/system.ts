import { Hono } from "hono";
import { type AppEnv, success } from "../http.js";
import type { LibraryClient } from "../lib/LibraryClient.js";

/** 创建应用状态与健康检查接口。 */
export function createSystemRoutes(options: {
  dataDir: string;
  profile?: string;
  library: LibraryClient;
}) {
  const routes = new Hono<AppEnv>();
  routes.get("/status", async (c) =>
    success(c, {
      dataDir: options.dataDir,
      profile: options.profile,
      library: await options.library.available(),
    }),
  );
  return routes;
}
