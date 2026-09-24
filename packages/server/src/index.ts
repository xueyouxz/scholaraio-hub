import { existsSync } from "node:fs";
import { createServer as createHttpsServer } from "node:https";
import path from "node:path";
import { serve } from "@hono/node-server";
import { createApp } from "./app.js";
import {
  closeCodexCorrelationDebugLogger,
  initCodexCorrelationDebugLogger,
} from "./codex/correlationDebugLogger.js";
import { loadConfig } from "./config.js";
import { ensureSelfSignedCertificate } from "./https/self-signed.js";
import { initLogger, interceptConsole } from "./logging/index.js";
import { closeMessageLogger, initMessageLogger } from "./sdk/messageLogger.js";
import { setHubApiBaseUrl } from "./sdk/providers/scholaraio-cli.js";
import { LibraryService } from "./services/LibraryService.js";
import { InstallService, ModelInfoService, ServerSettingsService } from "./services/index.js";
import { ensureSkillsDirectory } from "./skills/skillsDirectory.js";

const config = loadConfig();
initLogger({
  logDir: config.logDir,
  logFile: config.logFile,
  consoleLevel: config.logLevel,
  fileLevel: config.logFileLevel,
  logToFile: config.logToFile,
  prettyPrint: config.logPretty,
});
interceptConsole();
// Opt-in raw protocol logs for debugging providers (LOG_SDK_MESSAGES / CODEX_CORRELATION_DEBUG).
initMessageLogger();
initCodexCorrelationDebugLogger();
console.log(`[Config] Profile ${config.profile}, data directory ${config.dataDir}`);
// Production serves the built client; without it every page would 404.
if (config.nodeEnv === "production" && !existsSync(path.join(config.clientDistDir, "index.html"))) {
  console.error(`[Startup] 未找到前端构建产物 ${config.clientDistDir}，请先运行 pnpm build。`);
  process.exit(1);
}
const library = new LibraryService(config.dataDir);
const settings = new ServerSettingsService({ dataDir: config.dataDir });
const install = new InstallService({ dataDir: config.dataDir });
let application: ReturnType<typeof createApp> | undefined;
let server: ReturnType<typeof serve> | undefined;
let closing = false;
async function shutdown() {
  if (closing) return;
  closing = true;
  setHubApiBaseUrl(undefined);
  server?.close();
  await application?.close();
  await library.close();
  closeMessageLogger();
  closeCodexCorrelationDebugLogger();
}
for (const signal of ["SIGINT", "SIGTERM"])
  process.once(signal, () => {
    void shutdown().then(
      () => process.exit(0),
      (error) => {
        console.error(error);
        process.exit(1);
      },
    );
  });
try {
  await Promise.all([
    library.start(),
    settings.initialize(),
    install.initialize(),
    ensureSkillsDirectory(config.dataDir),
  ]);
  application = createApp({
    dataDir: config.dataDir,
    libraryService: library,
    idleTimeoutMs: config.idleTimeoutMs,
    defaultPermissionMode: config.defaultPermissionMode,
    serverSettingsService: settings,
    modelInfoService: new ModelInfoService(),
    enabledProviders: config.enabledProviders,
    installId: install.getInstallId(),
    frontendDistPath: config.clientDistDir,
    scholaraioSkillsDir: config.scholaraioSkillsDir,
  });
  await application.ready;
  const tls = config.httpsSelfSigned
    ? ensureSelfSignedCertificate({ dataDir: config.dataDir, host: config.host })
    : undefined;
  const options = { fetch: application.app.fetch, port: config.port, hostname: config.host };
  server = tls
    ? serve({
        ...options,
        createServer: createHttpsServer,
        serverOptions: { key: tls.key, cert: tls.cert },
      })
    : serve(options);
  setHubApiBaseUrl(`${tls ? "https" : "http"}://${config.host}:${config.port}`);
  server.on("error", (error: NodeJS.ErrnoException) => {
    if (error.code === "EADDRINUSE")
      console.error(
        `[Server] 端口 ${config.port} 已被占用：可能已有一个 Hub 在运行（pnpm hub doctor 可查看），或用 PORT=xxxx 换端口。`,
      );
    else console.error("[Server]", error);
    void shutdown().then(() => {
      process.exitCode = 1;
    });
  });
  console.log(`ScholarAIO Hub: ${tls ? "https" : "http"}://${config.host}:${config.port}`);
} catch (error) {
  console.error("[Startup]", error);
  await shutdown();
  process.exitCode = 1;
}
