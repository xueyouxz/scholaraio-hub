## 1. Shell Frame

- [x] 1.1 Refactor the shared navigation layout to support a collapsible desktop sidebar, constrained-width overlay behavior, and a thin fixed top bar contract.
- [x] 1.2 Rework the sidebar component structure and styling so it keeps the current navigation/project/session scope while matching the denser workbench presentation.

## 2. Session Workspace Layout

- [x] 2.1 Recompose the session page to remove the persistent right-side metadata/process panel and establish a single dominant timeline content column.
- [x] 2.2 Replace the current session header presentation with a thin fixed top bar that only carries sidebar toggle, session title, and alignment spacing.

## 3. Timeline Rendering

- [x] 3.1 Update message list and message item presentation so the session stream reads as compact timeline/event-flow turns instead of stacked cards.
- [x] 3.2 Restyle assistant text rendering so prose uses lighter document-style formatting while code, tool, pending, and machine-state blocks keep stronger terminal-style framing.
- [x] 3.3 Change thinking and tool block presentation so tool activity remains visible by default and thinking content renders collapsed by default with an inspectable details surface.

## 4. Docked Composer

- [x] 4.1 Convert the session composer into a bottom-docked floating input surface with compact controls and workspace-attached positioning.
- [x] 4.2 Add scroll-region spacing and responsive behavior so the docked composer does not obscure final messages, pending input, or interactive stream surfaces.

## 5. Validation

- [x] 5.1 Verify the redesigned shell and session workspace against the updated OpenSpec requirements for collapse behavior, route ownership, timeline rendering, and docked input.
- [x] 5.2 Run the relevant client checks and capture any remaining UI risks or follow-up items before implementation sign-off.
