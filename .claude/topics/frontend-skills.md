# Frontend Skills: When and How They Apply

> On-demand deep dive. Referenced by [`../rules/client.md`](../rules/client.md).
> Applies to `packages/client/**`. The [client rules](../rules/client.md),
> [shared import discipline](../rules/shared.md) and [design system](../../.design/DESIGN.md)
> come first; where an upstream skill disagrees, the project rule wins. Read only the
> detailed skill rules the task touches.

## When to use which

| Skill | Use when |
| --- | --- |
| [vercel-react-best-practices](../../.agents/skills/vercel-react-best-practices/SKILL.md) | Writing, changing or reviewing React code; analysing request, render or bundle-size performance. |
| [vercel-composition-patterns](../../.agents/skills/vercel-composition-patterns/SKILL.md) | Designing a complex component API, compound components, or refactoring a component with too many mode props. |
| [web-design-guidelines](../../.agents/skills/web-design-guidelines/SKILL.md) | Accessibility and interaction requirements while writing UI; checking the touched files when reviewing UI. |

## Stack mapping and exceptions

- **Loading and framework**: React.lazy, Suspense, dynamic `import()` and Vite chunks; no
  `next/dynamic`. RSC, Server Actions, SSR hydration and `next/server` rules do not apply.
  The Hono server borrows only the general concurrency and caching principles.
- **Requests and state**: server state is TanStack Query (dedupe, cache); everything else
  is local state, context or the URL. Do not add SWR, better-all or a state library
  because an example uses one.
- **Import boundaries**: on-demand imports never bypass the `@scholaraio-hub/shared`
  entry; no cross-package source imports.
- **Rendering and resources**: keep resource release, reference-counted subscriptions,
  derived data computed at the common ancestor, and the D3 imperative boundary. `memo`,
  caches and JS micro-optimisations need a demonstrated cost; a new cache defines its size,
  invalidation and cleanup. A hidden component is not unmounted — do not assume its
  subscriptions and resources were released.
- **Composition**: reduce boolean props that switch component modes; ordinary state props
  such as `disabled` and `loading` are fine. Change only the components the task needs; do
  not mass-replace `useContext` or `forwardRef`, or move all state into Context. Use only
  React APIs the installed version supports; never upgrade to Canary for a skill.
- **UI and motion**: adopt semantic controls, labels, keyboard reachability, visible focus,
  empty states, long-text handling and `prefers-reduced-motion`. The sidebar's
  `grid-template-columns` transition is a deliberate exception to "animate only
  transform/opacity"; changing it starts with the design system, not an automatic rewrite.
- **Lists and navigation**: keep TanStack Virtual and React Router. Virtualise by measured
  list cost. Sync to the URL only the state worth sharing or restoring, not every
  `useState`; do not add virtua or nuqs because an example does.
- **Copy and formatting**: casing, quotes and punctuation follow the copy's language; code
  follows Biome and visuals follow DESIGN.md. General guidelines never override the
  project's design tokens, fonts or layout.

## Source and maintenance

- Upstream: [vercel-labs/agent-skills](https://github.com/vercel-labs/agent-skills), pinned
  at `063bee94c3f4df8453406c830b0a7df0f2860278`, from `skills/react-best-practices`,
  `skills/composition-patterns` and `skills/web-design-guidelines`. Keep each skill complete
  with its license; never mix local rules into upstream files.
- The shared copy lives in `.agents/skills/`; `.claude/skills/` holds relative symlinks to
  it. Project rules reference that copy, not a personal global install.
- Update deliberately: review the upstream diff and the exceptions above; never follow
  upstream `main` automatically.
- web-design-guidelines fetches the latest external guideline on each UI review, as
  upstream intends; that guideline is not pinned. Record the source and version (or fetch
  date) used, and say so plainly when it could not be fetched.
- Skills guide coding and review. They do not replace lint, typecheck or tests, and they
  authorise no deployment or sweeping refactor.
