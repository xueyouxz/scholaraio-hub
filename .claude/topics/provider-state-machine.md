# Provider State Machine

> On-demand deep dive. Referenced by [`../rules/server.md`](../rules/server.md).
> Read before changing which session controls (send / queue / stop / steer / model /
> compaction) are available in a given state.

## State sources

- **Process state**: `idle`, `in-turn`, or `waiting-input`.
- **Session liveness** (context only): the derived statuses described in
  [`session-liveness.md`](session-liveness.md).
- **Flags**: compaction status; ownership (`self` / `external` / `none`).

## Core principle

**Process state governs action availability; liveness provides context only.** Do not gate
controls on liveness — gate them on process state and ownership.

## Action availability (by process state)

| State | Available | Blocked |
| --- | --- | --- |
| `idle` (self-owned) | send, queue, model selection, compaction | interrupt |
| `in-turn` (self-owned) | stop/interrupt; queue/steer if provider supports | direct model change |
| `waiting-input` | approval-path responses only | standard send, interrupt |
| compacting (overlay) | underlying controls remain; copy becomes read-only | — |
| `needs-attention` | manual controls preserved; warnings shown | automatic idle assumptions |
| no owned process | — | shows "Slash commands" placeholder |

## Provider capability matrix

Providers differ — never assume a capability is universal:

| Capability | Claude (Agent SDK) | Codex |
| --- | --- | --- |
| Steering / "by the way" | no | yes |
| Interrupt | yes | yes, but **blocked during compaction** |
| Slash commands | yes | varies |

## Invariants

- Browser refreshes must never trigger interrupts independently (see
  [`session-liveness.md`](session-liveness.md)).
- A genuine interruption requires an explicit boundary display with a timestamp.
- Queued message status is advisory until reconciliation confirms it (echo, refresh
  omission, or session snapshot).

## Where this lives

- `packages/server/src/providers/` — provider adapters (`claude/`, `codex/`)
- `packages/server/src/supervisor/` — process/turn lifecycle
- Client session controls under `packages/client/src/features/session/`
