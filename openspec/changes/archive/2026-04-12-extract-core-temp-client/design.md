## Context

The repository currently ships a minimal `packages/client` implementation that does not reflect the frontend architecture already explored in `temp/client`. The temporary client contains the desired route structure, shared layout, page composition, and interaction model, but it also includes entire branches for remote access, relay authentication, SRP/encryption transport, emulator/device workflows, and notification-heavy enhancements that are not aligned with the current server surface in `packages/server`.

This change is a cross-cutting frontend migration. It affects client package dependencies, the root Vite configuration, routing, shared UI structure, session interaction flows, and compatibility handling for historical session providers. The agreed implementation constraint is to preserve the `temp/client` organization wherever possible, migrate the local-workbench backbone first, and then remove unsupported branches during a red-to-green cleanup phase.

## Goals / Non-Goals

**Goals:**
- Turn `packages/client` into a React-based client package capable of hosting the migrated workbench architecture.
- Preserve the `temp/client` route/layout/page/component/hook structure where it supports the local product path.
- Deliver a first-stage local workbench containing `Projects`, `Sessions`, `Session`, `New Session`, `Agents`, `File`, and `Settings`.
- Preserve core session behaviors already supported by the backend: streaming, attachments, pending input handling, pagination, provider/model display, and process controls.
- Keep new-session configuration aligned with backend capabilities while remaining extensible for future providers.
- Preserve display compatibility for historical session data using non-primary providers such as `claude-ollama` and `codex-oss`.

**Non-Goals:**
- Supporting remote login, relay routing, SRP/encryption transport, or secure remote connection abstractions.
- Supporting emulator/device pages, mobile-specific flows, or device stream controls.
- Shipping Inbox or Activity in the first-stage navigation.
- Shipping voice input, sharing, push/browser notification enhancements, or hold-mode UX in the first implementation slice.
- Redesigning the migrated UI into a new architecture unrelated to `temp/client`.

## Decisions

### 1. Use whole-shell migration rather than selective rebuild

`temp/client` has strong coupling across pages, hooks, contexts, and components, especially around session rendering and message streaming. Migrating the local workbench shell wholesale minimizes reinvention and best preserves the already-validated implementation.

Alternatives considered:
- Selective module extraction: rejected because dependency chasing would effectively turn the work into a rebuild.
- Rewriting `packages/client` from scratch: rejected because it conflicts with the goal of preserving `temp/client` behavior and structure.

### 2. Convert `packages/client` to a React/Vite React client

The migration target cannot preserve `temp/client` meaningfully without React, React Router, and React-driven state composition. The client package and root Vite config will therefore be upgraded to support a React entrypoint and React-specific build pipeline.

Alternatives considered:
- Keeping the current non-React shell: rejected because it would force a rewrite of nearly every migrated module.
- Hybridizing with ad hoc DOM mounting: rejected because it adds complexity without preserving the source architecture.

### 3. Treat unsupported branches as explicit exclusions, not partially wired placeholders

Remote mode, relay/login, encryption/SRP, emulator/device modules, Inbox, Activity, sharing, voice input, and notification-heavy enhancements will be removed from the first-stage migrated client rather than left behind as dead or partially functional UI. This keeps the resulting client aligned with current server capabilities and avoids false affordances.

Alternatives considered:
- Leaving hidden or disabled routes in place: rejected because it keeps unsupported dependencies and makes stabilization harder.
- Mocking missing backends in the client: rejected because it would distort the implementation target and create rework later.

### 4. Preserve feature-complete local session workflows in the first stage

The first-stage client will keep the high-value local workflows from `temp/client`: session creation with provider/model/permission/thinking/attachments, streaming conversations, file uploads, pending tool approval and user-question handling, process controls, and paginated message history. These behaviors already map to backend routes and should remain intact during migration.

Alternatives considered:
- Reducing the first stage to read-only or text-only chat: rejected because it would cut out already-supported core behavior and force immediate follow-up refactors.

### 5. Restrict creation to active providers while preserving historical display compatibility

The new-session experience will only offer backend-enabled providers (`claude`, `codex`), but list/detail rendering will continue to display historical providers such as `claude-ollama` and `codex-oss`. This avoids false creation paths while preserving fidelity for existing data.

Alternatives considered:
- Exposing only `claude` and `codex` everywhere: rejected because it obscures historical session provenance.
- Exposing all historical providers as creation options: rejected because the backend does not currently support them as active choices.

### 6. Keep Sidebar as the navigation shell and defer aggregate surfaces

The migrated shell will keep `NavigationLayout` and `Sidebar` because they are structural to the workbench. Aggregate surfaces such as Inbox and Activity will be deferred to a later change so the first migration can focus on the core production path.

Alternatives considered:
- Deferring the sidebar too: rejected because that would undercut the workbench structure we are trying to preserve.
- Migrating Inbox and Activity immediately: rejected because they introduce additional context/state coupling beyond the first-stage scope.

## Risks / Trade-offs

- [Large initial compile breakage after shell migration] -> Mitigation: migrate in coherent route/layout/component batches, then remove unsupported branches immediately and keep typecheck/build as the stabilization gate.
- [Temp-client dependencies may pull in unsupported local concerns] -> Mitigation: classify imports early into keep/remove/replace buckets and delete entire branch roots such as remote, relay, and emulator modules instead of patching them piecemeal.
- [Historical provider handling may regress if display code is over-trimmed] -> Mitigation: preserve broad provider enums in display components even while narrowing new-session options.
- [Root Vite changes can affect developer workflow] -> Mitigation: confine React/Vite changes to the existing `packages/client` root and verify dev/build/typecheck behavior after the migration shell lands.
- [Scope creep from adjacent enhancements] -> Mitigation: treat Inbox, Activity, voice, sharing, notifications, and hold mode as explicit non-goals in tasks and implementation review.

## Migration Plan

1. Upgrade `packages/client` and root Vite config to support a React entrypoint and required dependencies.
2. Copy the local-workbench shell from `temp/client` into `packages/client`, prioritizing routes, layout, pages, contexts, hooks, and components needed for the agreed page set.
3. Remove unsupported branch roots and replace any remaining references that depend on remote, relay, auth, device, or notification-heavy modules.
4. Reconcile API and shared-type imports with `@scholaraio-hub/shared` and the current backend route surface.
5. Stabilize the migrated client with build/typecheck and targeted interaction verification on the first-stage pages.

Rollback strategy:
- The migration is isolated to client-facing code and build configuration. If the workbench shell is not stable, revert the client package and Vite dependency/config changes together.

## Open Questions

- Whether Inbox and Activity should be restored as a follow-up change or folded into a broader second-stage frontend parity effort.
- Whether future provider re-expansion should reuse the preserved display-level compatibility layer or introduce explicit provider capability segmentation in the UI.
