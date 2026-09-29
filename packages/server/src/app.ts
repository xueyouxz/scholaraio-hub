import { Hono } from "hono";
import { secureHeaders } from "hono/secure-headers";
import type { Services } from "./container.js";
import { createStaticRoutes } from "./frontend/static.js";
import {
  type AppEnv,
  errorResponse,
  handleApiError,
  registerMethodFallback,
  requestContext,
} from "./http.js";
import { hostCheck, parseAllowedHosts, requireCsrfHeader } from "./middleware/security.js";
import { createEventRoutes } from "./routes/events.js";
import { createProjectRoutes } from "./routes/projects.js";
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
  const app = new Hono<AppEnv>();
  // 顺序：先观测（请求标识、访问日志），再安全（响应头、Host、CSRF），最后是路由。
  app.use("/api/*", requestContext);
  // 本机 HTTP 服务：不发 HSTS；其余默认值（nosniff、同源资源策略、禁止嵌入等）适用于 JSON 与文件接口。
  app.use("/api/*", secureHeaders({ strictTransportSecurity: false }));
  app.use("/api/*", hostCheck(parseAllowedHosts(options.allowedHosts)));
  app.use("/api/*", requireCsrfHeader);
  app.route(
    "/api/sessions",
    createSessionRoutes({
      sessions: services.sessions,
      attachments: services.attachments,
      files: services.files,
      settings: services.settings,
    }),
  );
  app.route(
    "/api/projects",
    createProjectRoutes({ catalog: services.catalog, folders: services.folders }),
  );
  app.route("/api/events", createEventRoutes({ events: services.events }));
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
