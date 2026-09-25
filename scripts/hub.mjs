// The one entry point behind the root scripts, handing over to the launcher
// in packages/cli:
//
//   pnpm dev                                development, profile dev
//   pnpm start                              the built server, profile production
//   pnpm hub <command> [args]               setup | doctor | migrate | skills-sync
//
// `pnpm dev` and `pnpm start` run the library service and the server side by
// side. `--production` or `--profile <name>` picks another profile for any of
// them; otherwise SCHOLARAIO_HUB_PROFILE, then the command's default, applies.
// The profile decides the data directory and ports (packages/cli/src/profile.ts).
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cliDir = path.join(repoRoot, "packages/cli");

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
const env = { ...process.env };
if (profile) env.SCHOLARAIO_HUB_PROFILE = profile;

// The launcher runs from source, so it never depends on a stale build.
const tsx = createRequire(path.join(cliDir, "package.json")).resolve("tsx/cli");
const child = spawn(
  process.execPath,
  [tsx, "--conditions", "scholaraio-source", "src/index.ts", ...args],
  { cwd: cliDir, env, stdio: "inherit" },
);

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
