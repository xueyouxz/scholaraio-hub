# Resource Lifecycle & Quiescence

> On-demand deep dive. Referenced by [`../rules/server.md`](../rules/server.md) and
> [`../rules/client.md`](../rules/client.md). Read before touching watchers,
> subscriptions, polling/retry timers, or reconnect logic.

## Principle

Idle provider sessions and closed client tabs must not generate unbounded or repeating
server activity. A closed tab must release: server subscriptions, file watchers, poll
timers, retry timers, client-owned heartbeats, and any queued catch-up work.

## Ownership rules

- **Client-managed watches** use reference counting with teardown on disconnect.
- **Provider processes** are released after `IDLE_TIMEOUT` when idle, and reaped by the
  supervisor when stuck `in-turn` without events.
- **Background jobs** run at a fixed cadence with bounded per-tick work.
- **Retry / catch-up** operations coalesce requests; they must not cascade into read
  storms.

## Review checklist

Before merging changes that touch loops, timers, watches, or transport, verify:

1. Every polling, retry, heartbeat, watch, and catch-up mechanism has matching teardown.
2. A closed stream (a session run's response stream, the library's SSE events) removes its
   server-side listener and clears its timers.
3. Idle sessions do not schedule per-session server work that lacks an active owner.
4. Incremental session refreshes reuse cached state or have demonstrably bounded work.
5. Client reconnect / recovery logic prevents overlapping request storms on the same
   session.

## Where this lives in the codebase

- `packages/server/src/sessions/SessionService.ts` — session runs, their stream listeners and
  process subscriptions
- `packages/scholaraio/scholaraio/hub/watcher.py` — project directory watcher (library service)
- `packages/server/src/supervisor/` — session supervision / lifecycle
- Client session stream (`packages/client/src/features/session/hooks/useSessionChat.ts`)
  and library events (`packages/client/src/core/libraryEvents.ts`)
