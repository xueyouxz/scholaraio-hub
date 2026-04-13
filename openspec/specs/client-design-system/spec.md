## Purpose

Define the design system and styling infrastructure for the `packages/client` frontend.

## Requirements

### Requirement: Tailwind 4 CSS framework adoption
`packages/client` SHALL use Tailwind CSS 4 as its sole styling framework, installed via the `@tailwindcss/vite` Vite plugin. All component styles SHALL be expressed as Tailwind utility classes; hand-written BEM CSS classes SHALL be removed.

#### Scenario: Tailwind is the active CSS framework
- **WHEN** the client is built or served in development
- **THEN** the Vite build pipeline MUST process Tailwind 4 directives via `@tailwindcss/vite`
- **AND** no hand-written BEM class names from the legacy `styles.css` SHALL remain in component JSX

### Requirement: Reference @theme token system
The client SHALL adopt the `@theme` token definitions from `reference/styles/reference-theme.css` as its design token source. `styles.css` SHALL be replaced with a Tailwind 4 entry file that imports the reference theme tokens and any global base resets.

#### Scenario: Design tokens are available as Tailwind utilities
- **WHEN** a component uses a token-derived utility such as `bg-surface`, `text-on-surface`, or `text-primary`
- **THEN** the class MUST resolve to the corresponding `@theme` variable value
- **AND** all color, typography, radius, and spacing tokens defined in `reference/styles/reference-theme.css` MUST be available

### Requirement: Typography and font stack
The client SHALL use the font stack defined in the reference theme: Inter (sans-serif), Noto Serif SC (serif), and JetBrains Mono (monospace). Font loading SHALL be configured in the global CSS entry.

#### Scenario: Font stack is applied globally
- **WHEN** any page in the client renders
- **THEN** body text MUST use the Inter / Noto Sans SC sans-serif stack
- **AND** monospace content (code blocks, terminal output) MUST use JetBrains Mono
