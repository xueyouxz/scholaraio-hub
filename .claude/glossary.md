# Glossary

Shared domain language for `scholaraio-hub`. Use these terms precisely in code, comments,
commits, and instructions so humans and agents mean the same thing.

- **Session** — A conversation a provider (Claude Code, Codex) keeps, whether the Hub or a
  terminal started it. Identified by the provider's own id, as `sessionKey(provider,
  nativeId)` (see [Session Identity in server rules](rules/server.md)). The Hub's record
  of it (`SessionStore`) holds only what the Hub adds.
- **Project** — A directory sessions run in (their `cwd`), as the providers' histories list
  them (`ProjectCatalog`, `packages/server/src/projects/`). Its id is the path,
  base64url-encoded. Sessions run in no project's directory (temporary folders, the Hub's
  data directory, the Claude and Codex apps' folderless chats) are **unassigned**. A folder
  no session ran in yet is added by choosing it in the system's own folder dialog
  (`FolderPicker`), as Claude Code does.
- **Literature collection** — A named set of papers in the library (`LiteratureCollection`
  in `packages/shared/src/library.ts`, `/collections` on the library service). A session
  refers to collections and single papers (its **references**, `@` in the composer), and
  each turn is answered from their passages. A collection is never a directory agents work
  in.
- **Provider** — An upstream coding agent backend integrated under
  `packages/server/src/providers/` (`claude/`, `codex/`; each owns its wire format, CLI and
  usage parsing, and the hub sees only the contract in `providers/types.ts` and
  `providers/events.ts`). What each offers is its `ProviderCapabilities` descriptor — see
  [`topics/session-state.md`](topics/session-state.md).
- **Supervisor** — The server component (`packages/server/src/supervisor/`) that owns the
  provider processes, one per session keyed by its session id. It is the one place that
  decides whether a live process still matches what a session asks for (provider, native
  conversation, model, thinking, effort) and replaces it otherwise; it reaps stale ones.
  The composition root creates it; `SessionService` is the only consumer of its process
  events for sessions (the usage display also listens, for rate limits).
- **Watcher** — A file-system watcher that observes on-disk changes and emits updates: the
  server's `HistoryWatcher` (`packages/server/src/projects/`) on the providers' session
  files, and the library service's collection watcher in
  `packages/scholaraio/scholaraio/hub/watcher.py`.
- **Subscription** — A registered interest in a stream of updates (a session run's listeners
  in `packages/server/src/sessions/Turn.ts`). Subscriptions must
  be released when the client disconnects (see
  [`topics/resource-lifecycle.md`](topics/resource-lifecycle.md)).
- **Session stream** — A run's UI message stream: the client reads it through
  `useSessionChat` and lays each assistant message out with
  `packages/client/src/features/session/transcript/model/` (`turnTree.ts`, `activity.ts`).
- **Turn** — One request/response cycle within a session. Process state is `in-turn` while
  a turn is active; the session is `running` (or `waiting-input`). See
  [`topics/session-state.md`](topics/session-state.md).
- **Run** — The server side of one turn, a `Turn` (`packages/server/src/sessions/Turn.ts`)
  that `SessionService` starts: its stream chunks, listeners, checkpoints and how it ended
  (`idle`, `interrupted`, `error`).
- **Compaction** — Provider-side context compression; the composer reports when it will
  happen (`autoCompactThreshold`).
- **Generated protocol code** — Output under
  `packages/server/src/providers/codex/protocol/generated/`. Do not hand-edit; see the
  audit gate in [server rules](rules/server.md).
