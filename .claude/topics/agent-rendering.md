# Agent Output Rendering Contract

> On-demand deep dive. Referenced by [`../rules/client.md`](../rules/client.md).
> Describes how text rendered in the hub's markdown surfaces is processed, so generated
> content uses features that actually render. Treat the renderer code as the source of
> truth and verify against it before relying on an edge case.

## Rendering stack (as wired today)

- **Client**: `react-markdown` with `remark-gfm`, `remark-math`, `rehype-katex`,
  `rehype-raw`. See `packages/client/src/features/library/reader/PaperMarkdown.tsx` and
  `packages/client/src/features/skills/SkillDetailView.tsx`.
- **Server sanitization**: `packages/server/src/augments/safe-markdown.ts`
  (`sanitize-html`), plus `marked` and `shiki` for server-side highlighting.

## What renders

- **GitHub-Flavored Markdown** (`remark-gfm`): headings, bold/italic/strikethrough, inline
  code, ordered/unordered/nested/task lists (`- [ ]` / `- [x]`), block quotes, tables,
  autolinks.
- **Fenced code blocks**: tag the fence with a language (` ```ts `, ` ```python `,
  ` ```sh `) for syntax highlighting via Shiki.
- **Math (KaTeX)** via `remark-math` + `rehype-katex`:
  - Inline `$…$`, display `$$…$$`.
  - Prefer real math over ASCII art — output is selectable and scales.
  - Math inside fenced code blocks is not rendered (code is opaque to the math plugin).
- **Raw HTML**: `rehype-raw` parses inline HTML, but it passes through `sanitize-html`
  on the server. Anything outside the sanitizer allowlist is stripped/escaped — do not
  rely on arbitrary tags or `javascript:` / `data:` URLs.

## Guidance for agents

- Tag code fences with a language for highlighting.
- Use `$…$` / `$$…$$` for any math (loss functions, notation, matrices).
- Do not paraphrase structured tool results into prose if the UI already renders them
  richly — check the relevant tool renderer under
  `packages/client/src/features/session/components/renderers/`.

> If you need a feature not listed here (e.g. ANSI color, local-media-link previews),
> confirm it exists in the renderer code first — this repo's renderer is not identical to
> other agent UIs.
