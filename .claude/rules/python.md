---
paths:
  - "packages/scholaraio/scholaraio/hub/**"
  - "packages/scholaraio/scholaraio/interfaces/api/**"
---

# Python Library Service Rules (`scholaraio.hub`, `interfaces/api`)

Layering and names: [`docs/architecture.md`](../../docs/architecture.md)
("Python 文献服务分层"). `tests/test_hub_layers.py` enforces the import direction.

## Controllers Stay Thin

A route in `interfaces/api/routes/` parses the request, calls one service and returns
its result. File access, validation of domain rules, clamping and scoping belong in the
service. Ask for the service through `dependencies.py` (`papers: Papers`), never
`request.app.state`.

## Services Receive Their Collaborators

A service takes `LibraryRuntime` and the sibling services it uses as constructor
arguments. It never imports or references `HubLibrary`; wiring happens only in
`hub/library.py`. Papers are read through `runtime.papers` (`PaperRepository`) and shown
through `hub/views.py`, not by walking `iter_paper_dirs` again.

## Errors

Raise `InvalidRequest` / `NotFound` / `TooLarge` from `hub/errors.py` for anything the
caller caused. Data on disk that exists but cannot be read is a `RuntimeError` (500).
Do not rely on a builtin `KeyError` becoming a 404.

## Wire Format

Request models extend `CamelModel` (snake_case attributes, camelCase JSON); query
parameters use `Query(alias=...)`. Every JSON route declares a `response_model` from
`interfaces/api/responses.py`; one whose model has defaults also sets
`response_model_exclude_unset=True`, so a field the service left out stays out.

The TypeScript types for these shapes are generated from the OpenAPI document, never
written by hand: after changing a route or model run `pnpm gen:library-types` and commit
`packages/shared/src/generated/` with it (`tests/test_hub_openapi.py` and `pnpm lint`
fail otherwise). Changing a path, field name or status code is a contract change: update
the server and client callers in the same change.

## Tests

New test files for these packages must be added to `scripts/test-python.mjs`, which is
what CI runs.
