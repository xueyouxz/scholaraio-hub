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
