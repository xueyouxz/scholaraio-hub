## ADDED Requirements

### Requirement: Workbench sidebar
The client SHALL provide new conversation, Library and Skills navigation, grouped internal projects and a bottom settings entry, with remembered resizable desktop width and mobile navigation.

#### Scenario: Sidebar navigation
- **WHEN** a user opens Skills, a project or settings
- **THEN** the selected destination is functional and settings remains at the bottom independently of scrolling history

### Requirement: AI defaults
Settings SHALL persist Claude Code or Codex and an optional compatible model; new conversations inherit these defaults without changing existing conversations.

#### Scenario: Tool change
- **WHEN** a user selects another tool and reloads
- **THEN** the selection persists and new conversations use it without inheriting the previous tool's model

### Requirement: Literature cards and reading
The library SHALL offer card/list views, selection, paper detail overview and PDF/full-text reading with working citations and saved position.

#### Scenario: Reading from a card
- **WHEN** the user opens a paper card
- **THEN** they can inspect its metadata, read PDF/full text and start a cited conversation

### Requirement: Shared bottom composer
New and existing conversations SHALL use a docked composer with scoped drafts, removable paper context, multiline input and sending state.

#### Scenario: Input and recovery
- **WHEN** users compose with a Chinese IME, insert a newline or encounter a send failure
- **THEN** composition does not submit prematurely, Shift+Enter inserts a newline and failed text remains recoverable

#### Scenario: First message and interruption
- **WHEN** a user sends a first message or stops an existing run
- **THEN** the first message is sent once and interruption, approvals, reload and reconnect remain tied to the same application session
