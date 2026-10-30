# Session State

> On-demand deep dive. Referenced by [`../rules/server.md`](../rules/server.md).
> Read before changing which session controls (send / queue / stop / answer / options) are
> available, how a run ends, or how the browser learns a session's state.

## Two state machines

| Layer | Where | States |
| --- | --- | --- |
| **Process** (one live CLI worker) | `ProcessState` in `packages/server/src/supervisor/AgentProcess.ts` | `idle`, `in-turn`, `waiting-input`, `terminated` |
| **Session** (what is recorded and shown) | `SessionDetail.state` in `packages/shared/src/session/session.ts` | `idle`, `running`, `waiting-input`, `interrupted`, `error` |

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

A session another program (a CLI in a terminal) is writing to is marked `external` for
half a minute; the Hub warns but does not lock it.

- **Queue, no steering**: a session runs one turn at a time. A message sent while a run is
  in progress is kept in the session's persisted queue (`SessionService.enqueue`) and sent
  when the run ends; nothing is added to a running turn.
- **Edit**: only the session's last prompt, never its first, and only while nothing runs. The prompt comes
  back into the composer; sending the correction (a chat message with `replaces`) cuts
  that turn and runs the new one in its place in one request, as Claude Code's own edit
  of a sent prompt does. There is no separate undo. The cut is the provider's own, in
  place (`AgentProvider.rewindSession`: Claude resumes at it with `resumeSessionAt`,
  Codex uses `thread/revert`), so the native id and its prompt cache stay; a legacy Codex
  thread, which can only be forked, is refused. The live process is released first. Files the agent
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
- Re-attaching replays the current reply from its beginning; the snapshot ends before that
  turn (it shows the running prompt only) so nothing is appended twice.
- Project and session lists refresh on `GET /api/events` (a `sessions` event whenever a
  provider writes a session file or a Hub turn starts or ends).

## Invariants

- A browser refresh or closed tab only drops a stream listener. It never interrupts the
  provider.
- A stop is visible: the run finishes as `interrupted` with its notice, not silently.
- The supervisor terminates an `in-turn` process with no provider events past a
  provider-specific threshold (5 min; 60 min for Codex), and an `idle` one after
  `IDLE_TIMEOUT`. Neither changes the stored conversation.
- A session's id is its provider's (see [`../rules/server.md`](../rules/server.md)); the
  conversation is read from the provider, and the Hub never keeps a copy of it.

## Where this lives

- `packages/server/src/supervisor/` — `Supervisor` (one process per session, replacement
  when launch settings differ, stale reaping) and `AgentProcess` (state, queue,
  interrupt, approvals).
- `packages/server/src/sessions/SessionService.ts` — runs, state, queue, stop.
- `packages/server/src/sessions/Turn.ts` — one run: its stream, replay, checkpoints, ending.
- `packages/client/src/features/session/` — `useSessionChat.ts`,
  `composer/ui/SendActionButton.tsx`, `transcript/InputRequestPrompt.tsx`.
