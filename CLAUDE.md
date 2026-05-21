# Repository Guidelines

## Project Structure & Module Organization

This repository is a `pnpm` workspace monorepo. Main packages live under `packages/`:

- `packages/client`: Vite frontend entrypoints in `src/`
- `packages/server`: Hono-based API, session supervision, watchers, and provider integrations in `src/`
- `packages/shared`: shared types, schemas, ports, and helpers consumed by both apps

End-to-end tests live in `e2e/`. Package-level tests live beside each package under `test/`. Build and release utilities are in `scripts/`. Generated protocol code under `packages/server/src/sdk/providers/codex-protocol/generated/` should be treated as generated output.

## Build, Test, and Development Commands

Run all commands from the repo root:

- `pnpm install`: install workspace dependencies and Husky hooks
- `pnpm dev`: start server and client in parallel
- `pnpm build`: build `shared`, then `server`, then `client`
- `pnpm lint`: run Biome checks across the workspace
- `pnpm lint:fix`: apply Biome formatting and safe fixes
- `pnpm typecheck`: run TypeScript checks for all packages
- `pnpm test`: run shared and server Vitest suites
- `pnpm test:e2e`: build the client and run Playwright smoke tests

## Coding Style & Naming Conventions

TypeScript uses Biome formatting: 2-space indentation, double quotes, semicolons, trailing commas, and 100-column line width. Use `pnpm lint:fix` before opening a PR.

Do not use ignore comments to bypass type, linting, or logic errors. All issues must be addressed properly through code fixes, improved typing, or global configuration adjustments.

Match existing naming patterns: `PascalCase` for classes and schema files such as `SessionIndexService.ts`, `camelCase` for functions, and kebab-case for top-level scripts like `release-web.mjs`. Prefer small modules under the relevant package instead of cross-package imports that bypass `@scholaraio-hub/shared`.

For frontend component work and UI implementation, always follow the style design specification documented in `.design/DESIGN.md`. Treat that file as the source of truth for visual and interaction design decisions instead of redefining design rules inline.

## Testing Guidelines

Vitest is used for unit and integration tests; Playwright covers app smoke flows. Name tests `*.test.ts` and keep them under the owning package, for example `packages/server/test/routes/settings.test.ts`. Add or update tests for behavior changes in routes, session parsing, shared schemas, and port logic.

## Commit & Pull Request Guidelines

Keep commit subjects short, imperative, and specific, for example `Add codex session pagination`. The commit-msg hook rejects AI-related wording such as `AI`, `GPT`, `Claude`, or `Codex` in commit messages.

PRs should include a brief summary, linked issue or spec when applicable, test evidence (`pnpm test`, `pnpm test:e2e`, etc.), and screenshots for UI changes. Call out config or env-var changes explicitly, especially anything affecting `PORT`, `CLIENT_PORT`, or `SCHOLARAIO_HUB_*`.

## Security & Configuration Tips

Use `.env.local` for local overrides and avoid committing secrets. Default ports are derived from `PORT` via shared logic in `packages/shared/src/ports.ts`; keep server and client port changes aligned. Review `packages/server/src/config.ts` before adding new environment variables.

## Runtime & Resource Management

Any code that acquires a resource — timers, intervals, event listeners, subscriptions, open file handles, or database connections — must document its release path at the point of creation, not as an afterthought. In React, resources created outside `useEffect` must store their handle in a `useRef` and be cleaned up in a `useEffect` return function. Bare `setInterval` or `addEventListener` calls outside of `useEffect` are never acceptable.

Guard clauses that check a precondition must exit before the work begins. A check followed by a log that does not return is not a guard — it is a comment. Functions that are expected to be idempotent (file already built, job already running) must enforce that contract with an early return, not an informational message.

## Error Handling

API endpoints must not convert exceptions into degraded-but-successful responses (e.g., returning `{ built: false }` when a file exists but fails to parse). Distinguish between "resource does not exist" (return empty/false state) and "resource exists but is unreadable" (return a 500 with a diagnostic message). Silent `except: pass` and bare `.catch(() => {})` are prohibited; at minimum, log the error with enough context to diagnose it.

## Imperative Rendering (Canvas / D3)

Components that use canvas or imperative rendering libraries (D3, WebGL, Three.js) must isolate their internal state from React's reactivity system. D3 scales, selections, zoom transforms, quadtrees, and animation frames are not React state and must not appear in `useMemo` dependency arrays or `useCallback` deps beyond the initial setup effect. The correct boundary is: React owns data props; the imperative layer owns its own render lifecycle. Wire them together with a single `useEffect` that calls an `update(data)` method. Mixing both models in the same component causes cascade invalidation on every render.

## Shared Derived Data

Data derived from a common source and consumed by sibling components must be computed once at the nearest common ancestor and passed down as a prop. Recomputing the same derivation independently in each consumer (e.g., color maps, filtered sets, aggregated counts) creates divergence risk and wastes CPU. If the derivation is expensive, memoize it at the ancestor; if it is cheap, it is still the ancestor's responsibility.

## Idempotency for Background Jobs

Functions that perform offline computation and persist results to disk must answer the question "is the output already up to date?" before doing any work, and return the existing result if so. This check belongs in the function itself, not in the caller. Job runners that submit these functions must additionally check whether a job of the same kind is already queued or running before enqueuing a new one. UI controls that trigger jobs must be disabled while any job of that kind is in a pending/running state.
