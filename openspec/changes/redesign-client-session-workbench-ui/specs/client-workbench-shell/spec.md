## MODIFIED Requirements

### Requirement: Sidebar-based shared navigation shell
The workbench SHALL preserve a shared sidebar-based navigation shell adapted from `temp/client` for the first-stage pages, and the shell SHALL present that navigation as a collapsible workbench sidebar with a thin fixed top bar and route-owned page canvases rather than a static shell presentation.

#### Scenario: Sidebar remains part of the shell
- **WHEN** a user navigates across first-stage workbench pages
- **THEN** the client MUST keep a shared `Sidebar`/navigation layout for the supported shell pages
- **AND** the navigation shell MUST exclude `Inbox` and `Activity` in the first-stage migration

#### Scenario: Session workspace owns its internal layout
- **WHEN** a user opens a supported session route
- **THEN** the session page MUST render inside the shared navigation shell as its own workspace with a thin fixed top bar, a route-owned message canvas, and a docked composer region
- **AND** the shell MUST NOT force the session route to use the legacy fixed three-column `AppShell` layout or a persistent right-side metadata panel

#### Scenario: Desktop shell supports collapse without changing route scope
- **WHEN** the user views the workbench on desktop-width layouts
- **THEN** the shared sidebar MUST support expanded and collapsed presentation states
- **AND** the collapsed state MUST preserve access to the same first-stage routes and session navigation scope rather than replacing the shell with a different navigation model

#### Scenario: Constrained layouts keep navigation available
- **WHEN** the viewport cannot comfortably display the expanded desktop sidebar
- **THEN** the workbench MUST preserve navigation access through a constrained overlay or equivalent compact sidebar behavior
- **AND** the route content canvas MUST remain visually owned by the active page rather than reverting to a static panel grid
