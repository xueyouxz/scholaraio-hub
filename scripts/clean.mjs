import { existsSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");

const targets = [
  "packages/client/dist",
  "packages/server/dist",
  "packages/shared/dist",
  "playwright-report",
  "test-results",
  "packages/client/tsconfig.tsbuildinfo",
  "packages/server/tsconfig.build.tsbuildinfo",
  "packages/server/tsconfig.tsbuildinfo",
  "packages/shared/tsconfig.build.tsbuildinfo",
  "packages/shared/tsconfig.tsbuildinfo",
];

for (const relativeTarget of targets) {
  const absoluteTarget = path.join(repoRoot, relativeTarget);

  if (!existsSync(absoluteTarget)) {
    continue;
  }

  rmSync(absoluteTarget, { force: true, recursive: true });
  console.log(`Removed ${relativeTarget}`);
}
