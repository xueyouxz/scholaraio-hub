---
paths:
  - "packages/shared/**"
---

# Shared Rules (`packages/shared`)

Scope: types, Zod schemas, ports, and helpers consumed by both `client` and `server`.
Terms used here are defined in [`../glossary.md`](../glossary.md).

## Single Source of Truth

`packages/shared` is the canonical home for cross-cutting contracts:

- **Profile and ports**: `src/ports.ts` (`resolveProfileName`, `resolvePort`,
  `resolveLibraryPort`). Each profile has the Hub's port (page, API and, in development,
  Vite) and the library service's port; the page names the latter in
  `LIBRARY_PORT_META`. Nothing else may redefine port defaults.
- **HTTP protocol**: `src/http.ts` (the `{ id, code, message, data }` envelope and the error
  codes with their statuses), shared by the server, the client and, through the contract
  test, the library service. See `docs/http-api.md`.
- **Schemas / types**: `src/session/session.ts` (the session contract), `src/projects.ts`
  (projects and session lists),
  `src/library.ts` (library API shapes, aliases of the types generated into
  `src/generated/` from the library service's OpenAPI document), `src/types.ts` (providers, capabilities,
  permissions). Consumers import these rather than re-declaring shapes; a type
  no consumer imports is removed, not kept "for later".

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
