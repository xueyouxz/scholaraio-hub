## MODIFIED Requirements

### Requirement: Local session interaction parity
The migrated local session view SHALL preserve the core interaction behaviors already supported by the backend, and it SHALL implement those behaviors through incremental session updates and server-driven markdown rendering rather than page-wide reloads and plain-text-only output.

#### Scenario: User interacts with a live local session
- **WHEN** a user views or continues a session in the first-stage client
- **THEN** the client MUST support streaming message display, sending input, attachment upload, pending tool approval or question handling, message pagination, and process interaction controls
- **AND** it MUST exclude first-stage-only non-goals such as sharing, voice input, notification-heavy enhancements, and hold-mode UX

#### Scenario: Assistant content streams incrementally
- **WHEN** the session SSE stream emits assistant message updates and markdown augment events
- **THEN** the client MUST update session state incrementally without reloading the entire session on each event
- **AND** the currently streaming assistant response MUST render pending markdown and completed block augments as they arrive

#### Scenario: Completed assistant message uses persisted augment rendering
- **WHEN** a streamed assistant response is completed or later reloaded from session history
- **THEN** the client MUST render the message from server-provided markdown augment HTML when available
- **AND** the raw message text MUST remain available for fallback rendering and copy actions

#### Scenario: Client reconciles live state at bounded checkpoints
- **WHEN** the client performs initial load, older-message pagination, stream completion, session-id replacement, or drift recovery
- **THEN** it MUST reconcile against the persisted session detail response
- **AND** it MUST NOT depend solely on full-page reload behavior for steady-state live updates
