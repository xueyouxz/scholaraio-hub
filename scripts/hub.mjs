// The one entry point behind the root scripts:
//
//   pnpm dev [--server | --client]          development, profile dev
//   pnpm start                              the built server, profile production
//   pnpm hub <command> [args]               setup | doctor | migrate | skills-sync
//
// `--production` or `--profile <name>` picks another profile for any of them;
// otherwise SCHOLARAIO_HUB_PROFILE, then the command's default, applies. The
// profile decides the data directory and port (packages/server/src/runtime/profile.ts).
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const serverDir = path.join(repoRoot, "packages/server");

const args = process.argv.slice(2);
let profile;
for (let index = 0; index < args.length; ) {
  if (args[index] === "--production") {
    profile = "production";
    args.splice(index, 1);
  } else if (args[index] === "--profile" && args[index + 1] && !args[index + 1].startsWith("-")) {
    profile = args[index + 1];
    args.splice(index, 2);
  } else index += 1;
}
const [command] = args;
const env = { ...process.env };
if (profile) env.SCHOLARAIO_HUB_PROFILE = profile;

let child;
if (command === "start") {
  const entry = path.join(serverDir, "dist/index.js");
  if (!existsSync(entry)) {
    console.error("未找到构建产物，请先运行 pnpm build。");
    process.exit(1);
  }
  env.SCHOLARAIO_HUB_PROFILE ??= "production";
  env.NODE_ENV = "production";
  child = spawn(process.execPath, [entry], { cwd: serverDir, env, stdio: "inherit" });
} else {
  // Everything else runs from source, so it never depends on a stale build.
  const tsx = createRequire(path.join(serverDir, "package.json")).resolve("tsx/cli");
  child = spawn(
    process.execPath,
    [tsx, "--conditions", "scholaraio-source", "src/cli/index.ts", ...args],
    { cwd: serverDir, env, stdio: "inherit" },
  );
}

const interrupt = () => child.kill("SIGINT");
const terminate = () => child.kill("SIGTERM");
process.on("SIGINT", interrupt);
process.on("SIGTERM", terminate);
child.on("error", (error) => {
  console.error(error);
  process.exitCode = 1;
});
child.on("exit", (code, signal) => {
  process.off("SIGINT", interrupt);
  process.off("SIGTERM", terminate);
  process.exitCode = code ?? (signal ? 1 : 0);
});
