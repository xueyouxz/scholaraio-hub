# Agent Output Rendering Contract

> On-demand deep dive. Referenced by [`../rules/client.md`](../rules/client.md).
> Describes how text rendered in the hub's markdown surfaces is processed, so generated
> content uses features that actually render. Treat the renderer code as the source of
> truth and verify against it before relying on an edge case.

## Rendering stack (as wired today)

- **Session transcript**: Streamdown (`packages/client/src/shared/components/Markdown.tsx`)
  with the `code` (Shiki), `math` (KaTeX, `$…$` enabled) and `cjk` plugins; streaming mode
  and a block caret while a part is live. `script` / `iframe` / `object` / `embed` / `form` /
  `input` are dropped and URLs pass Streamdown's `defaultUrlTransform`. Code blocks carry no
  line numbers and only a copy button; tables carry no toolbar; nothing offers a download;
  code and tables show whole (no inner max height).
- **File links**: a link whose target is a path rather than a web address
  (`[app.ts](src/app.ts:42)`, `/abs/path/app.ts#L42-L50`, `README.md:3`) is marked by a
  remark step (`shared/components/fileLinks.ts`) before Streamdown's sanitizer, which would
  otherwise block a bare relative path, and renders as a button. In a session it opens the
  file in `features/session/components/FileViewerDialog.tsx` (read through
  `/api/sessions/:id/fs/file`, which takes paths relative to the working directory or
  absolute under it), with the linked lines marked; outside a session it is plain text.
- **Paper reader**: `react-markdown` with `remark-gfm`, `remark-math`, `rehype-katex` and
  `rehype-raw` (`packages/client/src/features/library/reader/PaperMarkdown.tsx`). Typeset by
  Tailwind Typography (`prose`, palette mapped in `.paper-prose` in `styles.css`); a small
  rehype step tags each top-level block with its `data-line` for reading position and
  citations.
- **Skill detail**: `react-markdown` with `remark-gfm`, `remark-math`, `rehype-katex`, no raw
  HTML (`packages/client/src/features/skills/SkillDetailView.tsx`).
- There is no server-side Markdown or HTML step: the server streams text, the client
  renders it.

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
- **Raw HTML**: Streamdown's default rehype chain (`rehype-raw`, `rehype-sanitize`,
  `rehype-harden`) plus the dropped elements above decides what survives in the
  transcript; skill pages render none. Do not rely on HTML in agent output.

## Guidance for agents

- Tag code fences with a language for highlighting.
- Link files by path, optionally with a line (`[app.ts](src/app.ts:42)`); the reader opens
  them in place. A directory link cannot be opened.
- Use `$…$` / `$$…$$` for any math (loss functions, notation, matrices).
- Do not paraphrase structured tool results into prose if the UI already renders them
  richly — check the relevant tool renderer under
  `packages/client/src/features/session/components/renderers/`.

> If you need a feature not listed here (e.g. ANSI color, local-media-link previews),
> confirm it exists in the renderer code first — this repo's renderer is not identical to
> other agent UIs.

## Session transcript pipeline (client)

`AgentEvent` → `UIChunkWriter` (server) → AI SDK `useChat` (`hooks/useSessionChat.ts`) →
`SessionMessages` → `AssistantTurn`:

- `lib/turnTree.ts` lays a message out (pure, unit-tested): subagent parts move under
  their parent call, the tool calls, reasoning and returned images between two texts fold
  into one row (`lib/activity.ts`, summarized as "Ran 2 commands, edited app.ts +3 −1" by
  `renderers/activitySummary.ts`), citations are collected once. Calls that ask the user
  something (AskUserQuestion, ExitPlanMode) never fold; a fold holding a pending decision
  opens itself.
- What the transcript knows about a tool lives on its renderer (`renderers/tools.tsx`,
  looked up through `renderers/registry.tsx`): its label, its phrase in a folded run, the
  files it changes (`fileChanges`, from `renderers/fileChanges.ts`: Claude
  `structuredPatch`, Codex per-file diffs, Write content), whether it asks the user
  (`asksUser`). Diff stats, the turn-end "Edited N files" card and whether an approval can
  also accept edits all read it from there; don't keep tool-name lists elsewhere.
- A pending decision is one component, `components/InputRequestPrompt.tsx`: asked inline
  on its call's row, or floating over the transcript when that row is not on screen.
- Tool code and output are highlighted by Streamdown itself: `renderers/blocks.tsx` wraps
  them in a fence (`startLine=N` in the info string, numbered only for a file read from a
  known line) and renders it with the shared `Markdown` component.
- `components/parts/registry.tsx` draws each part type; tool calls are dispatched further
  by tool name in `components/renderers/registry.tsx`. A new part type goes into
  `TIMELINE_PART_TYPES` (`lib/parts.ts`) and the part registry together; the types keep
  them in step.
- Every message and every timeline item sits in an `ErrorBoundary`, reset when its part
  changes, so a renderer that throws on half-streamed input recovers.
- Run state (pending decision, running/idle) is pushed on the open stream as a transient
  `data-session-state` chunk and merged into the snapshot query; polling is the fallback
  when no stream is open.
- `hooks/useStickToBottom.ts` follows content growth (ResizeObserver) while a turn runs;
  only the reader's gestures unpin it.

## Styling the transcript

- Colors come only from the `@theme` palette in `styles.css`. Streamdown's shadcn-named
  utilities (`bg-muted`, `border-border`, …) are mapped there; without the mapping its
  code blocks and tables render with no background or border.
- `features/session/session.css` is imported into `@layer components`, so a Tailwind
  utility on the same element wins.
- `features/session/session-markdown.css` is imported into a `markdown` layer declared
  after `utilities`, because it must override Streamdown's own utility classes. Target
  Streamdown output by `[data-streamdown="…"]` attributes under `.session-markdown`, not
  by its class names, and re-check them when upgrading Streamdown.
- A turn is a plain column: no timeline line or status dots. Every child carries
  `timeline-item` for spacing only. Tool rows have no frame of their own; code sits on
  one flat surface (no border inside a border), a step smaller than prose.
- An answer reads at `--font-size-prose` (a step above the tool rows' `--font-size-base`),
  its code at `--font-size-code-prose`. Code blocks and tables are as wide as what they
  hold, up to the column (`width: fit-content`), never stretched to it by default.
- The app has one light palette: `styles.css` makes Tailwind's `dark:` class-based, so
  Streamdown's Shiki tokens and `@pierre/diffs` stay light whatever the OS theme.
