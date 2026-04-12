# Server

Standalone session-management server for local AI agent workflows.

This directory has been trimmed to the current MVP and no longer depends on the original monorepo wrapper scripts.

## What This Package Does

The server:

- discovers local Claude and Codex session roots
- exposes HTTP APIs for projects, sessions, files, processes, settings, uploads, health, and version
- supervises active session processes
- watches session files for updates
- manages install state and server settings persistence

Main entrypoints:

- server bootstrap: [src/index.ts](/Users/xyxz/Desktop/scholaraio-hub/packages/server/src/index.ts:1)
- route assembly: [src/app.ts](/Users/xyxz/Desktop/scholaraio-hub/packages/server/src/app.ts:60)
- runtime config: [src/config.ts](/Users/xyxz/Desktop/scholaraio-hub/packages/server/src/config.ts:1)

## Supported Providers

- `claude`
- `claude-ollama`
- `codex`
- `codex-oss`

## Removed From This Trimmed Package

- Gemini provider support
- OpenCode provider support
- recents, onboarding, activity, client-logs, server-info, git-status routes
- cross-package test dependencies on `client`
- monorepo-only wrapper scripts

## Requirements

- Node.js 22+
- local npm install in this directory
- `@scholaraio-hub/shared` must still resolve during install and build
- local Claude and/or Codex CLI installed if you want real sessions

## Quick Start

Install dependencies:

```bash
npm install
```

Run development server:

```bash
npm run dev
```

Run with file watching:

```bash
npm run dev:watch
```

Run mock mode:

```bash
npm run dev:mock
```

Default bind address is `127.0.0.1:3400`.

Health check:

```bash
curl http://127.0.0.1:3400/health
```

## Scripts

- `npm run dev`
- `npm run dev:watch`
- `npm run dev:mock`
- `npm run build`
- `npm test`
- `npm run test:e2e`
- `npm run test:e2e:real`

## Build And Test

Type-check / build:

```bash
npm run build
```

Unit tests:

```bash
npm test
```

E2E tests:

```bash
npm run test:e2e
```

Real CLI / SDK tests:

```bash
npm run test:e2e:real
```

## Environment Variables

Defined in [src/config.ts](/Users/xyxz/Desktop/scholaraio-hub/packages/server/src/config.ts:1).

Core network and storage:

- `PORT`
  Default: `3400`
- `HOST`
  Default: `127.0.0.1`
- `SCHOLARAIO_HUB_DATA_DIR`
- `SCHOLARAIO_HUB_PROFILE`
- `CLAUDE_PROJECTS_DIR`
- `CLAUDE_SESSIONS_DIR`
- `CODEX_SESSIONS_DIR`

Runtime behavior:

- `PERMISSION_MODE`
  One of `default`, `plan`, `acceptEdits`, `bypassPermissions`
- `MAX_WORKERS`
- `MAX_QUEUE_SIZE`
- `MAX_UPLOAD_SIZE_MB`
- `IDLE_TIMEOUT`
- `IDLE_PREEMPT_THRESHOLD`
- `PROJECT_SCAN_CACHE_TTL_MS`
- `CODEX_WATCH_PERIODIC_RESCAN_MS`

Logging and optional features:

- `LOG_DIR`
- `LOG_FILE`
- `LOG_LEVEL`
- `LOG_FILE_LEVEL`
- `LOG_TO_FILE`
- `LOG_PRETTY`
- `ENABLED_PROVIDERS`
  Current effective values are limited to `claude,codex`
- `VOICE_INPUT_ENABLED`
- `HTTPS_SELF_SIGNED`

## Operational Notes

- On startup the server probes local Claude and Codex CLIs, initializes data directories, warms model metadata, and starts file watchers for available session roots.
- Graceful shutdown aborts active supervised sessions before exiting.
- Upload routes are attached with WebSocket support from the main server bootstrap.
- Version reporting is currently static; it does not query remote releases.

## Handoff Notes

- `tsconfig.json` is self-contained.
- `package.json` no longer references `../../scripts/run-with-safe-home.js`.
- The remaining non-local dependency boundary is `@scholaraio-hub/shared`.
- If `npm run build` fails with `tsc: command not found`, install local dependencies first.
