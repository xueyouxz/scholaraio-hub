# Session State

> On-demand deep dive. Referenced by [`../rules/server.md`](../rules/server.md).
> Read before changing which session controls (send / queue / stop / answer / options) are
> available, how a run ends, or how the browser learns a session's state.

## Two state machines

| Layer | Where | States |
| --- | --- | --- |
| **Process** (one live CLI worker) | `ProcessState` in `packages/server/src/supervisor/types.ts` | `idle`, `in-turn`, `waiting-input`, `terminated` |
| **Session** (what is stored and shown) | `StoredSession.state` in `packages/shared/src/session/StoredSession.ts` | `idle`, `running`, `waiting-input`, `interrupted`, `error` |

`SessionService` is the only consumer of process events and the only writer of session
state. A process `state-change` sets the session to `waiting-input` while a pending input
request exists, else `running`; the run's end sets `idle`, `interrupted` or `error`.
Anything other than `idle` pauses the session's message queue (`queuePaused`).

A server restart marks unfinished runs `interrupted` (`SessionStore`) and never re-sends
the user's input.

## Controls

Controls are gated on **session state and provider capabilities**, never on transport
signals (an open stream, a recent poll):

| Session state | Composer | Other |
| --- | --- | --- |
| `idle` / `interrupted` / `error` | send | options change directly |
| `running` | queue (with text) or stop (empty) | options apply to the next turn (`pendingOptions`) |
| `waiting-input` | the pending question/approval (`InputRequestPrompt`) | stop |
| read-only session | none | sessions imported by earlier versions |

- **Queue vs steer**: `AgentProcess.queueMessage` steers the running turn when the provider
  session implements `steer` (Codex) and falls back to the queue otherwise or on failure.
- **Stop**: `SessionService.stop` asks the process to `interrupt` and waits briefly; a
  process that cannot interrupt or does not settle is released, and the next message
  resumes its native session.
- **What a provider offers** (permission modes, thinking modes, where slash commands
  apply, context usage, attachment limits) is one `ProviderCapabilities` descriptor in
  `packages/shared/src/types.ts`. The UI renders it and hard-codes no provider names.

## How the browser learns state

- On the open run stream, a transient `data-session-state` chunk carries `state` and
  `pendingInput` whenever they change; `useSessionChat` merges it into the snapshot query.
- When no stream is open, the snapshot query polls while the session is active.
- Re-attaching replays the current reply from its beginning; the snapshot omits that reply
  so nothing is appended twice.

## Invariants

- A browser refresh or closed tab only drops a stream listener. It never interrupts the
  provider.
- A stop is visible: the run finishes as `interrupted` with its notice, not silently.
- The supervisor terminates an `in-turn` process with no provider events past a
  provider-specific threshold (5 min; 60 min for Codex), and an `idle` one after
  `IDLE_TIMEOUT`. Neither changes the stored conversation.
- Our session id is canonical; provider-native ids stay internal (see
  [`../rules/server.md`](../rules/server.md)).

## Where this lives

- `packages/server/src/supervisor/` — `Supervisor` (one process per session, replacement
  when launch settings differ, stale reaping) and `AgentProcess` (state, queue/steer,
  interrupt, approvals).
- `packages/server/src/sessions/SessionService.ts` — runs, state, queue, stop, streams.
- `packages/client/src/features/session/` — `hooks/useSessionChat.ts`,
  `composer/ui/SendActionButton.tsx`, `components/InputRequestPrompt.tsx`.
