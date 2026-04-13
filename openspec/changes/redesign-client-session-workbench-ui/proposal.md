## Why

`packages/client` already has the migrated session workspace architecture, but its current presentation still reads like a transitional admin shell rather than the focused workbench agreed for the local client. The gap is most visible in the session page: the sidebar, message stream, and composer do not yet deliver the tighter `temp/client`-inspired event-flow experience that fits the product direction and the repository's design system.

## What Changes

- Restructure the `packages/client` app shell so the desktop layout behaves like a collapsible workbench sidebar with a thin fixed top bar and route-owned content canvas.
- Rebuild the session page layout around a compact timeline-style message stream, removing the current persistent right-side metadata/process panel.
- Restyle assistant output so normal markdown reads like a document within the timeline, while code blocks, tool rows, pending states, and other machine-like output retain a denser terminal-style treatment.
- Convert the composer into a bottom-docked floating input surface that stays attached to the session workspace instead of rendering as an in-flow card.
- Preserve ScholarAIO branding, color tokens, and typography rules from `.design-docs/DESIGN.md` while borrowing structural and density cues from `temp/client`.
- Keep the existing route structure, session data flow, streaming markdown pipeline, and supported feature surface intact; this change is a UI contract update, not a product-scope expansion.

## Capabilities

### New Capabilities
- None.

### Modified Capabilities
- `client-workbench-shell`: Change the shell requirements so the local client uses a collapsible sidebar workbench, a thin fixed top bar, and route-owned page canvases rather than the current static shell presentation.
- `client-session-workflow`: Change the session workspace requirements so conversation detail renders as a compact timeline/event-flow experience with docked input, weak assistant body framing, visible tool activity, collapsed thinking blocks, and no persistent right-side metadata panel.

## Impact

- Affected code under `packages/client/src/app`, especially shared navigation/layout components, session page composition, message rendering components, and workspace styling in `packages/client/src/styles.css`.
- No backend API or protocol changes; existing session fetch, SSE, pagination, pending-input, and streaming markdown flows remain in place.
- No new dependencies are required unless implementation later chooses to extract shared styling helpers.
