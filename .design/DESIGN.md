# Design System — ScholarAIO Hub

## 1. Visual Theme & Atmosphere

ScholarAIO Hub is a scholarly research tool whose visual identity fuses academic seriousness with the calm of a well-curated atelier. The working name for the aesthetic is "the digital atelier": the interface should feel like a refined workspace — purposeful, unhurried, and deeply focused.

The palette is built on **forest green** rather than the conventional blue, communicating trust and intellectual depth without the coldness of tech-blue. Primary surfaces carry a faint green tint (`#f5fbf6`) that reads as near-white while subtly reinforcing the brand's natural warmth. The darkest text is a warm near-black (`#171d1a`) with green undertones, softening the reading experience without sacrificing contrast.

Typography establishes a clear hierarchy through a deliberate **sans / serif / mono three-family system**: Inter and Noto Sans SC for UI text and body copy, Noto Serif SC for all headings (lending editorial authority), and JetBrains Mono exclusively for metadata labels, status badges, and code-like microcopy. This typographic discipline creates an immediate legibility signal — if it's in mono, it's data; if it's in serif, it's a heading; if it's in sans, it's prose.

Borders are deliberately whisper-weight: `border-outline-variant/10` to `/20` (roughly `rgba(111,122,114,0.1–0.2)`). Elevation is expressed almost entirely through background-color steps within the surface scale (lowest → low → container → high → highest) rather than shadows. Shadows appear only at semantic elevation peaks: floating menus, context menus and dialogs.

The app has **one light palette**. `styles.css` makes Tailwind's `dark:` variant class-based, so nothing follows the OS theme; do not add `dark:` styles.

**Key Characteristics:**
- Forest-green primary (`#005235`) as the singular brand accent — used for active states, CTAs, and interactive highlights
- Three-family type system: Inter/Noto Sans SC (UI), Noto Serif SC (headings), JetBrains Mono (metadata/badges)
- Surface scale built on green-tinted near-whites (`#f5fbf6` base) with 6 elevation steps
- Whisper borders: `border-outline-variant/10` throughout — never heavier than `/30`
- Signature gradient (`135deg, #005235 → #1a6b4a`) exclusively for primary CTA buttons
- Font-mono labels for all section headers, badge text, and metadata — 10px, uppercase, wide tracking
- `rounded-xl` (12px) as the standard card radius; `rounded-full` for pill tags and filter chips
- 8px spacing base with liberal use of p-6, p-8 for content breathing room

---

## 2. Color Palette & Roles

### Primary (Forest Green)
- **Primary** (`#005235`): Brand accent, active nav borders, primary CTA background, active state text, focus rings. The deepest green — used sparingly and with intent.
- **Primary Container** (`#1a6b4a`): Icon backgrounds on primary elements, gradient stop in `signature-gradient`.
- **On Primary** (`#ffffff`): Text/icons on primary-colored backgrounds.
- **On Primary Container** (`#9be9bf`): Text/icons inside primary containers.

### Secondary (Sage)
- **Secondary** (`#496455`): Secondary status indicators, PDF badge color.
- **Secondary Container** (`#c8e7d3`): PDF badge background tint, secondary chip fill.
- **On Secondary** (`#ffffff`): Text on secondary backgrounds.
- **On Secondary Container** (`#4d6959`): Text inside secondary containers.

### Tertiary (Deep Rose)
- **Tertiary** (`#753134`): Pending-state indicators, warning-adjacent accents.
- **Tertiary Container** (`#ffcccc`): Pending badge background tint.
- **On Tertiary** (`#ffffff`): Text on tertiary backgrounds.
- **On Tertiary Container** (`#3c060c`): Text inside tertiary containers.

### Surface Scale (Green-Tinted Whites)
| Token | Value | Role |
|-------|-------|------|
| `surface-container-lowest` | `#ffffff` | Modal backgrounds, highest-contrast card surfaces |
| `surface-container-low` | `#eff5f0` | Default card/panel background — the workhorse surface |
| `surface-container` | `#e9efea` | Hover state background, input fields |
| `surface-container-high` | `#e4eae5` | Active/selected items, sort/filter buttons |
| `surface-container-highest` | `#dee4df` | The most elevated contained surface |
| `surface` / `surface-bright` | `#f5fbf6` | Page background, top bar background |
| `surface-dim` | `#d5dbd7` | Dimmest tonal step (not a dark theme) |

