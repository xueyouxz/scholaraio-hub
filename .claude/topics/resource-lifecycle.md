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
- **Provider processes** halt polling when idle, except during bounded recovery.
- **Background jobs** run at a fixed cadence with bounded per-tick work.
- **Retry / catch-up** operations coalesce requests; they must not cascade into read
  storms.

## Review checklist

Before merging changes that touch loops, timers, watches, or transport, verify:

1. Every polling, retry, heartbeat, watch, and catch-up mechanism has matching teardown.
2. Closed WebSocket / EventSource connections remove server-side subscribers and clear
   their timers.
3. Idle sessions do not schedule per-session server work that lacks an active owner.
4. Incremental session refreshes reuse cached state or have demonstrably bounded work.
5. Client reconnect / recovery logic prevents overlapping request storms on the same
   session.

## Where this lives in the codebase

- `packages/server/src/services/SessionService.ts` — session runs, their stream listeners and
  process subscriptions
- `packages/scholaraio/scholaraio/hub/watcher.py` — project directory watcher (library service)
- `packages/server/src/supervisor/` — session supervision / lifecycle
- Client activity bus / session stream (`packages/client/src/features/session/lib/`)
