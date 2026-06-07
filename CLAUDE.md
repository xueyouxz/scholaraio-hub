# scholaraio-hub — Agent Guide

A `pnpm` workspace monorepo: a self-hosted hub for supervising coding-agent providers
(Claude Agent SDK, Codex). This file is a thin index — detailed, path-scoped rules live in
`.claude/`.

## Project map

- `packages/client` — Vite + React 19 frontend (`src/`).
- `packages/server` — Hono API, session supervision (`src/supervisor/`), file watchers
  (`src/watcher/`), subscriptions (`src/subscriptions.ts`), provider integrations
  (`src/sdk/providers/`).
- `packages/shared` — types, Zod schemas, ports, helpers consumed by both apps.
- `e2e/` — Playwright smoke tests · `scripts/` — build/release utils · `docs/` — human
  technical docs · `.design/DESIGN.md` — UI source of truth.

## Commands (run from repo root)

- `pnpm dev` — server + client in parallel
- `pnpm build` — build `shared` → `server` → `client`
- `pnpm lint` / `pnpm lint:fix` — Biome check / autofix
- `pnpm typecheck` — TypeScript across all packages
- `pnpm test` — `shared` + `server` + `client` Vitest suites
- `pnpm test:e2e` — build client + run Playwright (`e2e/`)
- `pnpm ci:local` — run the full CI gate locally (mirrors `.github/workflows/ci.yml`);
  `pnpm ci:local --audit` also runs the dependency audit

## Cross-cutting rules (apply everywhere)

- **Formatting (Biome)**: 2-space indent, double quotes, semicolons, trailing commas,
  100-col width. Run `pnpm lint:fix` before a PR.
- **No bypass comments**: never use ignore comments to silence type/lint/logic errors —
  fix the cause.
- **Naming**: `PascalCase` for classes/schema files (`SessionIndexService.ts`),
  `camelCase` for functions, kebab-case for top-level scripts (`release-web.mjs`).
- **Single source of truth**: don't restate volatile facts. Ports derive from
  `packages/shared/src/ports.ts`; env vars are documented in `.env.example` (review
  `packages/server/src/config.ts` / `env.ts` before adding new ones).
- **Resource release**: anything that acquires a resource (timer, listener, subscription,
  watcher, handle) must declare its release path at the point of creation.
- **Verify locally, don't push-and-pray**: run `pnpm ci:local` before pushing. Remote CI
  is a safety net, not your edit-test loop. Turning on a gate that was never enforced (a
  test suite) is a *migration*: expect it to surface accumulated drift, so run everything
  locally first and fix the failures as one batch. See `.claude/topics/ci-and-local-verification.md`.

## Testing

Name tests `*.test.ts(x)` under the owning package: `server`/`shared` use a `test/` dir;
`client` co-locates tests in a sibling `__tests__/` dir (e.g.
`packages/client/src/core/__tests__/api.test.ts`). Two e2e layers: repo-root `e2e/`
Playwright (`pnpm test:e2e`) and `packages/server`'s Vitest suite
(`pnpm --filter @scholaraio-hub/server test:e2e`, plus `test:e2e:real` gated by
`REAL_SDK_TESTS`/`FOREGROUND`).

## Commits & PRs

Keep subjects short, imperative, specific (e.g. `Add codex session pagination`). The
commit-msg hook (`scripts/check-commit-message.mjs`) rejects AI *attribution* — phrases
like "generated/co-authored by/with AI", `Co-Authored-By:` trailers naming an AI tool, the
🤖 emoji, and links like `Generated with [Claude Code]` — but plain provider mentions are
fine. PRs: brief summary, linked issue/spec, test evidence, screenshots for UI; call out
`PORT` / `CLIENT_PORT` / `SCHOLARAIO_HUB_*` changes.

**Running it**: the server serves both the API and the built client from one process —
`pnpm build && pnpm --filter @scholaraio-hub/server start` (or `pnpm dev` for watch mode).
There is no container/registry release; run it directly with Node.

## Detailed specs (in `.claude/`)

Path-scoped rules load automatically when you work in the matching package:

- **Client code** → `.claude/rules/client.md` (React resources, imperative D3/Canvas,
  shared derived data, UI)
- **Server code** → `.claude/rules/server.md` (error handling, resource quiescence,
  idempotency, session identity, env isolation, codex audit gate)
- **Shared code** → `.claude/rules/shared.md` (single source of truth, import discipline)

Read on demand:

- **Domain terms** → `.claude/glossary.md`
- **Deep dives** → `.claude/topics/` — provider-state-machine, session-liveness,
  resource-lifecycle, agent-rendering, ci-and-local-verification
