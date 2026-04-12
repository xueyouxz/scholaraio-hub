## Purpose

Define the required shell, routing, and navigation behavior for the local React workbench in `packages/client`.
## Requirements
### Requirement: React workbench shell
The client SHALL replace the existing minimal `packages/client` shell with a React-based workbench shell derived from `temp/client` so that the local frontend can host the migrated route, layout, and shared state architecture.

#### Scenario: React client entrypoint is established
- **WHEN** the client package is built or started for development
- **THEN** it MUST use a React-compatible entrypoint and build configuration under `packages/client`
- **AND** the migrated shell MUST be sourced from the local-workbench architecture in `temp/client` rather than a newly invented page structure

### Requirement: First-stage local workbench routes
The client SHALL provide first-stage local workbench routes for `Projects`, `Sessions`, `Session`, `New Session`, `Agents`, `File`, and `Settings`.

#### Scenario: Supported routes are available
- **WHEN** a user navigates within the first-stage client
- **THEN** the workbench MUST expose routes and pages for `Projects`, `Sessions`, `Session`, `New Session`, `Agents`, `File`, and `Settings`
- **AND** `File` MAY use its own layout while the primary workbench pages use the shared navigation shell

### Requirement: Sidebar-based shared navigation shell
The workbench SHALL preserve a shared sidebar-based navigation shell adapted from `temp/client` for the first-stage pages, and the shell SHALL let each supported route own its internal workspace layout rather than inheriting the current static multi-column grid.

#### Scenario: Sidebar remains part of the shell
- **WHEN** a user navigates across first-stage workbench pages
- **THEN** the client MUST keep a shared `Sidebar`/navigation layout for the supported shell pages
- **AND** the navigation shell MUST exclude `Inbox` and `Activity` in the first-stage migration

#### Scenario: Session workspace owns its internal layout
- **WHEN** a user opens a supported session route
- **THEN** the session page MUST render inside the shared navigation shell as its own workspace with route-owned header, message pane, and composer regions
- **AND** the shell MUST NOT force the session route to use the legacy fixed three-column `AppShell` layout

### Requirement: Unsupported frontend branches are excluded
The first-stage workbench SHALL exclude UI branches that depend on unsupported backend capabilities.

#### Scenario: Unsupported routes are not carried into the first stage
- **WHEN** the migrated client is assembled from `temp/client`
- **THEN** it MUST omit remote mode, relay/login flows, SRP or encryption transport flows, emulator/device workflows, and mobile-specific branches
- **AND** it MUST NOT expose partially wired placeholders for those unsupported capabilities in the first-stage workbench

