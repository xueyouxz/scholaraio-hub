# Contributing to scholaraio-hub

## Prerequisites

- Node.js `>= 20`
- pnpm `>= 10.27.0`

Enable pnpm if not already available:

```bash
corepack enable
```

## First-time setup

```bash
git clone https://github.com/xueyouxz/scholaraio-hub.git
cd scholaraio-hub
pnpm install
cp .env.example .env.local
```

Install Playwright for E2E tests (one-time):

```bash
pnpm exec playwright install chromium
```

## Development

Start the dev server:

```bash
pnpm dev
```

The API runs on `http://localhost:3400` and the Vite dev server on `http://localhost:3401`.

## Code style

This project uses [Biome](https://biomejs.dev/) for formatting and linting. Run before opening a PR:

```bash
pnpm lint:fix
```

The pre-commit hook runs `lint-staged` automatically on changed files.

## Testing

Unit and integration tests:

```bash
pnpm test
```

End-to-end tests (builds client first):

```bash
pnpm test:e2e
```

All tests must pass before a PR can be merged.

## Commit messages

Keep commit subjects short (under 72 characters), imperative, and specific:

```
Add session pagination for Codex provider
Fix scatter plot tooltip positioning on resize
```

Avoid vague subjects like `Fix bug` or `Update code`.

## Pull request flow

1. Fork the repo and create a branch from `main`
2. Make your changes with appropriate tests
3. Run `pnpm lint:fix && pnpm typecheck && pnpm test`
4. Open a PR with a brief description of what changed and why
5. Include screenshots for any UI changes
6. Call out any new environment variables or config changes

## Project structure

```
packages/
  client/   # Vite + React frontend
  server/   # Hono API, session supervision, watchers
  shared/   # Shared types, schemas, port logic
scripts/    # Build and dev utilities
e2e/        # Playwright smoke tests
```