### Text & Icon
- **On Surface** (`#171d1a`): Primary text — near-black with green undertone.
- **On Surface Variant** (`#3f4943`): Secondary text, descriptions, placeholder icons.
- **Outline** (`#6f7a72`): Standard borders (rarely used directly; prefer `outline-variant` with opacity).
- **Outline Variant** (`#bfc9c0`): Base for whisper borders: `border-outline-variant/10`, `/15`, `/20`.

### Semantic
- **Error** (`#ba1a1a`): Error text, missing-PDF badge color, delete actions.
- **Error Container** (`#ffdad6`): Error badge background tint.
- **On Error** (`#ffffff`): Text on error backgrounds.
- **On Error Container** (`#93000a`): Text inside error containers.

### Signature Utilities
- **Signature Gradient**: `linear-gradient(135deg, #005235 0%, #1a6b4a 100%)` — exclusive to primary CTA buttons (`signature-gradient` utility class).

---

## 3. Typography Rules

### Font Families
| Token | Family | Fallbacks | Role |
|-------|--------|-----------|------|
| `font-sans` | Inter, Noto Sans SC | ui-sans-serif, system-ui, sans-serif | Body copy, UI labels, nav links |
| `font-serif` | Noto Serif SC | ui-serif, Georgia, serif | All headings (h1–h6), view titles, card titles |
| `font-mono` | JetBrains Mono | ui-monospace, SFMono-Regular, monospace | Metadata labels, status badges, section headers, timestamps |

> **Rule**: All `<h1>`–`<h6>` elements default to `font-serif` via the base layer. Do not override headings to sans unless building a data-dense table/list context.

### Hierarchy

| Role | Family | Size | Weight | Usage |
|------|--------|------|--------|-------|
| Brand Logotype | Noto Serif SC | 1.1rem | Bold (700) | Sidebar brand header — "ScholarAIO" |
| View Title | Noto Serif SC | 1.25rem (20px) | Bold (700) | Top bar page title |
| Dialog Title | Noto Serif SC | lg (18px) | Bold (700) | Modal dialog titles |
| Card / Sub-section Title | Noto Serif SC | base (16px) | Semibold (600) | Paper titles, dialog sections |
| Body / UI | Inter | sm (14px) | Medium (500) | Nav labels, button text, list items |
| Caption | Inter / Noto Sans SC | xs (12px) | Normal (400) | Author lines, source info, metadata prose |
| Badge / Label | JetBrains Mono | 10px | Bold (700) | All status badges, section sub-headers |
| Section Label | JetBrains Mono | 9.5px | Normal (400) | Sidebar section labels and counts — `uppercase tracking-[0.2em]` |

### Principles
- **Serif for authority, sans for utility**: Headings command attention with Noto Serif SC's editorial weight. UI prose stays in Inter for crisp readability. Never mix family roles.
- **Mono as data signal**: JetBrains Mono is reserved exclusively for machine-like data: timestamps, status, counts, section category labels. Its presence instantly signals "this is metadata, not prose."
- **Mono label pattern**: Section headers above filter groups and all categorization labels follow: `font-mono text-[10px] uppercase tracking-widest text-on-surface-variant`. This is the most distinctive typographic pattern in the system.
- **Weight discipline**: 700/Bold for headings, 600/Semibold for emphasis and active nav, 500/Medium for interactive labels and buttons, 400/Normal for body reading text.
- **CJK support**: Inter + Noto Sans SC and Noto Serif SC are loaded together so Chinese characters render with the same visual weight hierarchy.

---

## 4. Component Stylings

