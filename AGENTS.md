# scholaraio-hub — Agent Guide

The one guide for every coding agent (Codex, Cursor, Copilot and Claude Code, which reads it
through `CLAUDE.md`). A `pnpm` workspace monorepo: a local, single-user hub that pairs a
literature library with coding-agent sessions (Claude Agent SDK, Codex). This file is an
index; the rules it points to live in `.claude/` and apply to every agent.

## Project map

- `packages/client` — Vite + React 19 frontend (`src/`).
- `packages/server` — Hono API (`src/routes/`), session supervision (`src/supervisor/`),
  session runs (`src/sessions/`), provider integrations (`src/providers/`, one directory per
  provider), the library service's client (`src/lib/LibraryClient.ts`).
- `packages/cli` — the launcher behind `pnpm dev` / `pnpm start` (starts the library service
  and the server side by side) and the `pnpm hub` commands; profile, env files and the
  Python runtime live here.
- `packages/shared` — types, Zod schemas, profile/port rules consumed by both apps.
- `packages/scholaraio` — the Python library service the launcher runs beside the server
  (`scholaraio/hub/`, `interfaces/api/`); the rest is upstream code (see its `README.md`).
- `e2e/` — Playwright tests · `scripts/` — the `hub.mjs` entry, CI and convention checks ·
  `docs/architecture.md` — architecture for humans · `.design/DESIGN.md` — UI source of truth.

## Commands (run from repo root)

- `pnpm dev` — development on one port: the server, with Vite serving the client
- `pnpm build` then `pnpm start` — production from the built server and client
- `pnpm hub setup|doctor|migrate|skills-sync` — Python runtime, diagnostics, migration,
  skills; any command takes `--production` or `--profile <name>`
- `pnpm lint` / `pnpm lint:fix` — Biome plus `scripts/check-conventions.mjs` / Biome autofix
- `pnpm typecheck` — TypeScript across all packages
- `pnpm gen:library-types` — regenerate the library API's OpenAPI document and TS types
- `pnpm test` — `shared` + `server` + `client` Vitest suites; `pnpm test:python` — Python
- `pnpm test:e2e` — build client + run Playwright (`e2e/`)
- `pnpm ci:local` — the full CI gate locally (mirrors `.github/workflows/ci.yml`)

Ports and data directories come from the profile; see the README table rather than
repeating numbers.

## Cross-cutting rules (apply everywhere)

- **Formatting (Biome)**: 2-space indent, double quotes, semicolons, trailing commas,
  100-col width. Run `pnpm lint:fix` before a PR.
- **No bypass comments**: never use ignore comments to silence type/lint/logic errors —
  fix the cause. `pnpm lint` rejects them.
- **Naming**: `PascalCase` files for classes and React components (`SessionStore.ts`,
  `Composer.tsx`); other modules are kebab-case in `server`/`shared`/`scripts` and
  camelCase in `client` (`libraryEvents.ts`, `useComposerDraft.ts`). `camelCase` for
  functions and variables, `UPPER_SNAKE_CASE` for module-level constants. Rename a file
  when you are changing it anyway, not in bulk.
- **Single source of truth**: don't restate volatile facts. The profile decides data
  directory and ports (`packages/shared/src/ports.ts`, `packages/cli/src/profile.ts`);
  env vars are documented in `.env.example` (review `packages/server/src/config.ts` /
  `env.ts` before adding new ones).
- **Reachable, not merely tested**: code no production path reaches is dead even when
  tests exercise it — delete it with its tests instead of keeping it "for later".
- **Resource release**: anything that acquires a resource (timer, listener, subscription,
  watcher, handle) declares its release path at the point of creation. Details:
  `.claude/topics/resource-lifecycle.md`.
- **Generated code**: never hand-edit `packages/server/src/providers/codex/protocol/generated/`
  or `packages/shared/src/generated/` (the library API types; regenerate them with
  `pnpm gen:library-types` after changing the Python response models).
- **pnpm only**: never run mutating `npm` or `yarn` commands.
- **Verify locally, don't push-and-pray**: run `pnpm ci:local` before pushing. Remote CI
  is a safety net, not your edit-test loop. See `.claude/topics/ci-and-local-verification.md`.

## Testing

Name tests `*.test.ts(x)` under the owning package: `server`/`shared` use a `test/` dir;
`client` co-locates tests in a sibling `__tests__/` dir (e.g.
`packages/client/src/core/__tests__/library.test.ts`); `pnpm lint` checks the location.
Browser e2e lives in repo-root `e2e/` (`pnpm test:e2e`). `packages/server` has its own
Vitest e2e (`pnpm --filter @scholaraio-hub/server test:e2e`); two opt-in suites talk to a
real, logged-in CLI and send model requests: `test:e2e:real` (`REAL_SDK_TESTS`, plus
`FOREGROUND=1` for live logs) and `test/e2e/workbench-real.test.ts` (`REAL_HUB_TESTS`,
`REAL_HUB_PROVIDER=claude|codex`).

## Commits & PRs

Keep subjects short, imperative, specific (e.g. `Add codex session pagination`). The
commit-msg hook (`scripts/check-commit-message.mjs`) rejects AI *attribution* — phrases
like "generated/co-authored by/with AI", `Co-Authored-By:` trailers naming an AI tool, the
🤖 emoji, and links like `Generated with [Claude Code]` — but plain provider mentions are
fine. PRs follow `.github/PULL_REQUEST_TEMPLATE.md`; call out `PORT` / `SCHOLARAIO_HUB_*`
changes.

## Package rules — read before working in a package

- **Client code** (`packages/client/**`) → `.claude/rules/client.md` (React resources,
  imperative D3/Canvas, shared derived data, UI)
- **Server code** (`packages/server/**`) → `.claude/rules/server.md` (error handling,
  resource quiescence, idempotency, session identity, env isolation, codex audit gate)
- **Shared code** (`packages/shared/**`) → `.claude/rules/shared.md` (single source of
  truth, import discipline)
- **Python library service** (`packages/scholaraio/scholaraio/hub/**`,
  `interfaces/api/**`) → `.claude/rules/python.md` (layering, thin controllers)

Read on demand:

- **Domain terms** → `.claude/glossary.md`
- **Deep dives** → `.claude/topics/` — session-state, resource-lifecycle, agent-rendering,
  frontend-skills, ci-and-local-verification
- **Frontend skills** → `.agents/skills/` (shared copy; when to use them:
  `.claude/topics/frontend-skills.md`)

## Finishing a session

When the work was one step of a larger change, end by suggesting the next logical step, so
the user keeps the overall context.
