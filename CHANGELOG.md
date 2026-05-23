# Changelog

All notable changes to this project will be documented in this file.
Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)

## [Unreleased]

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

[Unreleased]: https://github.com/xueyouxz/scholaraio-hub/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/xueyouxz/scholaraio-hub/releases/tag/v0.1.0