### Sidebar
- **Width**: 248px expanded (user-resizable 220–420px) / 60px collapsed rail. The grid column animates (`grid-template-columns 220ms`), but not while the user drags the edge: a drag follows the pointer frame by frame with no easing, and only the final width is saved.
- **No reflow while animating**: the sidebar's content is laid out at its target width and clipped by the column, so expanding reveals it instead of reflowing it. Every row keeps its 16px icon in the rail's column (`px-[11px]`), and labels only fade (`opacity`), so nothing moves sideways between states.
- **Scrolling**: the history area scrolls without a visible scrollbar, like every scroll area (see Layout Principles).
- **Background**: `bg-surface-container-low`
- **Border**: `border-r border-outline-variant/15`
- **Padding**: `px-2.5 py-3`
- **Brand Header Button**: `rounded-xl px-[11px] py-2`, hover `bg-surface-container`; toggles the rail. Brand name in Noto Serif SC 1.1rem bold `text-primary`.
- **New Chat Button**: `rounded-xl bg-surface-container px-[11px] py-2`, hover `bg-surface-container-high`, 16px icon + 12.5px label.
- **Nav Items** (non-active): `rounded-lg px-[11px] py-2 text-[12.5px] font-medium`, 16px icons, `text-on-surface-variant`, hover `bg-surface-container text-on-surface`.
- **Nav Items** (active): `bg-surface-container-high text-primary`. The tonal step and the primary text are the whole indicator — no side border or stripe.
- **Session History**: below `border-t border-outline-variant/15`, grouped by workspace. Section labels use the 9.5px mono section label with a count chip; session items `rounded-lg text-[12px]`, active item `bg-surface-container-high text-primary`, a running session shows a `w-1.5 h-1.5 rounded-full bg-primary animate-pulse` dot.
- **Footer**: Settings nav item above `border-t border-outline-variant/15`; a `w-1.5` resize handle sits on the right edge (`hover:bg-primary/20`).
- **Session Context Menu**: `rounded-lg border border-outline-variant/40 bg-surface-container-lowest p-1 shadow-lg`, opened from a session row: Rename, Fork (disabled while the session runs), Delete (`text-error`).
- **Mobile**: below the desktop breakpoint the sidebar is an overlay drawer (`w-72 max-w-[85vw]`) over a `bg-on-surface/20` backdrop, opened from a fixed `hub-button` in the top-left corner.

### Top Bar
- **Height**: `h-[3.25rem]` (52px), `sticky top-0 z-30`
- **Background**: `bg-surface`, `border-b border-outline-variant/10`
- **Padding**: `px-6` (`pl-16` on mobile, clear of the menu button)
- **Title**: Noto Serif SC `text-[1.25rem]` bold `text-primary`
- Session, new-session, library, reader and skills routes are full-height views without it; an open session renders its own header.

### Session Transcript
The transcript's own layers, Streamdown mapping and turn layout are specified next to its renderer contract: [`.claude/topics/agent-rendering.md`](../.claude/topics/agent-rendering.md) ("Styling the transcript"). It uses this palette and adds no tokens.

### Cards
**Standard Content Card**
- Background: `bg-surface-container-low`
- Border: `border border-outline-variant/10`
- Radius: `rounded-xl` (12px)
- Padding: `p-5`
- Hover: `hover:shadow-md` or `hover:bg-surface-container-high`

**Paper List Row**
- `rounded-xl border flex items-stretch overflow-hidden`; a `w-36` cover column on `bg-surface-container` (a serif initial when there is no cover), then `px-4 py-3` content
- Title: `font-serif text-sm font-semibold text-on-surface line-clamp-2`
- Meta: `text-xs text-on-surface-variant`
- Selection checkbox top-left and status badge top-right, both `absolute`

### Buttons
**Primary CTA (Signature Gradient)**
- Background: `signature-gradient` (`linear-gradient(135deg, #005235 0%, #1a6b4a 100%)`)
- Text: `text-on-primary` (white), `font-semibold text-sm`
- Radius: `rounded-xl` or `rounded-full`
- Active: `active:scale-95`
- Shadow: `shadow-lg`
- Use: primary dialog confirm actions

**Secondary / Pill Filter Button**
- Background: `bg-surface-container-high`
- Text: `text-on-surface font-medium text-sm` or `text-primary` for active context
- Radius: `rounded-full`
- Active: `active:scale-95`
- Use: "Filters", "Sort: …" toolbar controls, view mode toggles

**Ghost / Icon Button**
- Background: transparent, `hover:bg-surface-container` or `hover:bg-surface-container-high`
- Text/Icon: `text-on-surface-variant`
- Radius: `rounded-full` (icon-only) or `rounded-lg` (small icon+label)
- Use: toolbar actions, paper row hover controls, sidebar collapse

