---
paths:
  - "packages/client/**"
---

# Client Rules (`packages/client`)

Scope: Vite + React 19 frontend. These load when Claude works under `packages/client/`.
Terms used here are defined in [`../glossary.md`](../glossary.md).

Before writing or reviewing frontend code, read the
[frontend skills applicability rules](../topics/frontend-skills.md) and use the
linked project skills relevant to the task.

## React Resource Management

Any resource a component acquires — timers, intervals, event listeners, subscriptions,
open handles — must declare its release path at the point of creation, not as an
afterthought.

- Resources created **outside** `useEffect` must store their handle in a `useRef` and be
  cleaned up in a `useEffect` return function.
- Bare `setInterval` / `addEventListener` outside of `useEffect` are never acceptable.
- Client-managed watches/subscriptions use **reference counting** and tear down on
  disconnect/unmount — a closed tab must not leave server work running (see
  [`../topics/resource-lifecycle.md`](../topics/resource-lifecycle.md)).

## Imperative Rendering (Canvas / D3 / WebGL / Three.js)

Isolate the imperative layer's internal state from React's reactivity system.

- D3 scales, selections, zoom transforms, quadtrees, and animation frames are **not**
  React state. They must not appear in `useMemo` dependency arrays or in `useCallback`
  deps beyond the initial setup effect.
- Boundary: **React owns data props; the imperative layer owns its own render lifecycle.**
  Wire them with a single `useEffect` that calls an `update(data)` method.
- Mixing both models in one component causes cascade invalidation on every render.

## Shared Derived Data

Data derived from a common source and consumed by sibling components must be computed
**once at the nearest common ancestor** and passed down as a prop.

- Do not recompute the same derivation independently in each consumer (color maps,
  filtered sets, aggregated counts) — that risks divergence and wastes CPU.
- Expensive derivations: memoize at the ancestor. Cheap ones: still the ancestor's job.

## UI / Design

For component work and UI implementation, follow `.design/DESIGN.md` as the source of
truth for visual and interaction design. Do not redefine design rules inline.

## Agent Output Rendering

When producing content that renders inside a hub session view, see the rendering contract
in [`../topics/agent-rendering.md`](../topics/agent-rendering.md) (GFM, KaTeX, code
highlighting, local media links, sanitization).
