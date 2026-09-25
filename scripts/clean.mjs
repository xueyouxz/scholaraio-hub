import { existsSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");

const allTargets = [
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

// `node scripts/clean.mjs server` cleans one package, as its build does first:
// tsc never removes output whose source was deleted, and with its build info
// kept it would think an emptied dist is still up to date.
const only = process.argv[2];
const targets = only
  ? allTargets.filter((target) => target.startsWith(`packages/${only}/`))
  : allTargets;

for (const relativeTarget of targets) {
  const absoluteTarget = path.join(repoRoot, relativeTarget);

  if (!existsSync(absoluteTarget)) {
    continue;
  }

  rmSync(absoluteTarget, { force: true, recursive: true });
  if (!only) console.log(`Removed ${relativeTarget}`);
}
