## Context

`packages/client` already completed the structural migration away from the legacy shell and now has a sidebar-based navigation layout, a route-owned session workspace, and a streaming markdown pipeline. What remains incomplete is the interaction contract of that workspace: the sidebar still behaves like a transitional information rail, the session page still presents metadata and controls in a persistent side panel, and the message stream still reads like stacked cards rather than the tighter event-flow workbench the product direction now calls for.

The redesign must stay inside the repository's existing frontend constraints. `.design-docs/DESIGN.md` remains the visual source of truth for color, typography, and surface hierarchy, and the change must not expand the product surface or backend protocol. The target is therefore a UI-shell and session-surface refactor: reuse the proven structural cues from `temp/client`, preserve ScholarAIO branding, and keep existing state/data contracts intact.

## Goals / Non-Goals

**Goals:**
- Introduce a collapsible workbench sidebar that keeps the current route/navigation surface but adopts a denser, more intentional shell structure.
- Recompose the session page into a thin fixed top bar, a compact timeline/event-flow message region, and a bottom-docked floating composer.
- Remove the persistent right-side metadata/process panel and redistribute only the minimum necessary structural elements into the top bar and inline session surfaces.
- Define a consistent content treatment where normal assistant markdown reads like document prose inside the timeline while code/tool-oriented output keeps a denser machine-like presentation.
- Preserve the existing streaming markdown, pagination, pending-input, and session send/resume behavior while changing their visual contract.

**Non-Goals:**
- Port the entire `temp/client` product interaction model, including advanced sidebar resizing, global session aggregation, inbox/activity surfaces, or mobile gesture parity.
- Change backend APIs, SSE event types, session ownership semantics, or provider/model support.
- Reintroduce session header actions or right-side process panels under a different name.
- Expand the renderer stack into the full `temp/client` render-item architecture in this change.

## Decisions

### Decision: Treat the redesign as a shell-and-workspace contract update, not a feature migration

The change will keep the existing `packages/client` routing, page responsibilities, and session state hooks, while replacing presentation structure and visual hierarchy around them.

Rationale:
- Preserves the already-migrated architecture and avoids reopening protocol/state work that is not part of the user request.
- Keeps the implementation safely scoped to UI modules and styling, which is the actual requirement-level change.
- Prevents accidental reintroduction of unsupported `temp/client` branches.

Alternatives considered:
- Rebase the current client UI directly on top of `temp/client` components. Rejected because it would blur the boundary between visual migration and product-surface migration.
- Keep the current component structure and restyle it lightly. Rejected because the requested session workspace shape requires structural layout changes, not only token adjustments.

### Decision: Use a collapsible sidebar and ultra-thin top bar as the new workbench frame

The shared shell will move to a clearer workbench frame: collapsible desktop sidebar, overlay behavior on constrained widths, and a fixed top bar that only contains the sidebar toggle, session title, and alignment affordances.

Rationale:
- Matches the agreed interaction model without importing the heavier desktop resizing or toolbar actions from `temp/client`.
- Keeps the route canvas stable while freeing the session page from its current panelized composition.
- Gives the session workspace a persistent structural anchor without reintroducing metadata noise.

Alternatives considered:
- Fixed-width sidebar with no top bar. Rejected because it weakens navigation ergonomics in collapsed or constrained layouts.
- Top bar carrying provider/model/status/actions. Rejected because the user explicitly removed those elements from the session workspace contract.

### Decision: Render the session stream as compact timeline turns rather than message cards

Assistant and user messages will be regrouped visually as a compact event-flow stream. Assistant bodies will use weak framing so the turn container and timeline affordances define structure, while user prompts retain stronger delimitation.

Rationale:
- Aligns the session experience with the agreed `temp/client`-inspired workbench direction.
- Solves the current mismatch where streamed assistant content competes with card chrome instead of reading as a continuous event flow.
- Provides a natural home for tool rows, pending blocks, and collapsed thinking affordances.

Alternatives considered:
- Keep current stacked chat cards and only tighten spacing. Rejected because it would not materially change the interaction model.
- Fully remove turn grouping and render a flat activity log. Rejected because the assistant response still needs readable turn boundaries.

### Decision: Split content treatment into document-style prose and terminal-style machine blocks

Normal markdown output will use lighter document-oriented typography and spacing within each assistant turn. Code blocks, tool rows, pending approvals, and similar machine-state artifacts will use denser containers with stronger borders/backgrounds.

Rationale:
- Preserves readability for prose while keeping visible process context in the same stream.
- Reflects the agreed distinction between “正文文档化” and “代码/工具块终端化”.
- Allows streaming augment HTML to remain the rendering source of truth without requiring a new renderer architecture.

Alternatives considered:
- Apply the same compact terminal styling to all markdown content. Rejected because it degrades long-form assistant output.
- Apply full document-card styling to all assistant output. Rejected because it would underplay visible tool activity and move away from the desired event-flow feel.

### Decision: Remove the persistent right-side session panel and dock the composer to the bottom of the workspace

The page will no longer reserve horizontal space for a session metadata/process-controls side panel. The composer will become a bottom-docked floating surface so the timeline remains the dominant middle column.

Rationale:
- Restores horizontal space to the message stream, which is necessary for the new timeline composition.
- Reduces visual fragmentation; metadata/process chrome is no longer treated as a peer column to the conversation itself.
- Matches the agreed workbench feel more closely than the current in-flow composer card.

Alternatives considered:
- Keep a slimmer right-side panel. Rejected because any persistent panel continues to split focus and constrain the stream.
- Dock the composer inline at the end of the message list. Rejected because it weakens the sense of a persistent workspace input surface.

## Risks / Trade-offs

- [Shell and session changes span multiple shared components] → Keep route and data responsibilities stable and confine the redesign to layout composition, presentational components, and CSS contract changes.
- [A denser timeline layout can reduce readability if over-compressed] → Use compact turn spacing while preserving clear typography and stronger separation for headings, lists, code, and tool blocks.
- [Removing visible process controls could hide supported backend capabilities] → Keep pending-input and required inline machine-state surfaces visible inside the session stream, and defer any future explicit controls to separate scoped work.
- [ScholarAIO design rules can drift if temp-client cues dominate implementation] → Treat `.design-docs/DESIGN.md` as canonical for tokens, typography, and surface hierarchy; only borrow `temp/client` for structural composition and density.
- [Composer docking can obscure the last message or interactive blocks] → Reserve bottom padding in the scroll region based on composer height and validate pending-input / approval surfaces near the viewport bottom.

## Migration Plan

1. Refactor the shared navigation layout and sidebar classes so the shell exposes collapsed and expanded states with a thin fixed top bar.
2. Recompose the session page layout to remove the right-side panel, establish the timeline content column, and convert the composer into a docked surface.
3. Update message-list, message-item, and text-block presentation so turn grouping, thinking collapse behavior, tool visibility, and markdown block styling match the new contract.
4. Restyle workspace-level CSS tokens and selectors in `packages/client/src/styles.css` to implement the new shell, timeline, and composer behaviors while preserving design-system colors and typography.
5. Validate desktop and constrained-width behavior, streaming markdown rendering, pagination, pending-input visibility, and send flow spacing before implementation sign-off.

Rollback strategy:
- Revert the shell, session layout, and styling changes together to restore the current sidebar/session presentation.
- Because data contracts stay unchanged, rollback remains a frontend-only revert with no migration or persistence impact.

## Open Questions

- Whether the first implementation should preserve a minimal inline surface for process interruption in the timeline itself or omit process controls entirely until a follow-up change reintroduces them under a separate UX contract.
