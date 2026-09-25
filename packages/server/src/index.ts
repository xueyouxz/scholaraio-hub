import { existsSync } from "node:fs";
import { type Server, createServer } from "node:http";
import path from "node:path";
import { serve } from "@hono/node-server";
import { createApp } from "./app.js";
import { loadConfig } from "./config.js";
import { DevFrontend } from "./frontend/dev.js";
import { LibraryClient } from "./lib/LibraryClient.js";
import { initLogger, interceptConsole, loggerFor } from "./logging/logger.js";
import { bindAgentLibrary } from "./providers/agent-env.js";
import { closeProviderTrace, initProviderTrace } from "./providers/trace.js";
import { ServerSettingsService } from "./services/ServerSettingsService.js";
import { ensureSkillsDirectory } from "./skills/skillsDirectory.js";

// The launcher (`pnpm dev` / `pnpm start`, packages/cli) sets everything this
// reads and runs the library service beside this server.
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
const log = loggerFor("server");
// Opt-in trace of raw provider messages for debugging (LOG_SDK_MESSAGES).
initProviderTrace({ enabled: config.logSdkMessages, logDir: config.logDir });
log.info(
  { profile: config.profile, dataDir: config.dataDir, library: config.libraryUrl },
  "Configuration loaded",
);
// Production serves the built client; without it every page would 404.
if (config.nodeEnv === "production" && !existsSync(path.join(config.clientDistDir, "index.html"))) {
  log.fatal(`未找到前端构建产物 ${config.clientDistDir}，请先运行 pnpm build。`);
  process.exit(1);
}
// Development serves the client from Vite on this same port; production from the build.
const devFrontend = config.nodeEnv === "development" ? new DevFrontend() : undefined;
const library = new LibraryClient(config.libraryUrl);
const settings = new ServerSettingsService({ dataDir: config.dataDir });
let application: ReturnType<typeof createApp> | undefined;
let server: ReturnType<typeof serve> | undefined;
let shutdown: Promise<void> | undefined;
/** Stop once, however many signals ask: the launcher may send one after the terminal's. */
function stop(): Promise<void> {
  shutdown ??= (async () => {
    bindAgentLibrary(undefined);
    server?.close();
    await devFrontend?.close();
    await application?.close();
    closeProviderTrace();
  })();
  return shutdown;
}
/** Shut down, then leave with `code`; a failed shutdown still leaves. */
function exitAfterShutdown(code: number): void {
  void stop().then(
    () => process.exit(code),
    (error) => {
      log.error({ err: error }, "Shutdown failed");
      process.exit(1);
    },
  );
}
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => exitAfterShutdown(0));
// A promise nobody awaited failed: a bug, but one request's, not the server's.
process.on("unhandledRejection", (reason) => {
  log.error({ err: reason }, "Unhandled promise rejection");
});
// A throw that escaped every handler leaves the process in an unknown state:
// stop the agents cleanly rather than keep serving.
process.on("uncaughtException", (error) => {
  log.fatal({ err: error }, "Uncaught exception; shutting down");
  exitAfterShutdown(1);
});
try {
  const origin = `http://${config.host}:${config.port}`;
  // Every agent this server starts works on the library, through the Hub's API.
  bindAgentLibrary({ ...config.agentLibrary, apiBaseUrl: origin });
  await Promise.all([settings.initialize(), ensureSkillsDirectory(config.skillsDir)]);
  application = createApp({
    dataDir: config.dataDir,
    library,
    idleTimeoutMs: config.idleTimeoutMs,
    serverSettingsService: settings,
    enabledProviders: config.enabledProviders,
    frontendDistPath: devFrontend ? undefined : config.clientDistDir,
    scholaraioSkillsDir: config.skillsDir,
    allowedHosts: config.allowedHosts,
    profile: config.profile,
  });
  await application.ready;
  server = serve({
    fetch: application.app.fetch,
    port: config.port,
    hostname: config.host,
    createServer: devFrontend
      ? (devFrontend.wrap(createServer) as typeof createServer)
      : createServer,
  });
  server.on("error", (error: NodeJS.ErrnoException) => {
    if (error.code === "EADDRINUSE")
      log.fatal(
        `端口 ${config.port} 已被占用：可能已有一个 Hub 在运行（pnpm hub doctor 可查看），或用 PORT=xxxx 换端口。`,
      );
    else log.fatal({ err: error }, "Server error");
    void stop().then(() => {
      process.exitCode = 1;
    });
  });
  if (devFrontend) await devFrontend.attach(server as Server);
  log.info(`ScholarAIO Hub: ${origin}`);
  // Sessions follow projects the library renamed or archived while the server was down.
  application.sessions.reconcileProjects().then(
    (changed) => {
      if (changed) log.info({ changed }, "Sessions brought up to the library's projects");
    },
    (error) => log.warn({ err: error }, "Could not match sessions to the library's projects"),
  );
} catch (error) {
  log.fatal({ err: error }, "Startup failed");
  await stop();
  process.exitCode = 1;
}
