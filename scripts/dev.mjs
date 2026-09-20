import { spawn } from "node:child_process";

const child = spawn(
  "pnpm",
  [
    "-r",
    "--parallel",
    "--stream",
    "--filter",
    "@scholaraio-hub/server",
    "--filter",
    "@scholaraio-hub/client",
    "dev",
  ],
  {
    stdio: "inherit",
    env: { ...process.env, NODE_ENV: "development", SCHOLARAIO_HUB_PROFILE: "dev" },
  },
);
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
