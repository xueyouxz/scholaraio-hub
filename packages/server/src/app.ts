import type { HttpBindings } from "@hono/node-server";
import { Hono } from "hono";
import type { Services } from "./container.js";
import { createStaticRoutes } from "./frontend/static.js";
import { errorResponse, handleApiError, registerMethodFallback, requestContext } from "./http.js";
import { hostCheck, parseAllowedHosts, requireCsrfHeader } from "./middleware/security.js";
import { createProvidersRoutes } from "./routes/providers.js";
import { createSessionRoutes } from "./routes/sessions.js";
import { createSettingsRoutes } from "./routes/settings.js";
import { createSkillsRoutes } from "./routes/skills.js";
import { createSystemRoutes } from "./routes/system.js";

export interface AppOptions {
  /** 生产环境的前端构建目录；开发时由 Vite 提供页面。 */
  frontendDistPath?: string;
  /** `ALLOWED_HOSTS`: extra hostnames the API answers besides loopback, or "*". */
  allowedHosts?: string;
  /** The profile the launcher started this server with. */
  profile?: string;
}

/** 装配中间件和领域路由。只组装已创建的服务，不创建服务、不读写磁盘。 */
export function createApp(services: Services, options: AppOptions = {}) {
  const app = new Hono<{ Bindings: HttpBindings }>();
  app.use("/api/*", requestContext);
  app.use("/api/*", hostCheck(parseAllowedHosts(options.allowedHosts)));
  app.use("/api/*", requireCsrfHeader);
  app.route("/api/sessions", createSessionRoutes(services.sessions, services.settings));
  app.route("/api/skills", createSkillsRoutes({ scholaraioSkillsDir: services.skillsDir }));
  app.route(
    "/api/providers",
    createProvidersRoutes({
      providers: services.providers,
      providerUsageLimitService: services.usage,
    }),
  );
  app.route(
    "/api",
    createSystemRoutes({
      dataDir: services.dataDir,
      profile: options.profile,
      library: services.library,
    }),
  );
  app.route("/api/settings", createSettingsRoutes({ serverSettingsService: services.settings }));
  registerMethodFallback(app);
  app.all("/api/*", (c) => errorResponse(c, "ROUTE_NOT_FOUND", "Endpoint not found."));
  app.onError(handleApiError);
  if (options.frontendDistPath)
    app.route(
      "/",
      createStaticRoutes({
        distPath: options.frontendDistPath,
        libraryPort: services.library.port,
      }),
    );
  return app;
}
