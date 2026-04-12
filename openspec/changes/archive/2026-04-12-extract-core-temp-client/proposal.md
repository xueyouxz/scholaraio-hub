## Why

`packages/client` is currently a thin non-React shell, while `temp/client` already contains the richer frontend architecture and interaction model that matches the product direction. The gap is now blocking the project from shipping a coherent local workbench, so we need a deliberate extraction that preserves the proven `temp/client` implementation while removing branches that depend on unsupported backend capabilities.

## What Changes

- Replace the current `packages/client` shell with a React-based client architecture derived from `temp/client`.
- Migrate the local workbench backbone into `packages/client`, keeping the route/layout/page/component/hook structure as close to `temp/client` as practical.
- Deliver a first-stage page set covering `Projects`, `Sessions`, `Session`, `New Session`, `Agents`, `File`, and `Settings`.
- Keep the session experience feature-complete for local use: streaming messages, sending input, attachments, tool approval and question handling, pagination, and process controls.
- Keep the new session form feature-complete for first use: provider, model, permission mode, thinking mode, first message, and attachment upload.
- Restrict new-session provider choices to the backend-supported providers (`claude`, `codex`) while keeping the UI architecture extensible.
- Preserve display compatibility for historical session providers such as `claude-ollama` and `codex-oss`, but do not expose them as new-session options.
- Preserve the shared navigation shell with `Sidebar`, but exclude `Inbox` and `Activity` from the first-stage navigation.
- Remove or exclude branches that depend on unsupported capabilities, including remote mode, relay/login flows, encryption/SRP transport, device/emulator workflows, mobile-specific modules, and notification-heavy enhancements.
- Treat the migration as a whole-shell extraction followed by cleanup, accepting an intermediate red-to-green stabilization phase during implementation.

## Capabilities

### New Capabilities
- `client-workbench-shell`: A React-based local frontend shell that provides the migrated navigation, routing, and page structure for the core workbench.
- `client-session-workflow`: A local session workflow covering session creation, live conversation, attachment upload, process interaction, and historical provider display compatibility.

### Modified Capabilities
- None.

## Impact

- Affected code: `packages/client`, root `vite.config.ts`, client package dependencies, and migrated UI modules sourced from `temp/client`.
- Affected systems: frontend routing, client build pipeline, local session UX, provider selection UX, and session rendering/interaction flows.
- Dependencies: React, React DOM, React Router, and the subset of temp-client support modules needed for the local workbench.
- Non-goals for this change: remote access, relay/authentication flows, SRP/encryption transport, emulator/device pages, Inbox, Activity, voice input, sharing, and notification-heavy enhancements.