**Danger / Destructive Button**
- Text: `text-error`
- Background: transparent, hover `bg-surface-container`
- Use: destructive menu items (delete session, remove paper)

### Status Badges
All badges follow the **mono-label pattern** base:
`text-[10px] font-mono font-bold px-2 py-0.5 rounded leading-none uppercase`

| Meaning | Text Color | Background | Example |
|---------|-----------|------------|---------|
| Positive / done | `text-primary` | `bg-primary/15` | "✓ 已加入" on a paper row |
| Neutral / in progress | `text-on-surface-variant` | `bg-surface-container` | counts, pending states |
| Failure | `text-error` | `bg-error-container/40` | parse or import failures |
| Kind | `text-secondary` | `bg-secondary-container/30` | PDF / Markdown source |

### Inputs & Forms
- Background: `bg-surface-container` or transparent
- Border: `border border-outline-variant/20`
- Radius: `rounded-xl`
- Focus: `focus:ring-2 focus:ring-primary/20` (or `focus-within:` on a wrapper)
- Text: `text-on-surface` / `text-[13px]`
- Placeholder / label: `text-on-surface-variant`
- Range sliders: `accent-primary`, `h-1.5 bg-outline-variant rounded-lg`
- Checkboxes: `rounded border-outline text-primary focus:ring-primary h-5 w-5`

### Dropdowns & Menus
- Container: `rounded-xl border border-outline-variant/20 bg-surface-container-high shadow-xl p-2`
- Items: `rounded-lg text-sm px-3 py-2 hover:bg-surface-container-low text-on-surface`
- Active item: `bg-primary/10 text-primary font-semibold`
- No entrance animation

### Source / Filter Chips (Toggle Pills)
- **Inactive**: `bg-surface-container-high text-on-surface-variant border-outline-variant/30 border`
- **Active**: `bg-primary text-on-primary border-primary`
- Radius: `rounded-full`
- Size: `px-3 py-1.5 text-xs font-medium`

---

## 5. Layout Principles

### App Shell Structure
```
┌──────────────────────────┬──────────────────────────┐
│ Sidebar (248px / 60px)   │ Top bar (sticky, 52px)   │
│  - Brand (toggles rail)  ├──────────────────────────┤
│  - New chat              │                          │
│  - Nav: Library, Skills  │ View content             │
│  - Sessions by workspace │ (scrolls per view)       │
│  - Settings              │                          │
└──────────────────────────┴──────────────────────────┘
```
- Desktop (> 1100px): one CSS grid, `grid-template-columns: <sidebar>px minmax(0, 1fr)`. The sidebar is `sticky top-0 h-dvh`; the grid track replaces any margin or `left` bookkeeping.
- Below 1100px: single column; the sidebar becomes the overlay drawer described in Sidebar.
- Full-height views (sessions, library, reader, skills) take `h-dvh overflow-hidden` and scroll inside; other pages get `px-6 py-8` and scroll with the document.
- Scrollbars: none anywhere. `styles.css` hides them globally in the base layer; scroll areas need no per-element class

### Spacing System
- Base unit: 8px (0.5rem in Tailwind)
- Standard content padding: `p-8` (32px) for view-level padding
- Card inner padding: `p-5` (20px) content cards
- Section gaps: `gap-6` (24px) between cards in grids
- Component internal gaps: `gap-2` (8px), `gap-3` (12px), `gap-4` (16px)
- Section stacking: `space-y-8` (32px) between sections, `space-y-3` between items
- History section item spacing: `space-y-1` (4px) between chat items, `space-y-3` (12px) between date groups

### Motion
- No route transitions and no entrance animations; there is no animation library.
- Motion is CSS only: color/opacity transitions (buttons get `140ms` from the base layer), the sidebar's grid-track transition, and loading indicators (`animate-pulse`, `animate-spin`, `skeleton-shimmer`, `animate-search-progress`).
- `prefers-reduced-motion: reduce` collapses every animation and transition (`styles.css` base layer); imperative charts check it too.

### Whitespace Philosophy
- **Content-first density**: Data-dense views (Library, Search) use compact rows but generous section padding. Chat view gives messages breathing room with asymmetric padding.
- **Section rhythm through subtle tonal shifts**: No hard dividers between sections; separation comes from `border-t border-outline-variant/10` (a ~10% opacity whisper) and background-color shifts within the surface scale.

