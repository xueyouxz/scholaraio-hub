---
paths:
  - "packages/server/**"
---

# Server Rules (`packages/server`)

Scope: Hono API (`src/routes/`), session supervision (`src/supervisor/`), session runs and
their stream subscribers (`src/sessions/SessionService.ts`, `src/sessions/Turn.ts`), and
provider integrations (`src/providers/`).
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

## Session Identity (the provider's id)

Sessions belong to their providers: Claude Code and Codex keep each conversation, and
sessions run from a terminal are listed beside the Hub's own. A session's id is therefore
the provider's id for it, written `sessionKey(provider, nativeId)` (`claude:<id>`,
`codex:<thread id>`, `packages/shared/src/session/session.ts`) in URLs, payloads and
records. The Hub adds no id of its own; its record of a session (`SessionStore`) is keyed
by that id. A new session is started with its first message and answered under the id its
provider gives it; until then the supervisor holds it under a placeholder that never leaves
the server. Session and process states, and which controls they allow:
[`../topics/session-state.md`](../topics/session-state.md).

The conversation is read from the provider (`AgentProvider.readSession`), never copied:
the Hub keeps only what it adds to it (the prompt as the user wrote it, citations,
notices, a reply cut short, options, references, the queue).

## Provider Environment Isolation

Env vars internal to the server must not leak into provider child processes. Declare every
variable the server reads in `RuntimeEnvSchema` (`src/env.ts`); the child-process filter in
`src/providers/agent-env.ts` excludes exactly those keys.

## Codex Protocol / Version Audit Gate

Code under `src/providers/codex/protocol/generated/` is generated output — do not
hand-edit. When the generated protocol changes (or the expected Codex CLI version bumps),
audit the dependent provider code (`src/providers/codex/`) and its
tests in the same change.

## Composition Root

`src/index.ts` creates every service once through `createServices` (`src/container.ts`)
and releases them in reverse order on shutdown, bounded by a timeout. `createApp`
(`src/app.ts`) only mounts routes on services it is given: no construction, no disk access.
Providers come from the `ProviderRegistry` built from `ENABLED_PROVIDERS`; nothing looks a
provider up any other way, and a provider's settings (`CLAUDE_*`, the agent's library) are
constructor arguments, not `process.env` reads. Tests assemble the same way through
`test/helpers/app.ts`.

## The Library Service Is Not the Server's

The launcher (`packages/cli`) starts, restarts and stops the Python library service; the
server only calls its API through `src/lib/LibraryClient.ts` at `LIBRARY_URL`. Do not add
code here that spawns Python, reads its runtime layout or restarts it.

## Configuration

Before adding a new environment variable, review `src/config.ts` and `src/env.ts`, and
surface user-facing vars in `.env.example`. The launcher sets the instance's variables
(data directory, ports, `LIBRARY_URL`); `loadConfig` refuses to start without them. The profile decides the port
(`packages/shared/src/ports.ts`, `PORT` overrides) — do not hardcode port numbers.
