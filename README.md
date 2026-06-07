# scholaraio-hub

A desktop-class web UI for managing [Claude Code](https://github.com/anthropics/claude-code)
and [OpenAI Codex](https://github.com/openai/codex) sessions — browse history, view diffs,
read research papers, and explore your library analytics, all from a single interface
running on your own machine.

> Local-first: runs on `127.0.0.1`, reads the session files already on your disk, and never
> sends your data anywhere.

## Screenshots

> _Screenshots and demo GIF coming soon._

## Quick Start

You only need one of the options below. The UI opens at **http://localhost:3400**.

**From source**

```bash
pnpm install
pnpm build
pnpm --filter @scholaraio-hub/server start
```

## Features

- **Session management** — browse, search, and replay Claude Code and Codex sessions
- **Diff viewer** — inspect file changes made within any session
- **File browser** — explore project files directly from a session view
- **Library** — PDF reader for research papers with full-text search
- **Analytics** — scatter plots, heatmaps, and histograms over your paper library
- **Provider filters** — toggle between Claude and Codex, or filter by topic

## Requirements

scholaraio-hub reads sessions produced by the agent CLIs you already use — install at least
one:

| Tool | Required | What it adds |
|------|----------|--------------|
| [Claude Code CLI](https://github.com/anthropics/claude-code) | Recommended | Claude Code session history |
| [Codex CLI](https://github.com/openai/codex) | Optional | OpenAI Codex session history |
| [scholaraio](https://github.com/ZimoLiao/scholaraio) | Optional | Scholar gateway for library / paper features |

## Configuration

All settings are optional — defaults work out of the box. Set them as environment variables
(or in a `.env.local` file):

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3400` | Port the UI is served on |
| `HOST` | `127.0.0.1` | Bind address (keep local unless you know what you're doing) |
| `ENABLED_PROVIDERS` | all | Comma-separated list, e.g. `claude,codex` |
| `SCHOLARAIO_HUB_DATA_DIR` | `~/.scholaraio-hub/` | Where app data is stored |
| `SCHOLARAIO_API_URL` | — | Scholar gateway URL, if you run [scholaraio](https://github.com/ZimoLiao/scholaraio) |

## Acknowledgements

Built on top of [ScholarAIO](https://github.com/ZimoLiao/scholaraio) — thanks to the original
author for their open-source work.

```bibtex
@software{scholaraio,
  author  = {Liao, Zi-Mo},
  title   = {ScholarAIO: AI-Native Research Terminal},
  year    = {2026},
  url     = {https://github.com/ZimoLiao/scholaraio},
  license = {MIT}
}
```

## License

[MIT](./LICENSE) © 2026 xueyou zhang
