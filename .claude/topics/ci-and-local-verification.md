# CI & Local Verification

> On-demand deep dive. Referenced by the root [`CLAUDE.md`](../../CLAUDE.md).
> Read before changing `.github/workflows/`, the local CI script, or any cross-package
> build wiring.

## The pipeline

- **`.github/workflows/ci.yml`** (every PR + push to `main`): `lint`, `typecheck`,
  `test` (+ the `packages/server` Vitest e2e layer), `e2e` (Playwright), and a
  non-blocking `audit`. A reusable composite action (`.github/actions/setup`) installs
  pnpm (version from the root `packageManager`) + Node + deps so the toolchain lives in
  one place.
- **`pnpm ci:local`** (`scripts/ci-local.mjs`): local mirror of `ci.yml`. Keep the two in
  lock-step — when you add/remove a CI job, update the script. `--audit` adds the
  dependency audit.

There is **no release/publish workflow**. The app is run directly with Node
(`pnpm build && pnpm --filter @scholaraio-hub/server start`); the server serves both the
API and the built client from one process. No npm package, no container image.

## Working rule: verify locally, don't push-and-pray

Remote CI is a safety net, not your edit-test loop. Before pushing, run `pnpm ci:local`.
One local run catches almost everything; a chain of "push → wait → read one red job →
fix → push" does not, and it poisons `main` and every open PR if a broken commit merges
first.

**Enabling a gate that was never enforced is a migration.** A test suite that CI never
ran has silently drifted from the app. The first time you turn it on, *expect* accumulated
breakage — run the whole thing locally, enumerate every failure, and fix them as one batch
instead of discovering them one CI round at a time.

> Note: `pnpm ci:local` lints your working tree, including untracked files; CI lints a
> clean checkout. Keep the worktree clean so the two agree.

## Failure modes this repo has actually hit

Real regressions the pipeline surfaced — check for them when builds break:

1. **`shared` not built before a consumer.** The client `vite build` and the server
   `tsc` both resolve `@scholaraio-hub/shared` through its emitted `dist/` (server
   `tsconfig` `paths` → `../../packages/shared/dist/index.d.ts`). Any job/stage that
   builds a consumer must build `shared` first. Each CI job is a fresh runner — a `dist`
   built in one job does not carry to another.
2. **`composite: true` + stale `*.tsbuildinfo` → skipped emit.** `tsc` will exit 0
   without emitting if it thinks it is up to date. Deleting only `dist/` (not the
   `.tsbuildinfo`) reproduces "build succeeds but `dist/index.js` is missing". When in
   doubt, delete both.
3. **Stale e2e expectations.** A suite that never ran in CI drifts: hardcoded version
   strings (pin to the package version instead) and removed nav items. Derive
   expectations from the source of truth, don't hardcode volatile values.

## Keeping things in sync

- Pinned pnpm version: **only** in the root `package.json` `packageManager` field.
- CI jobs ↔ `scripts/ci-local.mjs`: add/remove in both.
