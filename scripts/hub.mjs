import { spawn } from "node:child_process";
const [command, ...args] = process.argv.slice(2);
const production = command === "start" || args.includes("--production");
const nodeArgs =
  command === "start"
    ? ["--filter", "@scholaraio-hub/server", "start"]
    : [
        "--filter",
        "@scholaraio-hub/server",
        "exec",
        "tsx",
        "--conditions",
        "source",
        "src/tools.ts",
        command,
        ...args,
      ];
const child = spawn("pnpm", nodeArgs, {
  stdio: "inherit",
  env: {
    ...process.env,
    NODE_ENV: production ? "production" : "development",
    SCHOLARAIO_HUB_PROFILE: production ? "production" : "dev",
  },
});
const stop = (signal) => child.kill(signal);
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
child.on("error", (error) => {
  console.error(error);
  process.exitCode = 1;
});
child.on("exit", (code) => {
  process.off("SIGINT", stop);
  process.off("SIGTERM", stop);
  process.exitCode = code ?? 0;
});
