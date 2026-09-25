# scholaraio (ScholarAIO Hub library service)

The Python library service of ScholarAIO Hub. `pnpm hub setup` installs it into the data
directory's `runtime/python` with uv; the Hub's launcher (`packages/cli`) starts it beside
the Node server on the profile's library port (`LIBRARY_PORT`, the Hub's port + 1). It
admits only this machine's host names, the Hub's page (CORS) and mutating requests that
carry the `ScholarAIO-Hub` header.
How to install and run the Hub: the [root README](../../README.md).

## What is ours and what is upstream

- **Hub code**: `scholaraio/hub/` (services, composition root, migration) and
  `scholaraio/interfaces/api/` (HTTP controllers). Layering and names:
  [docs/architecture.md](../../docs/architecture.md); rules for changing them:
  [`.claude/rules/python.md`](../../.claude/rules/python.md).
- **Upstream code**: everything else (`services/`, `stores/`, `providers/`, `core/`, the
  CLI), imported from [ScholarAIO](https://github.com/ZimoLiao/scholaraio) by Zi-Mo Liao
  through the fork [xueyouxz/scholaraio](https://github.com/xueyouxz/scholaraio) at
  `97725189937e3efff583ddf31f0b6e0d9421baac`, under the MIT license kept in
  [LICENSE](LICENSE). The Python source, license and upstream tests are maintained here
  directly; user data, runtime instances and upstream repository automation were not
  imported. The Hub does not depend on a separately installed ScholarAIO.

Upstream's own agent setup, skills and documentation are not part of this package.

## Tests

`pnpm test:python` from the repository root runs the test files listed in
`scripts/test-python.mjs`, which is what CI runs; add new test files there.
`tests/test_hub_layers.py` checks the import direction between the layers;
`tests/test_hub_openapi.py` checks that the OpenAPI document the Hub's TypeScript types
are generated from (`pnpm gen:library-types`) is current.
