# Session State

> On-demand deep dive. Referenced by [`../rules/server.md`](../rules/server.md).
> Read before changing which session controls (send / queue / stop / answer / options) are
> available, how a run ends, or how the browser learns a session's state.

## Two state machines

| Layer | Where | States |
| --- | --- | --- |
| **Process** (one live CLI worker) | `ProcessState` in `packages/server/src/supervisor/AgentProcess.ts` | `idle`, `in-turn`, `waiting-input`, `terminated` |
| **Session** (what is stored and shown) | `StoredSession.state` in `packages/shared/src/session/StoredSession.ts` | `idle`, `running`, `waiting-input`, `interrupted`, `error` |

`SessionService` is the only consumer of process events for a session. Every change to
session state goes through the rules in `packages/server/src/sessions/session-record.ts`
(turn start and end, pending input, restart recovery, rewind, options). A process `state-change` sets the session to `waiting-input` while a pending input
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

- **Queue, no steering**: a session runs one turn at a time. A message sent while a run is
  in progress is kept in the session's persisted queue (`SessionService.enqueue`) and sent
  when the run ends; nothing is added to a running turn.
- **Edit and take back**: only the session's last prompt, and only while nothing runs. Take
  back (`POST /rewind`) removes that turn; a message with `replaces` corrects it, taking the
  turn back and running the new one in one request. Both cut the provider's own session in
  place (`AgentProvider.rewindSession`: Claude resumes at the cut with `resumeSessionAt`,
  Codex uses `thread/revert`), so the native id and its prompt cache stay; only a legacy
  Codex thread is forked instead. The live process is released first. Files the agent
  changed are never restored.
- **Permission mode**: a change reaches the live process (`AgentProcess.setPermissionMode`),
  which also applies it on the provider's side where it has one — Codex sends the matching
  sandbox with its next turn.
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
  when launch settings differ, stale reaping) and `AgentProcess` (state, queue,
  interrupt, approvals).
- `packages/server/src/sessions/SessionService.ts` — runs, state, queue, stop.
- `packages/server/src/sessions/Turn.ts` — one run: its stream, replay, checkpoints, ending.
- `packages/client/src/features/session/` — `hooks/useSessionChat.ts`,
  `composer/ui/SendActionButton.tsx`, `components/InputRequestPrompt.tsx`.
