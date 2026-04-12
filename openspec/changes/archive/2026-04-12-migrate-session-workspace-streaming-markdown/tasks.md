## 1. Session State Foundation

- [x] 1.1 Create a lightweight `useSessionPageState` module that owns initial session fetch, incremental SSE subscription, targeted reconciliation, and older-message pagination state for the session route.
- [x] 1.2 Refactor `SessionPage` to consume the new session state hook instead of performing page-wide reloads on most SSE events.
- [x] 1.3 Wire session event handling for `message`, `status`, `markdown-augment`, `pending`, `complete`, and session recovery checkpoints using the existing backend contract.

## 2. Streaming Markdown Rendering

- [x] 2.1 Port the streaming markdown primitives from `temp/client` into `packages/client`, including the provider/context and `useStreamingMarkdown` hook adapted to current client types.
- [x] 2.2 Introduce session message presentation components (`MessageList`, `MessageItem`, `TextBlock`, `MessageComposer`, `SessionHeader`) and move message rendering out of the page component.
- [x] 2.3 Render completed assistant messages from server-provided augment HTML, keep raw text fallback/copy paths, and preserve pending input approval and process control interactions in the new workspace.

## 3. Workbench Shell Migration

- [x] 3.1 Replace the legacy `AppShell` route wrapper with a shared `NavigationLayout` and sidebar structure for the supported workbench pages.
- [x] 3.2 Adapt the session route to render as a route-owned workspace inside the shared shell, following `.design-docs/DESIGN.md` rather than the current static three-column grid.
- [x] 3.3 Keep `FilePage` and other supported route exceptions working while removing the old shell-specific layout assumptions from shared routing.

## 4. Verification And Cleanup

- [x] 4.1 Verify live session behavior for streaming markdown, completion-time reconciliation, pagination, pending input handling, and process controls across supported providers.
- [x] 4.2 Update or add targeted frontend tests for session state/event handling and any extracted rendering modules that cover the new incremental update behavior.
- [x] 4.3 Remove superseded shell/session code paths once the migrated navigation and session workspace are stable.
