import { type ChildProcess, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { createServer } from "node:net";
import { fileURLToPath } from "node:url";
import { resolveDerivedPorts } from "@scholaraio-hub/shared";
import { loadRuntimeEnv } from "../env.js";
import { resolveProfile } from "../runtime/profile.js";
import { pythonRuntime } from "../runtime/python.js";

const serverDir = fileURLToPath(new URL("../../", import.meta.url));
const repoRoot = fileURLToPath(new URL("../../../../", import.meta.url));
const tsxCli = createRequire(import.meta.url).resolve("tsx/cli");

const colors: Record<string, string> = { server: "\x1b[36m", client: "\x1b[35m", dev: "\x1b[32m" };
const useColor = process.stdout.isTTY;

function log(label: string, message: string): void {
  const tag = useColor ? `${colors[label]}[${label}]\x1b[0m` : `[${label}]`;
  for (const line of message.split("\n")) {
    if (line.trim()) process.stdout.write(`${tag} ${line}\n`);
  }
}

function portIsFree(port: number, host: string): Promise<boolean> {
  return new Promise((resolve) => {
    const probe = createServer();
    probe.once("error", () => resolve(false));
    probe.listen(port, host, () => probe.close(() => resolve(true)));
  });
}

/**
 * Development launcher: the server under `tsx watch` and the Vite client.
 *
 *   pnpm dev            server + client (client starts once the server is healthy)
 *   pnpm dev --server   server only
 *   pnpm dev --client   client only (proxies /api to an already running server)
 *
 * Both get the ports and data directory the profile resolves to. Output is
 * prefixed per process; stopping either (or Ctrl+C) stops the other.
 */
export async function dev(args: string[]): Promise<number> {
  const runServer = !args.includes("--client");
  const runClient = !args.includes("--server");
  process.env.NODE_ENV = "development";
  // Env files fill process.env once, here; the children inherit the result.
  loadRuntimeEnv();
  const profile = resolveProfile(process.env);
  const host = process.env.HOST || "127.0.0.1";
  const ports = resolveDerivedPorts(process.env);
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    SCHOLARAIO_HUB_PROFILE: profile.name,
    PORT: String(ports.app),
    CLIENT_PORT: String(ports.client),
  };

  const busy: string[] = [];
  if (runServer && !(await portIsFree(ports.app, host))) busy.push(`服务端端口 ${ports.app}`);
  if (runClient && !(await portIsFree(ports.client, host))) busy.push(`前端端口 ${ports.client}`);
  if (busy.length) {
    log("dev", `${busy.join("、")} 已被占用。停止已有的开发进程，或用 PORT=xxxx pnpm dev 换端口。`);
    return 1;
  }
  const python = pythonRuntime(profile.dataDir).executable;
  if (runServer && !existsSync(python)) {
    // The server refuses to start without the Python library runtime.
    log("dev", `未找到文献运行环境：${python}\n请先运行 pnpm hub setup。`);
    return 1;
  }
  log("dev", `profile ${profile.name}，数据目录 ${profile.dataDir}`);

  const children = new Map<string, ChildProcess>();
  let stopping = false;
  let exitCode = 0;
  let resolveDone: (code: number) => void = () => {};
  const done = new Promise<number>((resolve) => {
    resolveDone = resolve;
  });

  const shutdown = (code: number) => {
    if (stopping) return;
    stopping = true;
    exitCode = code;
    if (children.size === 0) return resolveDone(code);
    for (const child of children.values()) signal(child, "SIGTERM");
    // Last resort if a watcher ignores SIGTERM.
    setTimeout(() => {
      for (const child of children.values()) signal(child, "SIGKILL");
      resolveDone(code);
    }, 5000).unref();
  };

  const start = (label: string, command: string, commandArgs: string[], cwd: string) => {
    // Own process group, so shutdown reaches the watcher's children too.
    const child = spawn(command, commandArgs, {
      cwd,
      env,
      stdio: ["ignore", "pipe", "pipe"],
      detached: process.platform !== "win32",
    });
    children.set(label, child);
    const forward = (chunk: Buffer) => {
      const text = chunk.toString();
      // pnpm reports our own SIGTERM as a failure; hide that noise during shutdown.
      if (stopping && /ERR_PNPM|ELIFECYCLE|Command failed with signal|packages\/\w+:$/m.test(text))
        return;
      log(label, text);
    };
    child.stdout?.on("data", forward);
    child.stderr?.on("data", forward);
    child.on("error", (error) => {
      log(label, `无法启动：${error.message}`);
      shutdown(1);
    });
    child.on("exit", (code, exitSignal) => {
      children.delete(label);
      if (!stopping) {
        log("dev", `${label} 已退出（${exitSignal ?? code}），正在停止其他进程…`);
        shutdown(code ?? 1);
      } else if (children.size === 0) {
        resolveDone(exitCode);
      }
    });
  };

  const onSignal = () => shutdown(0);
  process.on("SIGINT", onSignal);
  process.on("SIGTERM", onSignal);

  if (runServer) {
    start(
      "server",
      process.execPath,
      [tsxCli, "watch", "--conditions", "scholaraio-source", "src/index.ts"],
      serverDir,
    );
    if (runClient) {
      log("dev", "等待服务端就绪…");
      if (!(await waitForServer(`http://${host}:${ports.app}/health`, () => stopping))) {
        if (!stopping) log("dev", `服务端 60 秒内未响应 http://${host}:${ports.app}/health`);
        shutdown(1);
      }
    }
  }
  if (runClient && !stopping)
    start("client", "pnpm", ["--filter", "@scholaraio-hub/client", "dev"], repoRoot);
  if (!stopping) {
    if (runServer) log("dev", `API    http://${host}:${ports.app}`);
    if (runClient) log("dev", `前端   http://${host}:${ports.client}   （Ctrl+C 同时停止）`);
  }
  const code = await done;
  process.off("SIGINT", onSignal);
  process.off("SIGTERM", onSignal);
  return code;
}

function signal(child: ChildProcess, name: NodeJS.Signals): void {
  if (child.pid === undefined) return;
  try {
    if (process.platform === "win32") child.kill(name);
    else process.kill(-child.pid, name);
  } catch (error) {
    // ESRCH: the group already exited between our check and the signal.
    if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
  }
}

async function waitForServer(url: string, stopped: () => boolean): Promise<boolean> {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (stopped()) return false;
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(1000) });
      if (response.ok) return true;
    } catch {
      // Not listening yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  return false;
}
