## ADDED Requirements

### Requirement: Provider availability detection
The Settings page SHALL call `GET /api/providers` on mount to determine which providers are available. A provider is considered available when its response payload has `enabled: true`. Claude (`claude` + `claude-ollama`) and Codex (`codex` + `codex-oss`) SHALL each be represented as a single grouped entry.

#### Scenario: Provider is available
- **WHEN** `GET /api/providers` returns a provider with `enabled: true`
- **THEN** the corresponding Claude or Codex entry SHALL be rendered as an active, selectable toggle

#### Scenario: Provider is unavailable
- **WHEN** `GET /api/providers` returns a provider with `enabled: false` or the provider is absent
- **THEN** the corresponding entry SHALL render with a disabled visual style and SHALL NOT be selectable

### Requirement: Provider switcher in Settings LLM section
The Settings page LLM section SHALL present a Claude / Codex switcher as the primary control, replacing any raw API key input area. Selecting a provider SHALL update the active provider state and reload the project list below.

#### Scenario: User switches provider
- **WHEN** a user clicks an available provider entry
- **THEN** the active provider state MUST update to the selected provider
- **AND** the project list below MUST reload to show only projects whose `provider` field matches the selected provider group (`claude` or `claude-ollama` for Claude; `codex` or `codex-oss` for Codex)

### Requirement: Project selection within active provider
Below the provider switcher, the Settings page SHALL display a list of projects belonging to the active provider, sourced from `GET /api/projects` filtered by `provider`. The user SHALL be able to select one project as the active project.

#### Scenario: User selects a project
- **WHEN** a user clicks a project in the provider-filtered list
- **THEN** the active project state MUST update to the selected project ID
- **AND** the Sidebar session list MUST immediately reflect only sessions belonging to that project

#### Scenario: No projects exist for the selected provider
- **WHEN** `GET /api/projects` returns no projects matching the active provider group
- **THEN** the project list area MUST display an empty-state message
- **AND** no project SHALL be auto-selected

### Requirement: Provider and project selection persistence
The selected provider and selected project ID SHALL be persisted to `localStorage` under the keys `selectedProvider` and `selectedProjectId`. On app load, the client SHALL restore these values if present and still valid.

#### Scenario: State is restored on reload
- **WHEN** the client loads and `localStorage` contains `selectedProvider` and `selectedProjectId`
- **THEN** the provider switcher MUST restore the stored provider
- **AND** the Sidebar MUST filter sessions by the stored project without requiring the user to reopen Settings

#### Scenario: Stored project no longer exists
- **WHEN** the client loads and the stored `selectedProjectId` is not present in `GET /api/projects`
- **THEN** the client MUST clear the stale selection and show an unselected state

### Requirement: Sidebar session list scoped to active project
When an active project is selected, the Sidebar session list SHALL display only sessions belonging to that project, fetched from `GET /api/projects/:projectId/sessions`. When no project is selected, the Sidebar SHALL display sessions across all projects as before.

#### Scenario: Active project is set
- **WHEN** `selectedProjectId` is set in application state
- **THEN** the Sidebar session list MUST fetch and display sessions from `GET /api/projects/:projectId/sessions` for that project only

#### Scenario: No active project is set
- **WHEN** `selectedProjectId` is absent or cleared
- **THEN** the Sidebar session list MUST display sessions across all projects using the existing aggregated fetch behavior
