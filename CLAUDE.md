@AGENTS.md

## Claude Code specifics

- The package rules in `.claude/rules/` load automatically when you work in the matching
  package (their `paths:` front matter); other agents read them on request.
- Project hooks (`.claude/settings.json`) enforce part of the guide at edit time: Biome
  formats each edited file, `scripts/check-conventions.mjs` checks it, edits under the
  generated Codex protocol are blocked, and mutating `npm`/`yarn` commands are refused.
- `.claude/skills/` holds symlinks to the shared skills in `.agents/skills/`.
- `.claude/launch.json` starts the dev server (`hub-dev`) for the preview browser.
