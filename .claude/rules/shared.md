---
paths:
  - "packages/shared/**"
---

# Shared Rules (`packages/shared`)

Scope: types, Zod schemas, ports, and helpers consumed by both `client` and `server`.
Terms used here are defined in [`../glossary.md`](../glossary.md).

## Single Source of Truth

`packages/shared` is the canonical home for cross-cutting contracts:

- **Ports**: `src/ports.ts` (`DEFAULT_PORT`, derived `app`/`client`/`preview`). Server and
  client must derive ports from here, not redefine them.
- **Schemas / types**: `src/claude-sdk-schema/`, `src/codex-schema/`, `src/session/`,
  `src/types.ts`, etc. Consumers import these rather than re-declaring shapes.

A change here is a contract change — update both consumers and their tests in the same
change.

## Import Discipline

- `client` and `server` consume shared code via the `@scholaraio-hub/shared` package
  entry, not deep relative paths into `packages/shared/src`.
- Prefer small modules under the relevant package over cross-package imports that bypass
  `@scholaraio-hub/shared`.

## Testing

Shared tests live in `packages/shared/test/` (e.g. `test/ports.test.ts`). Add or update
tests for schema and port changes.
