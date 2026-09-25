---
paths:
  - "packages/server/**"
---

# Server Rules (`packages/server`)

Scope: Hono API (`src/routes/`), session supervision (`src/supervisor/`), session runs and
their stream subscribers (`src/sessions/SessionService.ts`), and provider integrations
(`src/providers/`).
Terms used here are defined in [`../glossary.md`](../glossary.md).

## Error Handling

- API endpoints must not convert exceptions into degraded-but-successful responses (e.g.
  returning `{ built: false }` when a file exists but fails to parse).
- Distinguish **"resource does not exist"** (return empty/false state) from **"resource
  exists but is unreadable"** (return a 500 with a diagnostic message).
- Bare `.catch(() => {})` and other silent swallows are prohibited. At minimum log the
  error with enough context to diagnose it.

## Guard Clauses

A guard that checks a precondition must `return` before the work begins. A check followed
by a log that does not return is not a guard — it is a comment.

## Resource Quiescence

Idle provider sessions and closed client tabs must not indefinitely consume server
resources. Every recurring server action (poll, retry, heartbeat, watch, catch-up) needs
an owner and a teardown path. Full review checklist:
[`../topics/resource-lifecycle.md`](../topics/resource-lifecycle.md).

## Idempotency for Background Jobs

- A function that computes offline and persists to disk must first answer "is the output
  already up to date?" and return the existing result if so. This check lives **in the
  function**, not the caller.
- Job runners must check whether a job of the same kind is already queued/running before
  enqueuing a new one.
- UI controls that trigger jobs must be disabled while any job of that kind is pending or
  running.

## Session Identity (canonical id)

Our own session id is the **canonical** user-facing identifier. Provider-native ids
(e.g. the Codex thread id in
`src/providers/codex/protocol/generated/ThreadId.ts`) may be stored and passed back
for resume/export/debug, but must **never silently replace** our session id in URLs,
metadata, payloads, or UI copy. See
[`../topics/provider-state-machine.md`](../topics/provider-state-machine.md) and
[`../topics/session-liveness.md`](../topics/session-liveness.md).

## Provider Environment Isolation

Env vars internal to the server must not leak into provider child processes. Declare every
variable the server reads in `RuntimeEnvSchema` (`src/env.ts`); the child-process filter in
`src/providers/agent-env.ts` excludes exactly those keys.

## Codex Protocol / Version Audit Gate

Code under `src/providers/codex/protocol/generated/` is generated output — do not
hand-edit. When the generated protocol changes (or the expected Codex CLI version bumps),
audit the dependent provider code (`src/providers/codex/`) and its
tests in the same change.

## Configuration

Before adding a new environment variable, review `src/config.ts` and `src/env.ts`, and
surface user-facing vars in `.env.example`. The profile decides the port
(`packages/shared/src/ports.ts`, `PORT` overrides) — do not hardcode port numbers.
