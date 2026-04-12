## Context

`packages/client` currently exposes the first-stage local workbench routes, but its shell and session detail page are still materially simpler than the migrated architecture in `temp/client`. The current `AppShell` hard-codes a three-column layout for all shell routes, and `SessionPage` reloads the session detail on most SSE events while rendering message content as plain text. That structure blocks full reuse of the server's markdown augment stream and keeps session state, layout, and rendering concerns coupled inside one page.

The backend already provides the session transport needed for the richer client experience: session SSE events include `message`, `status`, `markdown-augment`, `pending`, `complete`, and pagination-compatible session fetches. The design challenge is therefore client-side: migrate the proven streaming markdown and navigation architecture from `temp/client` without importing unsupported remote-mode and non-local features, and align the final UX with `.design-docs/DESIGN.md` instead of copying `temp/client` verbatim.

## Goals / Non-Goals

**Goals:**
- Replace the current static shell with a sidebar-based navigation layout for supported local workbench routes.
- Rebuild the session route as an internal workspace with header, message pane, and composer owned by the page.
- Introduce a lightweight session state hook that performs incremental SSE updates and targeted reconciliation instead of whole-page reloads.
- Migrate the streaming markdown primitives from `temp/client` so assistant messages can render pending blocks, completed augments, and raw-text fallback consistently.
- Keep the migration scoped to supported local frontend behavior and existing backend contracts.

**Non-Goals:**
- Recreate `temp/client` pixel-for-pixel or import its full feature surface.
- Introduce remote-mode, relay, login, inbox, activity, voice, sharing, or device UX.
- Rebuild the backend session protocol or require new SSE event types.
- Port the full `temp/client` render-item/tool renderer architecture in this change.
- Expand sidebar behavior to advanced resizing, global session aggregation, or mobile gesture parity beyond what is needed for first-stage local navigation.

## Decisions

### Decision: Replace `AppShell` with a sidebar-based `NavigationLayout`

The current shell forces all shell routes into a fixed three-column grid, which is incompatible with a session workspace that needs to control its own header, message region, and composer. The new shell will move to a shared `NavigationLayout` with a sidebar and route-owned content area.

Rationale:
- Matches the proven structural split in `temp/client`: global navigation in the shell, workbench behavior in the page.
- Lets session pages evolve independently from list-style pages such as Projects or Sessions.
- Aligns better with `.design-docs/DESIGN.md`, which defines a fixed sidebar and top-level workbench shell.

Alternatives considered:
- Keep `AppShell` and patch the session route inside one grid column. Rejected because it preserves the current coupling and limits future workspace behavior.
- Import all of `temp/client` routing/layout modules directly. Rejected because it would drag in unsupported branches and unnecessary complexity.

### Decision: Introduce a lightweight `useSessionPageState` hook instead of porting `temp/client`'s full `useSession`

`temp/client` solves a broader product surface than the current local client. The session state logic in this change will be extracted from `SessionPage` into a focused hook that handles initial fetch, incremental SSE updates, streaming markdown callbacks, pagination, and completion-time reconciliation.

Rationale:
- Separates transport/state concerns from presentation without importing unrelated state machines.
- Keeps the migration bounded to the local session workflow while still establishing stable module boundaries.
- Makes it easier to test event handling and reconcile behavior independently of layout components.

Alternatives considered:
- Keep all logic inside `SessionPage`. Rejected because the page is already overloaded and would become harder to reason about after streaming migration.
- Port `temp/client`'s full `useSession`. Rejected because it couples this change to unsupported features and a much larger API surface.

### Decision: Treat server-provided augment HTML as the display source of truth for completed assistant messages

The client will continue storing raw message text/content for copy and fallback behavior, but completed assistant messages will render from server-provided markdown augment HTML when available. The streaming path will use block augments plus pending HTML until completion, then transition to stored message augment HTML.

Rationale:
- Keeps in-progress and completed rendering aligned with the server's augmentation pipeline.
- Avoids duplicating markdown parsing logic in the browser.
- Minimizes visual mismatch between streamed content and persisted history.

Alternatives considered:
- Render completed messages from raw markdown/text only. Rejected because the streamed and persisted views would diverge and lose server-side formatting fidelity.
- Add a client-side markdown parser. Rejected because the backend already owns augmentation and sanitization.

### Decision: Use event-driven updates with targeted reconciliation

The session route will update local state directly from SSE events for message additions, status transitions, and markdown stream updates. It will still re-fetch session detail at bounded checkpoints: initial load, older-message pagination, completion, session-id replacement, and explicit recovery from detected drift.

Rationale:
- Preserves smooth streaming without resetting the message list on each event.
- Keeps the client resilient to reconnects, ordering quirks, and provider-specific persistence timing.
- Reuses existing backend REST APIs instead of inventing a fully event-sourced client model.

Alternatives considered:
- Continue calling `load()` on every event. Rejected because it breaks live rendering and defeats the purpose of streaming markdown.
- Depend exclusively on local event assembly. Rejected because it is fragile under reconnect and persistence races.

### Decision: Migrate streaming markdown primitives, not the entire temp renderer stack

The change will port `StreamingMarkdownProvider`, `useStreamingMarkdown`, and a message text block renderer adapted to the current project. Message list components will stay intentionally light: `MessageList`, `MessageItem`, `TextBlock`, and `MessageComposer`.

Rationale:
- Delivers the required behavior with a smaller migration surface.
- Leaves room to evolve toward richer render-item abstractions later if the local client grows into that need.
- Reduces risk of carrying over tool/rendering branches that do not map to the current app yet.

Alternatives considered:
- Reimplement streaming primitives from scratch. Rejected because the temp implementation already encodes edge cases around block ordering, pending HTML, and stream completion.
- Port the full temp renderer hierarchy. Rejected because the current client does not yet need that breadth.

## Risks / Trade-offs

- [Shell migration touches all primary routes] → Keep the route list unchanged, migrate the shell separately from unsupported route families, and preserve `FilePage` as a layout exception.
- [Incremental SSE state can drift from persisted session data] → Reconcile on initial load, completion, session-id changes, pagination, and explicit recovery paths.
- [Streaming markdown can regress plain-text fallback or copy behavior] → Retain raw text on messages and keep `TextBlock` copy/fallback paths independent of augment HTML availability.
- [Importing temp patterns may leak unsupported product branches] → Port only focused modules and rewrite imports/interfaces around current local client types.
- [Layout changes can diverge from repo design rules] → Use `.design-docs/DESIGN.md` as the visual source of truth for shell/workspace styling rather than temp CSS.

## Migration Plan

1. Replace `AppShell` routing usage with a new shared navigation layout and sidebar for supported shell routes.
2. Extract session data flow into `useSessionPageState`, preserving existing API calls while switching SSE handling to incremental updates.
3. Port streaming markdown primitives and wire them into assistant message rendering.
4. Replace the current session detail UI with a workspace structure composed of session header, message list, and composer.
5. Validate pagination, pending input handling, process controls, and completion-time reconciliation before removing the old shell/session code paths.

Rollback strategy:
- Revert the new navigation layout and session modules together, restoring `AppShell` and the current `SessionPage`.
- Because backend contracts stay unchanged, rollback remains a client-only code revert.

## Open Questions

- Whether the first sidebar cut should include simple collapse behavior immediately or remain fixed-width until a later iteration.
- Whether session header title editing and model switching should stay deferred to a follow-up change or be folded into the same workspace once the core migration lands.
