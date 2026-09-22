## ADDED Requirements

### Requirement: Managed literature projects
The application SHALL list, create and manage paper membership only in its managed literature workspaces.

#### Scenario: Internal projects only
- **WHEN** projects are requested
- **THEN** only validated workspaces under the application data root are returned, without external CLI projects or filesystem paths

#### Scenario: Paper membership
- **WHEN** papers are added or removed
- **THEN** the existing refs/papers.json is updated and duplicate additions do not duplicate references

### Requirement: Scoped application sessions
Sessions SHALL persist an optional projectId and resolve literature context within that project while preserving independent CLI directories.

#### Scenario: Empty or missing project
- **WHEN** a project is empty or unavailable
- **THEN** context never falls back to the entire library; unavailable projects produce an error

#### Scenario: Explicit paper selection
- **WHEN** selected papers are outside the project
- **THEN** creation or subsequent execution rejects that selection

#### Scenario: Existing sessions
- **WHEN** a historical session has no projectId
- **THEN** it remains readable and appears under unassigned conversations with unchanged identity
