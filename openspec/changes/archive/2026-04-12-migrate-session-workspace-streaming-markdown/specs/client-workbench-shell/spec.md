## MODIFIED Requirements

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
