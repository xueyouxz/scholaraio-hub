## MODIFIED Requirements

### Requirement: Sidebar-based shared navigation shell
The workbench SHALL preserve a shared sidebar-based navigation shell styled according to the `reference/sections/SidebarReference.tsx` visual design using Tailwind 4 utility classes. The shell SHALL let each supported route own its internal workspace layout. The Sidebar SHALL render navigation entries for ALL planned pages including Library, Search, Reader, and Workspaces; entries for pages not yet implemented SHALL render with a disabled visual style and SHALL NOT be navigable.

#### Scenario: Sidebar remains part of the shell
- **WHEN** a user navigates across first-stage workbench pages
- **THEN** the client MUST keep a shared `Sidebar`/navigation layout for the supported shell pages
- **AND** the Sidebar navigation MUST render entries for Chat, Library, Search, Reader, Workspaces, and Settings
- **AND** Library, Search, Reader, and Workspaces entries MUST render as visually disabled and MUST NOT respond to clicks

#### Scenario: Session workspace owns its internal layout
- **WHEN** a user opens a supported session route
- **THEN** the session page MUST render inside the shared navigation shell as its own workspace with route-owned header, message pane, and composer regions
- **AND** the shell MUST NOT force the session route to use a fixed three-column legacy layout

#### Scenario: Sidebar uses reference visual design
- **WHEN** the Sidebar renders
- **THEN** it MUST use Tailwind 4 utility classes derived from the reference theme tokens
- **AND** it MUST NOT use legacy BEM CSS class names from `styles.css`

## ADDED Requirements

### Requirement: TopNav title bar in NavigationLayout
`NavigationLayout.tsx` SHALL include a thin fixed top bar (TopNav) that displays the current page title. The title SHALL be injected by the active route/page via a React Context. The TopNav SHALL NOT include search, notification, or user avatar elements in phase one.

#### Scenario: Page title is displayed
- **WHEN** a user navigates to any page within the shell
- **THEN** the TopNav MUST display the title provided by that page's context value
- **AND** the TopNav MUST NOT render search, notification icons, or user avatar controls

#### Scenario: No title context value provided
- **WHEN** a page does not provide a title via context
- **THEN** the TopNav MUST render without a title or with an empty placeholder
- **AND** the layout MUST NOT crash or display an error
