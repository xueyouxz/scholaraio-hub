#!/usr/bin/env node
// Repository conventions that Biome and tsc do not cover, checked the same way
// for every contributor and every coding agent:
//   - no suppression comments (fix the type or lint error instead)
//   - no empty catch callbacks that swallow errors (log them with context)
//   - tests live where the package expects them (client: __tests__/, server,
//     cli and shared: test/)
//
//   node scripts/check-conventions.mjs            # every tracked file (pnpm lint)
//   node scripts/check-conventions.mjs <files…>   # just these (lint-staged, agent hooks)
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CODE = /\.(ts|tsx|js|jsx|mjs|cjs)$/;
const GENERATED = [
  "packages/server/src/providers/codex/protocol/generated/",
  "packages/shared/src/generated/",
];
// Written so that this file does not match its own patterns.
const SUPPRESSION = /@ts-(ignore|nocheck)|biome-(ignore)|eslint-(disable)/;
const EMPTY_CATCH = /\.catch\(\s*\([^)]*\)\s*=>\s*\{\s*\}/;

function relative(file) {
  return path.relative(repoRoot, path.resolve(file)).split(path.sep).join("/");
}

function testLocationProblem(file) {
  if (!/\.test\.tsx?$/.test(file)) return undefined;
  if (file.startsWith("packages/client/") && !file.includes("/__tests__/"))
    return "client tests live in a sibling __tests__/ directory (e.g. src/core/__tests__/)";
  if (/^packages\/(server|cli|shared)\//.test(file) && !file.includes("/test/"))
    return "server, cli and shared tests live under the package's test/ directory";
  return undefined;
}

function problems(file) {
  const found = [];
  const location = testLocationProblem(file);
  if (location) found.push(`${file}: ${location}`);
  if (!CODE.test(file) || GENERATED.some((prefix) => file.startsWith(prefix))) return found;
  const absolute = path.join(repoRoot, file);
  if (!existsSync(absolute)) return found;
  const lines = readFileSync(absolute, "utf8").split("\n");
  lines.forEach((line, index) => {
    if (SUPPRESSION.test(line))
      found.push(`${file}:${index + 1}: suppression comment — fix the underlying error instead`);
    if (EMPTY_CATCH.test(line))
      found.push(`${file}:${index + 1}: empty .catch() — log the error with enough context`);
  });
  return found;
}

const files =
  process.argv.length > 2
    ? process.argv.slice(2).map(relative)
    : execFileSync("git", ["ls-files"], { cwd: repoRoot, encoding: "utf8" })
        .split("\n")
        .filter(Boolean);

const found = files.flatMap(problems);
if (found.length > 0) {
  process.stderr.write(`${found.join("\n")}\n`);
  process.exit(1);
}
