# Changelog

Notable changes, in the [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) format.
The project is run from a source checkout; there are no published packages or images.

## [Unreleased]

### Added

- Local literature library backed by a bundled ScholarAIO Python service: PDF import
  through the real ingest pipeline, Zotero/EndNote export import, keyword search, reader
  with page and line positions, and citations that jump back to the source.
- Library capabilities: metadata completion, citation graph, reference extraction and
  draft checking, topic analysis, and optional semantic search installed on demand.
- Literature workspaces: a directory and paper set that sessions run in, with sessions
  grouped by workspace in the sidebar.
- Composer that describes each provider in its own terms: native models, permission,
  thinking and effort modes, slash commands, context-window usage, native attachments,
  queued and steered messages, and option changes that apply to the next turn.
- `pnpm hub setup | doctor | migrate | skills-sync`, profiles that decide data directory
  and port, and a guarded migration (plan / apply / rollback) from standalone ScholarAIO.
- `pnpm ci:local`, mirroring CI, and `scripts/check-conventions.mjs` for rules Biome
  does not cover.

### Changed

- Sessions are the application's own records, rendered on the client from one provider
  event model (`AgentEvent`) as AI SDK message streams; a browser disconnect never stops
  a run.
- Development serves the client from the server's own port (Vite middleware).
- Agent instructions live in `AGENTS.md`, shared by every coding agent.

### Removed

- Docker image and release workflow; the relay-based remote access. The Hub is a local,
  single-user app.
- Standalone JSONL history import.
- OpenSpec tooling.

## [0.1.0] - 2026-05-22

### Added

- Initial open-source release based on ScholarAIO
- Claude Code and OpenAI Codex session management UI
- Library analytics panel with D3 visualizations (scatter plot, heatmap, histogram)
- PDF reader for research papers
- Provider filters and topic analytics in library view
- Project file browser panel in session view
- Remote access via relay server with optional HTTPS
- Docker image published to GHCR

### Changed

- Restructured as pnpm workspace monorepo (client / server / shared)
- Standardized toolchain: TypeScript 5.9, Biome, Vitest, Playwright
- Layered environment loading with single-base-port derivation
- Multi-stage Dockerfile for lean production images
- CI split into parallel lint / typecheck / test jobs with Playwright browser cache
