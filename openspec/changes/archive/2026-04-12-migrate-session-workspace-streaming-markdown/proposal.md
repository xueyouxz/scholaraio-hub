## Why

The current `packages/client` session view still relies on a static three-column shell and reload-driven SSE handling, which prevents the migrated frontend from matching the interaction model already proven in `temp/client`. This change is needed now to move the local client onto a maintainable workbench architecture that supports sidebar-based navigation, incremental session updates, and full streaming markdown rendering without rebuilding the page on every event.

## What Changes

- Replace the current fixed `AppShell` layout with a sidebar-based navigation shell adapted from `temp/client`, while keeping the scope limited to the supported local workbench pages.
- Rebuild the session workspace so the route owns its own header, message pane, and composer instead of being constrained by the old three-column shell.
- Replace reload-driven session SSE handling with event-driven incremental state updates plus targeted reconciliation on initial load, completion, pagination, and recovery paths.
- Migrate the streaming markdown pipeline from `temp/client` into `packages/client`, including provider/context plumbing, block-level streaming rendering, completed-message augment rendering, and fallback handling for raw text.
- Introduce lighter-weight session presentation modules and state hooks in `packages/client` so session rendering logic, streaming state, and layout concerns are no longer concentrated inside one page component.

## Capabilities

### New Capabilities
- None.

### Modified Capabilities
- `client-workbench-shell`: Change the shell contract so supported workbench pages use a sidebar-based navigation layout and session pages own an internal workspace instead of inheriting the current static multi-column shell.
- `client-session-workflow`: Change the local session interaction contract so session detail uses incremental SSE state updates and full streaming markdown rendering based on server augments rather than full-page reload behavior and plain-text message rendering.

## Impact

- Affected frontend code under `packages/client/src/app`, especially routing, shell/layout components, session page state management, and message rendering.
- Depends on existing backend session SSE events and markdown augment support already exposed by `packages/server`.
- No new backend API surface is required, but the client will rely more directly on the existing `message`, `status`, `markdown-augment`, `pending`, `complete`, and pagination behaviors.
