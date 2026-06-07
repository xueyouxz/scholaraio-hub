import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Local mirror of .github/workflows/ci.yml. Keep this in lock-step with that
// workflow so "what CI runs" == "what you can run before pushing". The whole
// point: never use remote CI as your edit-test loop — surface failures here.
//
// Usage:
//   pnpm ci:local            # blocking gate: lint, typecheck, test (+ server e2e), e2e
//   pnpm ci:local --audit    # also run the (non-blocking) prod dependency audit

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = new Set(process.argv.slice(2));
const withAudit = args.has("--audit");

/** One CI job, mapped to its local command. `blocking: false` mirrors a
 *  `continue-on-error` job — it runs and reports but never fails the gate. */
const steps = [
  { name: "lint", cmd: "pnpm", argv: ["lint"] },
  { name: "typecheck", cmd: "pnpm", argv: ["typecheck"] },
  { name: "test", cmd: "pnpm", argv: ["test"] },
  {
    name: "server e2e",
    cmd: "pnpm",
    argv: ["--filter", "@scholaraio-hub/server", "test:e2e"],
  },
  { name: "e2e", cmd: "pnpm", argv: ["test:e2e"] },
];

if (withAudit) {
  steps.push({ name: "audit", cmd: "pnpm", argv: ["audit:prod"], blocking: false });
}

const results = [];
let failed = false;

for (const step of steps) {
  const blocking = step.blocking !== false;
  process.stdout.write(`\n▶ ${step.name}: ${step.cmd} ${step.argv.join(" ")}\n`);
  const { status } = spawnSync(step.cmd, step.argv, { cwd: repoRoot, stdio: "inherit" });
  const ok = status === 0;
  results.push({ name: step.name, ok, blocking });
  if (!ok && blocking) {
    failed = true;
    break; // fail fast, like a gating CI job
  }
}

process.stdout.write("\n── summary ──\n");
for (const r of results) {
  const mark = r.ok ? "✓" : r.blocking ? "✗" : "⚠ (non-blocking)";
  process.stdout.write(`  ${mark} ${r.name}\n`);
}

process.exit(failed ? 1 : 0);
