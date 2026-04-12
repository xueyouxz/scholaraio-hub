## 1. React Client Foundation

- [x] 1.1 Upgrade `packages/client` and the root Vite configuration to support a React entrypoint and required React client dependencies.
- [x] 1.2 Replace the current minimal client entry files with the migrated React client bootstrap adapted from `temp/client`.
- [x] 1.3 Reconcile shared imports and client package configuration so migrated code consumes `@scholaraio-hub/shared` and the current workspace conventions.

## 2. Workbench Shell Migration

- [x] 2.1 Migrate the shared navigation shell, layouts, and route structure needed for `Projects`, `Sessions`, `Session`, `New Session`, `Agents`, `File`, and `Settings`.
- [x] 2.2 Migrate the page, component, context, and hook modules required to render the first-stage local workbench pages.
- [x] 2.3 Keep `Sidebar` in the migrated shell while excluding `Inbox` and `Activity` from the first-stage navigation.

## 3. Session Workflow Migration

- [x] 3.1 Migrate the new-session workflow with provider, model, permission mode, thinking mode, first message, and attachment upload support.
- [x] 3.2 Migrate the session interaction workflow with streaming messages, send/continue input, pending tool approval or question handling, pagination, and process controls.
- [x] 3.3 Preserve display compatibility for historical providers such as `claude-ollama` and `codex-oss` while restricting new-session choices to `claude` and `codex`.

## 4. Unsupported Branch Removal

- [x] 4.1 Remove remote-mode, relay/login, and SRP or encryption-dependent modules and route branches from the migrated client.
- [x] 4.2 Remove emulator/device, mobile-specific, and other unsupported feature branches that are outside the agreed first-stage scope.
- [x] 4.3 Remove or disable first-stage non-goals from the migrated session experience, including sharing, voice input, notification-heavy enhancements, and hold-mode UX.

## 5. Stabilization And Verification

- [x] 5.1 Resolve migration fallout so the client builds and typechecks cleanly after the shell extraction and branch cleanup.
- [x] 5.2 Verify the first-stage workflows across the migrated pages against the current backend API surface.
- [x] 5.3 Confirm the resulting client remains aligned with the documented scope and does not expose unsupported placeholder functionality.
