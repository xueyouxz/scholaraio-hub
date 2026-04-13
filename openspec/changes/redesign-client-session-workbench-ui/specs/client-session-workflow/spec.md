## MODIFIED Requirements

### Requirement: Local session interaction parity
The migrated local session view SHALL preserve the core interaction behaviors already supported by the backend, and it SHALL present those behaviors through a compact timeline-style workspace with docked input, document-style assistant prose, visible tool activity, collapsed thinking details, and server-driven markdown rendering rather than page-wide reloads and card-stacked plain-text output.

#### Scenario: User interacts with a live local session
- **WHEN** a user views or continues a session in the first-stage client
- **THEN** the client MUST support streaming message display, sending input, attachment upload, pending tool approval or question handling, and message pagination
- **AND** the session workspace MUST NOT reserve a persistent right-side metadata or process-controls panel

#### Scenario: Assistant content streams incrementally
- **WHEN** the session SSE stream emits assistant message updates and markdown augment events
- **THEN** the client MUST update session state incrementally without reloading the entire session on each event
- **AND** the currently streaming assistant response MUST render pending markdown and completed block augments as they arrive inside the active timeline turn

#### Scenario: Completed assistant message uses persisted augment rendering
- **WHEN** a streamed assistant response is completed or later reloaded from session history
- **THEN** the client MUST render the message from server-provided markdown augment HTML when available
- **AND** the rendered assistant prose MUST read as document-style content while code blocks and machine-state blocks retain stronger terminal-style framing

#### Scenario: Timeline surfaces tool and thinking states appropriately
- **WHEN** an assistant turn contains tool activity or thinking content
- **THEN** tool-related blocks MUST remain visible by default inside the session timeline
- **AND** thinking content MUST render in a collapsed summary state by default with a way to inspect the underlying details

#### Scenario: Client reconciles live state at bounded checkpoints
- **WHEN** the client performs initial load, older-message pagination, stream completion, session-id replacement, or drift recovery
- **THEN** it MUST reconcile against the persisted session detail response
- **AND** it MUST NOT depend solely on full-page reload behavior for steady-state live updates

#### Scenario: Composer remains attached to the active workspace
- **WHEN** the user scrolls through a live or historical session
- **THEN** the primary composer MUST remain available as a bottom-docked workspace input surface
- **AND** the message canvas MUST reserve enough bottom space so the docked composer does not obscure the final visible content or pending-interaction surfaces
