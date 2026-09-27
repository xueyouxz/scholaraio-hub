/**
 * `pnpm dev` and `pnpm start`: the library service and the Hub server, started
 * side by side and stopped together.
 *
 * The launcher resolves everything the two need from the profile and hands it
 * to them: the library service gets its settings as arguments, the server as
 * environment variables. Neither starts, stops or configures the other; the
 * server only calls the library service's API at `LIBRARY_URL`.
 */
import { type ChildProcess, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { createServer } from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { LibraryProcess } from "./library-process.js";
import { currentProfile } from "./profile.js";
import { pythonRuntime } from "./python.js";

export type LaunchMode = "development" | "production";

const serverDir = fileURLToPath(new URL("../../server/", import.meta.url));
const clientDist = fileURLToPath(new URL("../../client/dist/", import.meta.url));
/** How long the server may take to finish its runs and exit before it is killed. */
const SERVER_STOP_GRACE_MS = 15_000;

function log(message: string): void {
  console.log(`[hub] ${message}`);
}

function portIsFree(port: number, host: string): Promise<boolean> {
  return new Promise((resolve) => {
    const probe = createServer();
    probe.once("error", () => resolve(false));
    probe.listen(port, host, () => probe.close(() => resolve(true)));
  });
}

/** `LOG_TO_FILE` as the server reads it; unset means "in production". */
function logsToFile(mode: LaunchMode): boolean {
  const value = process.env.LOG_TO_FILE?.trim().toLowerCase();
  if (!value) return mode === "production";
  return ["1", "true", "yes", "on", "y", "enabled"].includes(value);
}

/** Development runs the server's source under `tsx watch`; production its build. */
function serverCommand(mode: LaunchMode): string[] {
  if (mode === "production") return [path.join(serverDir, "dist/index.js")];
  const tsx = createRequire(path.join(serverDir, "package.json")).resolve("tsx/cli");
  return [tsx, "watch", "--conditions", "scholaraio-source", "src/index.ts"];
}

/** What would otherwise fail later, with a less direct message. */
async function preflight(mode: LaunchMode, ports: Array<[string, number]>, host: string) {
  const problems: string[] = [];
  for (const [name, port] of ports)
    if (!(await portIsFree(port, host)))
      problems.push(
        `${name}端口 ${port} 已被占用：可能已有一个 Hub 在运行（pnpm hub doctor 可查看），或用 PORT / LIBRARY_PORT 换端口。`,
      );
  if (mode === "production") {
    if (!existsSync(path.join(serverDir, "dist/index.js")))
      problems.push("未找到服务端构建产物，请先运行 pnpm build。");
    if (!existsSync(path.join(process.env.CLIENT_DIST_DIR ?? clientDist, "index.html")))
      problems.push("未找到前端构建产物，请先运行 pnpm build。");
  }
  return problems;
}

/**
 * Stop the server. Ctrl+C reaches the whole foreground group, so after a SIGINT
 * the server is already stopping and is only waited for; a SIGTERM (from a
 * parent, or the launcher's own decision) is passed on. A server still running
 * after the grace period is asked with SIGTERM, then killed.
 */
function stopServer(child: ChildProcess, signal: NodeJS.Signals): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
  return new Promise((resolve) => {
    const escalate = setTimeout(() => {
      child.kill("SIGTERM");
      kill.refresh();
    }, SERVER_STOP_GRACE_MS);
    const kill = setTimeout(() => child.kill("SIGKILL"), SERVER_STOP_GRACE_MS * 2);
    child.once("exit", () => {
      clearTimeout(escalate);
      clearTimeout(kill);
      resolve();
    });
    if (signal !== "SIGINT") child.kill(signal);
  });
}

export async function launch(mode: LaunchMode): Promise<number> {
  process.env.NODE_ENV = mode;
  const profile = currentProfile();
  const host = process.env.HOST || "127.0.0.1";
  const problems = await preflight(
    mode,
    [
      ["Hub ", profile.port],
      ["文献服务", profile.libraryPort],
    ],
    host,
  );
  if (problems.length) {
    for (const problem of problems) console.error(problem);
    return 1;
  }
  const runtime = pythonRuntime(profile.dataDir);
  const logDir = process.env.LOG_DIR || path.join(profile.dataDir, "logs");
  const logToFile = logsToFile(mode);
  const library = new LibraryProcess({
    dataDir: profile.dataDir,
    host,
    port: profile.libraryPort,
    hubPort: profile.port,
    allowedHosts: process.env.ALLOWED_HOSTS,
    logFile: logToFile ? path.join(logDir, "library.log") : undefined,
  });

  log(`profile ${profile.name}，数据目录 ${profile.dataDir}`);
  try {
    await library.start();
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    await library.stop();
    return 1;
  }
  log(`文献服务 ${library.url}`);

  const [entry, ...args] = serverCommand(mode);
  const server = spawn(process.execPath, [entry ?? "", ...args], {
    cwd: serverDir,
    stdio: "inherit",
    env: {
      ...process.env,
      NODE_ENV: mode,
      SCHOLARAIO_HUB_PROFILE: profile.name,
      SCHOLARAIO_HUB_DATA_DIR: profile.dataDir,
      HOST: host,
      PORT: String(profile.port),
      LIBRARY_URL: library.url,
      LOG_DIR: logDir,
      LOG_TO_FILE: String(logToFile),
      // What an agent's `scholaraio` CLI needs to work on this library.
      SCHOLARAIO_CONFIG: path.join(profile.dataDir, "config.yaml"),
      SCHOLARAIO_CLI_BIN: runtime.binDir,
    },
  });
  log(`打开 http://${host}:${profile.port}   （Ctrl+C 停止）`);

  let stopping: Promise<void> | undefined;
  // Server first: it finishes its runs while the library still answers.
  const stop = (signal: NodeJS.Signals) => {
    library.expectExit();
    stopping ??= stopServer(server, signal).then(() => library.stop());
    return stopping;
  };
  // Ctrl+C reaches the whole foreground group; a parent's SIGTERM only this process.
  const onInt = () => void stop("SIGINT");
  const onTerm = () => void stop("SIGTERM");
  process.on("SIGINT", onInt);
  process.on("SIGTERM", onTerm);
  const code = await new Promise<number>((resolve) => {
    server.once("error", (error) => {
      console.error(`无法启动服务端：${error.message}`);
      resolve(1);
    });
    server.once("exit", (exitCode, signal) =>
      resolve(exitCode ?? (signal === "SIGINT" || signal === "SIGTERM" ? 0 : 1)),
    );
  });
  await stop("SIGTERM");
  process.off("SIGINT", onInt);
  process.off("SIGTERM", onTerm);
  return code;
}
