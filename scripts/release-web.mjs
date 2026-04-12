import { spawnSync } from "node:child_process";

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    stdio: "inherit",
    ...options,
  });

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

run("pnpm", ["build"]);

if (!process.env.DEPLOY_WEB_COMMAND) {
  console.log(
    "Build complete. Set DEPLOY_WEB_COMMAND to publish the built website with this script.",
  );
  process.exit(0);
}

const deployResult = spawnSync(process.env.DEPLOY_WEB_COMMAND, {
  stdio: "inherit",
  shell: true,
});

process.exit(deployResult.status ?? 1);
