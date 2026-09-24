# Glossary

Shared domain language for `scholaraio-hub`. Use these terms precisely in code, comments,
commits, and instructions so humans and agents mean the same thing.

- **Session** — A single supervised conversation with a provider. Identified by our own
  **canonical session id** (see [Session Identity in server rules](rules/server.md)); not
  the provider's native id.
- **Provider** — An upstream coding agent backend integrated under
  `packages/server/src/sdk/providers/` (e.g. the Claude Agent SDK provider, the Codex
  provider). Capabilities differ per provider — see
  [`topics/provider-state-machine.md`](topics/provider-state-machine.md).
- **Supervisor** — The server component (`packages/server/src/supervisor/`) that owns a
  provider process's lifecycle: start, turn tracking, liveness, teardown.
- **Watcher** — A file-system watcher that observes on-disk changes and emits updates; the
  library service's project watcher lives in `packages/scholaraio/scholaraio/hub/watcher.py`.
- **Subscription** — A registered interest in a stream of updates (a session run's listeners
  in `packages/server/src/services/SessionService.ts`). Subscriptions must
  be released when the client disconnects (see
  [`topics/resource-lifecycle.md`](topics/resource-lifecycle.md)).
- **Activity bus** — The client-side dispatch layer
  (`packages/client/src/features/session/lib/`) that turns server/provider stream events
  into UI state.
- **Turn** — One request/response cycle within a session. Process state is `in-turn` while
  a turn is active.
- **Compaction** — Provider-side context compression. Some controls (e.g. Codex interrupt)
  are blocked while compacting.
- **Liveness** — Whether a session is actually making user-visible progress, distinct from
  mere transport/process aliveness. See
  [`topics/session-liveness.md`](topics/session-liveness.md).
- **Project / Workspace** — A directory grouping of sessions. The sidebar groups sessions
  by workspace/project; project identity helpers live in
  `packages/shared/src/projectId.ts`.
- **Generated protocol code** — Output under
  `packages/server/src/sdk/providers/codex-protocol/generated/`. Do not hand-edit; see the
  audit gate in [server rules](rules/server.md).
