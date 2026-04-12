## Requirements

### Requirement: New session configuration workflow
The client SHALL support first-stage local session creation with provider, model, permission mode, thinking mode, first message, and attachment upload configuration.

#### Scenario: User creates a configured session
- **WHEN** a user opens the new-session workflow
- **THEN** the form MUST allow configuration of provider, model, permission mode, thinking mode, first message, and attachments
- **AND** the form MUST submit using the backend-supported local session creation flow

### Requirement: Provider choices follow active backend support
The client SHALL restrict new-session provider choices to backend-supported providers while keeping the UI architecture extensible for future provider growth.

#### Scenario: Only active providers are selectable for new sessions
- **WHEN** the new-session form renders provider options
- **THEN** it MUST offer only the currently supported creation providers `claude` and `codex`
- **AND** the underlying UI structure MUST remain capable of rendering provider-specific labels, models, and capabilities without being hard-coded to a one-off two-provider design

### Requirement: Local session interaction parity
The migrated local session view SHALL preserve the core interaction behaviors already supported by the backend.

#### Scenario: User interacts with a live local session
- **WHEN** a user views or continues a session in the first-stage client
- **THEN** the client MUST support streaming message display, sending input, attachment upload, pending tool approval or question handling, message pagination, and process interaction controls
- **AND** it MUST exclude first-stage-only non-goals such as sharing, voice input, notification-heavy enhancements, and hold-mode UX

### Requirement: Historical provider sessions remain viewable
The client SHALL preserve display compatibility for historical session providers even when those providers are not available as new-session choices.

#### Scenario: Historical provider session is rendered
- **WHEN** a session summary or session detail references a historical provider such as `claude-ollama` or `codex-oss`
- **THEN** the client MUST render the provider label and session normally in list and detail views
- **AND** the client MUST NOT surface those historical providers as selectable options in the new-session workflow
