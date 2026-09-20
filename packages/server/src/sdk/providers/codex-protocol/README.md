# Codex Protocol Subset

`generated/` contains the checked-in subset of `codex app-server generate-ts`
types consumed through `index.ts`. Do not hand-edit generated files.

This checkout does not provide the older `codex:protocol:update` / `check`
scripts or enforce a single installed CLI version. Before replacing generated
output, regenerate with the intended CLI version in a temporary directory,
review the used protocol changes, and audit the provider and tests together.

The workbench compatibility audit is recorded in
[docs/library-workbench.md](../../../../../../docs/library-workbench.md).
Offline fixtures exercise initialize, native policies, text deltas, approvals,
completion, and interruption. The opt-in `workbench-real.test.ts` verifies native
multi-turn continuation and restart recovery against an installed CLI.
