import { existsSync } from "node:fs";
import { type Server, createServer } from "node:http";
import path from "node:path";
import { serve } from "@hono/node-server";
import { createApp } from "./app.js";
import { loadConfig } from "./config.js";
import { type Services, createServices } from "./container.js";
import { DevFrontend } from "./frontend/dev.js";
import { LibraryClient } from "./lib/LibraryClient.js";
import { initLogger, interceptConsole, loggerFor } from "./logging/logger.js";
import { ProviderRegistry } from "./providers/ProviderRegistry.js";
import { closeProviderTrace, initProviderTrace } from "./providers/trace.js";
import { ensureSkillsDirectory } from "./skills/skillsDirectory.js";
import { resolvesWithin } from "./utils/timeout.js";

/**
 * 关闭最多等待的时间：会话收尾、agent 进程退出、设置写盘。超过则直接退出，
 * 且短于启动器的等待（15s），由本进程而不是启动器的 SIGKILL 决定何时结束。
 */
const SHUTDOWN_TIMEOUT_MS = 10_000;

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

// 组装根：每项服务在这里创建一次，关闭时按相反顺序释放。
const library = new LibraryClient(config.libraryUrl);
const services: Services = createServices({
  dataDir: config.dataDir,
  library,
  // Every agent works on this Hub's library, and writes through the library service.
  providers: ProviderRegistry.create({
    enabled: config.enabledProviders,
    claude: config.claude,
    codex: config.codex,
    agentLibrary: { ...config.agentLibrary, libraryUrl: config.libraryUrl },
  }),
  skillsDir: config.skillsDir,
  idleTimeoutMs: config.idleTimeoutMs,
});
// Development serves the client from Vite on this same port; production from the build.
const devFrontend = config.nodeEnv === "development" ? new DevFrontend(library.port) : undefined;
let server: ReturnType<typeof serve> | undefined;

let shutdown: Promise<void> | undefined;
/** Stop once, however many signals ask: the launcher may send one after the terminal's. */
function stop(): Promise<void> {
  shutdown ??= (async () => {
    server?.close();
    await devFrontend?.close();
    await services.close();
    closeProviderTrace();
  })();
  return shutdown;
}
/** 关闭后以 `code` 退出；关闭失败或超时也要退出。 */
function exitAfterShutdown(code: number): void {
  const stopped = stop().catch((error: unknown) => {
    log.error({ err: error }, "Shutdown failed");
    throw error;
  });
  void resolvesWithin(stopped, SHUTDOWN_TIMEOUT_MS).then((clean) => {
    if (!clean) log.error({ timeoutMs: SHUTDOWN_TIMEOUT_MS }, "Shutdown did not finish cleanly");
    process.exit(clean ? code : 1);
  });
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
  await ensureSkillsDirectory(config.skillsDir);
  await services.start();
  const app = createApp(services, {
    frontendDistPath: devFrontend ? undefined : config.clientDistDir,
    allowedHosts: config.allowedHosts,
    profile: config.profile,
  });
  server = serve({
    fetch: app.fetch,
    port: config.port,
    hostname: config.host,
    // Whole-library uploads can take longer than Node's total request deadline.
    serverOptions: { requestTimeout: 0 },
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
    exitAfterShutdown(1);
  });
  if (devFrontend) await devFrontend.attach(server as Server);
  log.info(`ScholarAIO Hub: ${origin}`);
} catch (error) {
  log.fatal({ err: error }, "Startup failed");
  exitAfterShutdown(1);
}