### Border Radius Scale
| Name | Value | Usage |
|------|-------|-------|
| Pill (full) | `9999px` / `rounded-full` | Filter chips, icon buttons |
| Large | `rounded-2xl` (24px) | Menu item icon containers |
| Standard | `rounded-xl` (12px) | Cards, dropdowns, input fields, action buttons, sidebar brand and new chat |
| Small | `rounded-lg` (8px) | Dropdown menu items, context menu, icon-only hover backgrounds |
| Micro | `rounded` (4px) | Mono badges (status, PDF, Indexed), inline chips |
| Circle | `rounded-full` | Status dots |

---

## 6. Depth & Elevation

| Level | Treatment | Token / Class | Use |
|-------|-----------|---------------|-----|
| Flat (0) | Surface background color only | `bg-surface` | Page backgrounds, text blocks |
| Card (1) | Surface container + whisper border | `bg-surface-container-low border-outline-variant/10` | Standard content cards, paper rows |
| Raised Card (2) | Card + `shadow-md` on hover | `hover:shadow-md` | Interactive cards on hover state |
| Floating Menu (3) | Container-high + `shadow-xl` | `bg-surface-container-high shadow-xl` | Dropdowns, sort menus |
| Context Menu (4) | Container-lowest + `shadow-lg` | `bg-surface-container-lowest shadow-lg` | Session context menu |
| Dialog (5) | Native `<dialog class="hub-dialog">` over a blurred `rgb(23 29 26 / 0.2)` backdrop | `bg-surface-container-lowest shadow-2xl` | Import, workspace and confirm dialogs |

**Shadow Philosophy**: The system prefers **surface tonal elevation** (M3 pattern) over shadows. Shadows are reserved for floating/overlay elements that sit above the page surface. Custom shadows use the on-surface near-black (`rgba(23,29,26,…)`) to keep depth in the brand's color family. No glows.

---

## 7. Responsive Behavior

### Breakpoints
| Name | Width | Key Changes |
|------|-------|-------------|
| Compact | ≤ 1100px | Sidebar becomes an overlay drawer; top bar leaves room for the menu button |
| Desktop | > 1100px | Sidebar is a grid column, collapsible to the 60px rail and resizable |
| Tailwind `md` / `xl` | 768px / 1280px | Used inside views for column counts only |

The 1100px shell breakpoint lives in `NavigationLayout.tsx` (`DESKTOP_BREAKPOINT`).

### Sidebar Collapse Behavior
- Collapsed (60px): icon-only nav, brand label faded out, history hidden
- Expanded (248px default, resizable 220–420px, width remembered): full labels, New Chat button, sessions by workspace
- Transition: the shell grid's `grid-template-columns 220ms ease-in-out`; disabled while the user drags the resize edge

### Touch & Interaction Targets
- Nav link items: `py-2` rows with 16px icons
- Action buttons: `p-2` icon buttons (min 36px), `px-4 py-2` for labeled buttons

---

## 8. Accessibility & States

### Focus System
- Default: the base layer gives every `button`, `a`, `input`, `textarea`, `select` and `summary` a `:focus-visible` outline — `2px solid` primary, `outline-offset: 3px`. Components need no focus classes of their own.
- Fields that draw their own frame replace it with `focus:ring-2 focus:ring-primary/20` (or `focus-within:` on the wrapper); rows with `overflow-hidden` use `focus-visible:ring-2 focus-visible:ring-primary/40`.
- Destructive actions (Delete): color differentiated with `text-error` to signal intent before action

### Interactive States
| State | Treatment |
|-------|-----------|
| Default | Base surface + outline-variant whisper border |
| Hover | `bg-surface-container` or `bg-surface-container-high` background shift; icon color `text-primary` |
| Active/Pressed | `active:scale-95` transform + `active:opacity-80` for icon buttons |
| Focus | Base-layer `:focus-visible` outline (see Focus System) |
| Active Nav | `bg-surface-container-high text-primary` (no side border) |
| Selected Item | `bg-primary/10 text-primary font-semibold` (dropdowns) or `bg-primary text-on-primary` (chips) |
| Disabled | `opacity: 0.5`, `cursor: not-allowed` (buttons, from the base layer) |
| Error | `text-error` text, `bg-error-container/40` background |
| Streaming / Loading | Progressive content with `streaming: true` flag — no special visual treatment beyond content rendering |

