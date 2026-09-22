// Development launcher: runs the Node server and the Vite client together.
//
//   pnpm dev                # server + client (client starts once the server is healthy)
//   pnpm dev --server       # server only (API on PORT, default 3500)
//   pnpm dev --client       # client only (proxies /api to an already running server)
//
// Both processes get the same resolved ports, so the Vite proxy always points at
// the server this script started. Output is prefixed per process, and stopping
// either process (or pressing Ctrl+C) stops the other.
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { createServer } from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = new Set(process.argv.slice(2));
const runServer = !args.has("--client");
const runClient = !args.has("--server");

/** Minimal .env reader for the keys this script needs; the server loads the full files itself. */
function readEnvFile(name) {
  const file = path.join(repoRoot, name);
  if (!existsSync(file)) return {};
  const values = {};
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (match) values[match[1]] = match[2].replace(/^["']|["']$/g, "");
  }
  return values;
}

// Precedence matches the server: shell > .env.local > .env.
const fileEnv = { ...readEnvFile(".env"), ...readEnvFile(".env.local") };
const env = {
  ...fileEnv,
  ...process.env,
  NODE_ENV: "development",
  SCHOLARAIO_HUB_PROFILE: process.env.SCHOLARAIO_HUB_PROFILE ?? "dev",
};
const host = env.HOST || "127.0.0.1";
const appPort = parsePort(env.PORT, 3500);
const clientPort = parsePort(env.CLIENT_PORT, appPort + 1);
env.PORT = String(appPort);
env.CLIENT_PORT = String(clientPort);
const dataDir =
  env.SCHOLARAIO_HUB_DATA_DIR ||
  path.join(
    os.homedir(),
    env.SCHOLARAIO_HUB_PROFILE === "production"
      ? ".scholaraio-hub"
      : `.scholaraio-hub-${env.SCHOLARAIO_HUB_PROFILE}`,
  );

function parsePort(value, fallback) {
  const port = Number.parseInt(value ?? "", 10);
  return Number.isInteger(port) && port > 0 && port < 65536 ? port : fallback;
}

const colors = { server: "\x1b[36m", client: "\x1b[35m", dev: "\x1b[32m" };
const reset = "\x1b[0m";
const useColor = process.stdout.isTTY;
function log(label, message) {
  const tag = useColor ? `${colors[label]}[${label}]${reset}` : `[${label}]`;
  for (const line of String(message).split("\n")) {
    if (line.trim()) process.stdout.write(`${tag} ${line}\n`);
  }
}

function portIsFree(port) {
  return new Promise((resolve) => {
    const probe = createServer();
    probe.once("error", () => resolve(false));
    probe.listen(port, host, () => probe.close(() => resolve(true)));
  });
}

async function waitForServer(timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (stopping) return false;
    try {
      const response = await fetch(`http://${host}:${appPort}/health`, {
        signal: AbortSignal.timeout(1000),
      });
      if (response.ok) return true;
    } catch {
      // Not listening yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  return false;
}

const children = new Map();
let stopping = false;

function start(label, pnpmArgs) {
  // Own process group, so shutdown reaches tsx/vite and not only the pnpm wrapper.
  const child = spawn("pnpm", pnpmArgs, {
    cwd: repoRoot,
    env,
    stdio: ["ignore", "pipe", "pipe"],
    detached: process.platform !== "win32",
  });
  children.set(label, child);
  const forward = (chunk) => {
    // pnpm reports our own SIGTERM as a failure; hide that noise during shutdown.
    if (stopping && /ERR_PNPM|ELIFECYCLE|Command failed with signal|packages\/\w+:$/m.test(chunk))
      return;
    log(label, chunk);
  };
  child.stdout.on("data", forward);
  child.stderr.on("data", forward);
  child.on("error", (error) => {
    log(label, `无法启动：${error.message}`);
    shutdown(1);
  });
  child.on("exit", (code, signal) => {
    children.delete(label);
    if (!stopping) {
      log("dev", `${label} 已退出（${signal ?? code}），正在停止其他进程…`);
      shutdown(code ?? 1);
    } else if (children.size === 0) {
      process.exit(process.exitCode ?? 0);
    }
  });
  return child;
}

function shutdown(code = 0) {
  if (stopping) return;
  stopping = true;
  process.exitCode = code;
  if (children.size === 0) process.exit(code);
  for (const child of children.values()) {
    try {
      if (process.platform === "win32") child.kill("SIGTERM");
      else process.kill(-child.pid, "SIGTERM");
    } catch {
      // Already gone.
    }
  }
  // Last resort if a watcher ignores SIGTERM.
  setTimeout(() => {
    for (const child of children.values()) {
      try {
        process.kill(process.platform === "win32" ? child.pid : -child.pid, "SIGKILL");
      } catch {
        // Already gone.
      }
    }
    process.exit(code);
  }, 5000).unref();
}

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));

// ── Preflight ────────────────────────────────────────────────────────────────
const busy = [];
if (runServer && !(await portIsFree(appPort))) busy.push(`服务端端口 ${appPort}`);
if (runClient && !(await portIsFree(clientPort))) busy.push(`前端端口 ${clientPort}`);
if (busy.length) {
  log("dev", `${busy.join("、")} 已被占用。停止已有的开发进程，或用 PORT=xxxx pnpm dev 换端口。`);
  process.exit(1);
}
if (runServer) {
  const python = path.join(
    dataDir,
    "runtime/python",
    process.platform === "win32" ? "Scripts/python.exe" : "bin/python",
  );
  // The server refuses to start without the Python library runtime.
  if (!existsSync(python)) {
    log("dev", `未找到文献运行环境：${python}\n请先运行 pnpm run setup。`);
    process.exit(1);
  }
}

log("dev", `数据目录 ${dataDir}`);

// ── Start ────────────────────────────────────────────────────────────────────
if (runServer) {
  start("server", ["--filter", "@scholaraio-hub/server", "dev"]);
  if (runClient) {
    log("dev", "等待服务端就绪…");
    if (!(await waitForServer())) {
      if (!stopping) log("dev", `服务端 60 秒内未响应 http://${host}:${appPort}/health`);
      shutdown(1);
    }
  }
}
if (runClient && !stopping) start("client", ["--filter", "@scholaraio-hub/client", "dev"]);
if (!stopping) {
  if (runServer) log("dev", `API    http://${host}:${appPort}`);
  if (runClient) log("dev", `前端   http://${host}:${clientPort}   （Ctrl+C 同时停止）`);
}
