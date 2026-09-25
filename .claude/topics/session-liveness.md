# Session Liveness

> On-demand deep dive. Referenced by [`../rules/server.md`](../rules/server.md).
> Read before changing how the supervisor or the session stream decides whether
> a session is "making progress".

## Evidence hierarchy

Not all signals prove the same thing. Ranked from weakest to strongest:

1. **Transport connectivity** (socket open) — proves nothing about progress.
2. **Heartbeat ticks / process liveness** — proves the process is alive, not progressing.
3. **Raw provider events / stream envelopes** — necessary but not sufficient.
4. **User-visible liveness**: actual content rendered to the user — the *only* signal that
   upgrades a stale turn to "progressing".

## Invariants

- Weaker evidence must **never** upgrade a session to `verified-progressing` or
  `verified-idle`.
- A heartbeat is an idle-timeout check anchored to the latest *real* liveness signal — it
  is not a wall-clock tick, and client heartbeats do not reset the timer.
- Probe timeouts must resolve into liveness evidence; a hung probe must not leave
  verification undefined.
- A **browser refresh must never** generate a provider interrupt. If a refresh correlates
  with an interrupt, treat the correlation as a causality bug.
- A provider interrupt is terminal liveness evidence and requires explicit rendering (with
  a boundary/timestamp), not silence or continued work signals.

## Why it matters here

The supervisor and the client session stream translate provider stream activity into
user-facing session state. Claiming "progress" from envelope traffic alone produces false
"it's working" UI when nothing is actually being rendered. See
[`provider-state-machine.md`](provider-state-machine.md) for how state drives the UI.
