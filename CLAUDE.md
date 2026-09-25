# scholaraio-hub — Agent Guide

A `pnpm` workspace monorepo: a local, single-user hub that pairs a literature library with
coding-agent sessions (Claude Agent SDK, Codex). This file is a thin index — detailed,
path-scoped rules live in `.claude/`.

## Project map

- `packages/client` — Vite + React 19 frontend (`src/`).
- `packages/server` — Hono API (`src/routes/`), session supervision (`src/supervisor/`),
  provider integrations (`src/providers/`, one directory per provider), runtime profile and Python environment
  (`src/runtime/`), commands behind `pnpm hub` (`src/cli/`).
- `packages/shared` — types, Zod schemas, profile/port rules consumed by both apps.
- `packages/scholaraio` — the Python library service the server runs as a sidecar
  (`scholaraio/hub/`, `interfaces/api/`); the rest is upstream code (`UPSTREAM.md`).
- `e2e/` — Playwright tests · `scripts/` — the `hub.mjs` entry and CI helpers · `docs/` —
  human technical docs · `.design/DESIGN.md` —
  UI source of truth.

## Commands (run from repo root)

- `pnpm dev` — development on one port (3500): the server, with Vite serving the client
- `pnpm build` then `pnpm start` — production (3400) from the built server and client
- `pnpm hub setup|doctor|migrate|skills-sync` — Python runtime, diagnostics, migration,
  skills; any command takes `--production` or `--profile <name>`
- `pnpm lint` / `pnpm lint:fix` — Biome check / autofix
- `pnpm typecheck` — TypeScript across all packages
- `pnpm test` — `shared` + `server` + `client` Vitest suites; `pnpm test:python` — Python
- `pnpm test:e2e` — build client + run Playwright (`e2e/`)
- `pnpm ci:local` — the full CI gate locally (mirrors `.github/workflows/ci.yml`)

## Cross-cutting rules (apply everywhere)

- **Formatting (Biome)**: 2-space indent, double quotes, semicolons, trailing commas,
  100-col width. Run `pnpm lint:fix` before a PR.
- **No bypass comments**: never use ignore comments to silence type/lint/logic errors —
  fix the cause.
- **Naming**: `PascalCase` files for classes (`SessionStore.ts`), kebab-case for other
  modules and scripts; `camelCase` for functions. Rename a file when you are changing it
  anyway, not in bulk.
- **Single source of truth**: don't restate volatile facts. The profile decides data
  directory and port (`packages/shared/src/ports.ts`, `packages/server/src/runtime/profile.ts`);
  env vars are documented in `.env.example` (review `packages/server/src/config.ts` /
  `env.ts` before adding new ones).
- **Reachable, not merely tested**: code no production path reaches is dead even when
  tests exercise it — delete it with its tests instead of keeping it "for later".
- **Resource release**: anything that acquires a resource (timer, listener, subscription,
  watcher, handle) must declare its release path at the point of creation.
- **Verify locally, don't push-and-pray**: run `pnpm ci:local` before pushing. Remote CI
  is a safety net, not your edit-test loop. See `.claude/topics/ci-and-local-verification.md`.

## Testing

Name tests `*.test.ts(x)` under the owning package: `server`/`shared` use a `test/` dir;
`client` co-locates tests in a sibling `__tests__/` dir (e.g.
`packages/client/src/core/__tests__/library.test.ts`). Browser e2e lives in repo-root
`e2e/` (`pnpm test:e2e`); `packages/server` has its own Vitest e2e
(`pnpm --filter @scholaraio-hub/server test:e2e`, plus `test:e2e:real` gated by
`REAL_SDK_TESTS`/`FOREGROUND`).

## Commits & PRs

Keep subjects short, imperative, specific (e.g. `Add codex session pagination`). The
commit-msg hook (`scripts/check-commit-message.mjs`) rejects AI *attribution* — phrases
like "generated/co-authored by/with AI", `Co-Authored-By:` trailers naming an AI tool, the
🤖 emoji, and links like `Generated with [Claude Code]` — but plain provider mentions are
fine. PRs: brief summary, linked issue/spec, test evidence, screenshots for UI; call out
`PORT` / `SCHOLARAIO_HUB_*` changes.

## Detailed specs (in `.claude/`)

Path-scoped rules load automatically when you work in the matching package:

- **Client code** → `.claude/rules/client.md` (React resources, imperative D3/Canvas,
  shared derived data, UI)
- **Server code** → `.claude/rules/server.md` (error handling, resource quiescence,
  idempotency, session identity, env isolation, codex audit gate)
- **Shared code** → `.claude/rules/shared.md` (single source of truth, import discipline)
- **Python library service** → `.claude/rules/python.md` (layering, thin controllers)

Read on demand:

- **Domain terms** → `.claude/glossary.md`
- **Deep dives** → `.claude/topics/` — session-state, resource-lifecycle, agent-rendering,
  frontend-skills, ci-and-local-verification
