import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { createServer } from "node:net";
import { fileURLToPath } from "node:url";
import { currentProfile } from "../runtime/profile.js";
import { pythonRuntime } from "../runtime/python.js";

const serverDir = fileURLToPath(new URL("../../", import.meta.url));
const tsxCli = createRequire(import.meta.url).resolve("tsx/cli");

function portIsFree(port: number, host: string): Promise<boolean> {
  return new Promise((resolve) => {
    const probe = createServer();
    probe.once("error", () => resolve(false));
    probe.listen(port, host, () => probe.close(() => resolve(true)));
  });
}

/**
 * Development: the server under `tsx watch`, serving the client through Vite
 * on its own port (src/frontend/dev.ts). Checks first what would otherwise
 * fail later with a less direct message: the port and the Python runtime.
 */
export async function dev(): Promise<number> {
  process.env.NODE_ENV = "development";
  // Env files fill process.env once, here; the server inherits the result.
  const profile = currentProfile();
  const host = process.env.HOST || "127.0.0.1";

  if (!(await portIsFree(profile.port, host))) {
    console.error(
      `端口 ${profile.port} 已被占用。停止已有的 Hub（pnpm hub doctor 可查看），或用 PORT=xxxx pnpm dev 换端口。`,
    );
    return 1;
  }
  const python = pythonRuntime(profile.dataDir).executable;
  if (!existsSync(python)) {
    console.error(`未找到文献运行环境：${python}\n请先运行 pnpm hub setup。`);
    return 1;
  }
  console.log(`profile ${profile.name}，数据目录 ${profile.dataDir}`);
  console.log(`打开 http://${host}:${profile.port}   （Ctrl+C 停止）`);

  const child = spawn(
    process.execPath,
    [tsxCli, "watch", "--conditions", "scholaraio-source", "src/index.ts"],
    {
      cwd: serverDir,
      env: { ...process.env, SCHOLARAIO_HUB_PROFILE: profile.name },
      stdio: "inherit",
    },
  );
  // Ctrl+C reaches the whole foreground group; forward a SIGTERM from a parent.
  const forward = (signal: NodeJS.Signals) => () => child.kill(signal);
  const onInt = forward("SIGINT");
  const onTerm = forward("SIGTERM");
  process.on("SIGINT", onInt);
  process.on("SIGTERM", onTerm);
  return new Promise((resolve) => {
    child.once("error", (error) => {
      console.error(`无法启动服务端：${error.message}`);
      resolve(1);
    });
    child.once("exit", (code, signal) => {
      process.off("SIGINT", onInt);
      process.off("SIGTERM", onTerm);
      resolve(code ?? (signal === "SIGINT" || signal === "SIGTERM" ? 0 : 1));
    });
  });
}
