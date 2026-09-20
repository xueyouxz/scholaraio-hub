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
const interrupt = () => child.kill("SIGINT");
const terminate = () => child.kill("SIGTERM");
process.on("SIGINT", interrupt);
process.on("SIGTERM", terminate);
child.on("error", (error) => {
  console.error(error);
  process.exitCode = 1;
});
child.on("exit", (code) => {
  process.off("SIGINT", interrupt);
  process.off("SIGTERM", terminate);
  process.exitCode = code ?? 0;
});