### Color Contrast
- Primary text (`#171d1a`) on surface (`#f5fbf6`): > 16:1 (WCAG AAA)
- On-surface-variant (`#3f4943`) on surface: ~7:1 (WCAG AA)
- Primary (`#005235`) on surface: ~8:1 (WCAG AA, large text requirement met for all uses)
- Error (`#ba1a1a`) on white: ~5.9:1 (WCAG AA)
- On Primary (`#ffffff`) on primary (`#005235`): ~8:1 (WCAG AA)

---

## 9. Agent Prompt Guide

### Quick Color Reference
- Brand accent / Active: `#005235` (Primary)
- CTA gradient: `linear-gradient(135deg, #005235 0%, #1a6b4a 100%)`
- Page background: `#f5fbf6` (surface)
- Card background: `#eff5f0` (surface-container-low)
- Hover surface: `#e9efea` (surface-container)
- Active surface: `#e4eae5` (surface-container-high)
- Elevated surface: `#dee4df` (surface-container-highest)
- Primary text: `#171d1a` (on-surface)
- Secondary text: `#3f4943` (on-surface-variant)
- Whisper border: `rgba(191,201,192,0.1)` → use Tailwind `border-outline-variant/10`
- Error: `#ba1a1a`

### Mono Label Pattern (Copy-Paste)
```
text-[10px] font-mono font-bold text-on-surface-variant uppercase tracking-widest
```
Use for: filter section headers, any metadata category label.

### Signature Gradient Button (Copy-Paste)
```
signature-gradient text-on-primary font-semibold text-sm rounded-xl px-4 py-2 active:scale-95 shadow-lg
```
Use for: primary modal confirm, top-level CTAs only.

### Example Component Prompts

**"Create a paper list row"**
> `rounded-xl border flex items-stretch overflow-hidden`. Left: `w-36` cover on `bg-surface-container` (serif initial when missing). Content `px-4 py-3`: title `font-serif text-sm font-semibold text-on-surface line-clamp-2`, authors `text-xs text-on-surface-variant truncate`. Badges: `text-[10px] font-mono font-bold px-2 py-0.5 rounded uppercase leading-none`.

**"Create a sidebar nav item (active)"**
> `flex items-center gap-2.5 px-[11px] py-2 rounded-lg bg-surface-container-high text-primary`. Icon: 16px, `shrink-0`. Label: `font-sans text-[12.5px] font-medium truncate whitespace-nowrap`.

**"Create a filter chip (active)"**
> `px-3 py-1.5 text-xs font-medium rounded-full border bg-primary text-on-primary border-primary`.

**"Create a filter chip (inactive)"**
> `px-3 py-1.5 text-xs font-medium rounded-full border bg-surface-container-high text-on-surface-variant border-outline-variant/30`.

### Iteration Rules
1. **Surface tonal elevation first** — before adding a shadow, step up the surface token (`container-low` → `container-high` → `container-highest`). Shadows only for overlay/floating elements.
2. **Green undertones always** — never use neutral grays. All surface tokens carry the `#f5fbf6` green tint lineage.
3. **Mono for data, serif for headings, sans for everything else** — never use sans for headings or mono for prose.
4. **Whisper borders only** — `border-outline-variant/10` to `/20`. Never solid or full-opacity borders.
5. **Primary color is earned** — use `text-primary` / `bg-primary` only for active states, interactive CTAs, and focus indicators. Do not scatter it.
6. **Signature gradient is exclusive** — only on primary CTA buttons. No backgrounds, no cards.
7. **Badge radius = `rounded` (4px)**, not pill — badges in this system use `rounded` micro-radius for a data-terminal aesthetic. Only stat-card indicator pills use `rounded-full`.
8. **Active nav indicator** = tonal step + primary text — `bg-surface-container-high text-primary`. No side borders or stripes on active items.
9. **No glows** — no `box-shadow` glow effects anywhere.
10. **No entrance animation** — content appears without motion; transitions only change color, opacity or the sidebar track, and `prefers-reduced-motion` turns them off.
11. **One light palette** — no `dark:` styles and no OS-theme switching.
