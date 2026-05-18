# Design System — ScholarAIO Hub

## 1. Visual Theme & Atmosphere

ScholarAIO Hub is a scholarly research tool whose visual identity fuses academic seriousness with the calm of a well-curated atelier. The tagline "The Digital Atelier" defines the aesthetic: the interface should feel like a refined workspace — purposeful, unhurried, and deeply focused.

The palette is built on **forest green** rather than the conventional blue, communicating trust and intellectual depth without the coldness of tech-blue. Primary surfaces carry a faint green tint (`#f5fbf6`) that reads as near-white while subtly reinforcing the brand's natural warmth. The darkest text is a warm near-black (`#171d1a`) with green undertones, softening the reading experience without sacrificing contrast.

Typography establishes a clear hierarchy through a deliberate **sans / serif / mono three-family system**: Inter and Noto Sans SC for UI text and body copy, Noto Serif SC for all headings (lending editorial authority), and JetBrains Mono exclusively for metadata labels, status badges, and code-like microcopy. This typographic discipline creates an immediate legibility signal — if it's in mono, it's data; if it's in serif, it's a heading; if it's in sans, it's prose.

Borders are deliberately whisper-weight: `border-outline-variant/10` to `/20` (roughly `rgba(111,122,114,0.1–0.2)`). Elevation is expressed almost entirely through background-color steps within the surface scale (lowest → low → container → high → highest) rather than shadows. Shadows appear only at semantic elevation peaks: hover cards, floating menus, modal bottom sheets.

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
- **Primary Container** (`#1a6b4a`): Avatar/icon backgrounds on primary elements, gradient stop in `signature-gradient`.
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
| `surface-container-highest` | `#dee4df` | Bottom sheets, the most elevated contained surface |
| `surface` / `surface-bright` | `#f5fbf6` | Page background, TopNav background |
| `surface-dim` | `#d5dbd7` | Dark mode surface (referenced in `dark:` variants) |

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
- **Glass Overlay**: `bg-surface-container-low/85 backdrop-blur-lg` — glassmorphism panels (`glass-overlay` utility class).

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
| Brand Logotype | Noto Serif SC | 1.7rem (27px) | Bold (700) | Sidebar brand header — "ScholarAIO" |
| View Title | Noto Serif SC | 1.65rem (26px) | Bold (700) | TopNav page title |
| Section Heading | Noto Serif SC | 1.5rem (24px) | Bold (700) | Bottom sheet headings, drawer headings |
| Card / Sub-section Title | Noto Serif SC | base (16px) | Semibold (600) | Paper card titles, year group labels |
| Body / UI | Inter | sm (14px) | Medium (500) | Nav labels, button text, list items |
| Caption | Inter / Noto Sans SC | xs (12px) | Normal (400) | Author lines, source info, metadata prose |
| Badge / Label | JetBrains Mono | 10px | Bold (700) | ALL status badges, section sub-headers, stat card labels |
| Micro Label | JetBrains Mono | 10px | Normal (400) | User role line ("Senior Curator"), TopNav metadata rows |
| Logotype Sub-caption | JetBrains Mono | 9px | Normal (400) | "The Digital Atelier" tagline — `tracking-[0.28em]`, `uppercase`, `opacity-60` |

### Principles
- **Serif for authority, sans for utility**: Headings command attention with Noto Serif SC's editorial weight. UI prose stays in Inter for crisp readability. Never mix family roles.
- **Mono as data signal**: JetBrains Mono is reserved exclusively for machine-like data: timestamps, status, counts, section category labels. Its presence instantly signals "this is metadata, not prose."
- **Mono label pattern**: Section headers above filter groups, stat card subtitles, and all categorization labels follow: `font-mono text-[10px] uppercase tracking-widest text-on-surface-variant`. This is the most distinctive typographic pattern in the system.
- **Weight discipline**: 700/Bold for headings, 600/Semibold for emphasis and active nav, 500/Medium for interactive labels and buttons, 400/Normal for body reading text.
- **CJK support**: Inter + Noto Sans SC and Noto Serif SC are loaded together so Chinese characters render with the same visual weight hierarchy.

---

## 4. Component Stylings

### Sidebar
- **Width**: 248px expanded / 84px collapsed (`w-[15.5rem]` / `w-[5.25rem]`), animates via `transition-[width] duration-300 ease-out`
- **Background**: `bg-surface-container-low` (dark: `bg-surface-dim`)
- **Border**: `border-r border-outline-variant/15`
- **Padding**: `px-3 py-3`
- **Brand Header Button**: `rounded-[20px]`, hover `bg-surface-container`, focus ring `ring-2 ring-primary/20`. Brand name in Noto Serif SC 1.7rem bold primary; tagline in JetBrains Mono 9px uppercase tracking-[0.28em] opacity-60.
- **New Chat Button**: `rounded-[18px]`, `bg-surface-container`, hover `bg-surface-container-high`, icon + label.
- **Nav Items** (non-active): `rounded-xl`, `text-on-surface-variant`, hover `bg-surface-container`. Icon hover color shifts to `text-primary`.
- **Nav Items** (active): `bg-surface-container-high text-primary border-l-4 border-primary`. The left 4px border in primary is the active indicator.
- **History Section**: `border-t border-outline-variant/10`, section label in mono-label pattern. Chat items `rounded-xl`, active item `bg-surface-container text-primary`.
- **Session Context Menu**: `rounded-xl border border-outline-variant/20 bg-surface-container-lowest shadow-xl` — appears on hover, 2 actions: Rename (neutral) + Delete (text-error).
- **User Profile Button**: `rounded-[20px] bg-surface-container`, avatar is `rounded-full bg-primary-container`. Contains user name (bold 12px sans) + role (10px mono `text-on-surface-variant`).
- **User Menu Popup**: `rounded-[28px] border border-outline-variant/20 bg-surface-container-lowest shadow-[0_24px_50px_rgba(23,29,26,0.16)] backdrop-blur-xl`. Menu items have icon in `rounded-2xl bg-surface-container` container + two-line label (sm medium + xs variant).

### TopNav
- **Height**: `h-[3.25rem]` (52px)
- **Position**: `fixed top-0 right-0`, left edge tracks sidebar width via `style={{ left: sidebarWidth }}` — animates with `transition-[left] duration-300`
- **Background**: `bg-surface` (dark: `bg-surface-dim`), `border-b border-outline-variant/10`
- **Padding**: `px-6`
- **Title**: Noto Serif SC `text-[1.65rem]` bold `text-primary`
- **Right Actions**: Icon-only button `p-2 rounded-full hover:bg-surface-container text-on-surface-variant active:opacity-80`
- **Quick Settings Drawer**: `w-80`, `border-l border-outline-variant/20 bg-surface-container-low`, `shadow-2xl`. Stat rows use `rounded-xl bg-surface-container-high p-3` with mono 10px label above a semibold sm value. Primary CTA button at bottom uses `signature-gradient rounded-xl`.

### Cards
**Standard Content Card**
- Background: `bg-surface-container-low`
- Border: `border border-outline-variant/10`
- Radius: `rounded-xl` (12px)
- Padding: `p-6` (stat cards), `p-5` (paper grid cards)
- Hover: `hover:shadow-md` or `hover:bg-surface-container-high`

**Stat Cards (Library Overview)**
- Icon top-left in brand color, badge top-right in `rounded-full` with color-matched `bg-*/10` tint
- Metric value: `font-mono text-3xl font-bold` in brand color
- Label: `text-xs font-medium uppercase tracking-wider text-on-surface-variant`
- Entrance animation: `motion.div` with `opacity: 0, y: 20` → `opacity: 1, y: 0`, staggered `delay: i * 0.1`

**Paper List Row** (72px fixed height)
- `h-[72px] flex items-center px-6 rounded-xl`
- Status dot: `w-2 h-2 rounded-full` color-matched to status; ingested dot has `shadow-[0_0_8px_rgba(26,107,74,0.4)]` glow
- Title: `font-serif text-base font-semibold text-on-surface`
- Meta: `text-xs font-sans text-on-surface-variant`
- Hover actions (ExternalLink, MoreVertical): `opacity-0 group-hover:opacity-100 transition-opacity`

**Paper Grid Card**
- `border border-outline-variant/10 rounded-xl p-5 hover:shadow-md`
- Title: `font-serif text-base font-semibold line-clamp-2`

### Buttons
**Primary CTA (Signature Gradient)**
- Background: `signature-gradient` (`linear-gradient(135deg, #005235 0%, #1a6b4a 100%)`)
- Text: `text-on-primary` (white), `font-semibold text-sm`
- Radius: `rounded-xl` or `rounded-full`
- Active: `active:scale-95`
- Shadow: `shadow-lg`
- Use: "Apply Filters", "Go to Settings", primary modal confirm actions

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
- Use: TopNav actions, paper row hover controls, sidebar collapse

**Danger / Destructive Button**
- Text: `text-error`
- Background: transparent, hover `bg-surface-container`
- Use: Delete session in context menu only

### Status Badges
All badges follow the **mono-label pattern** base:
`text-[10px] font-mono font-bold px-2 py-0.5 rounded leading-none uppercase`

| Status | Text Color | Background |
|--------|-----------|------------|
| Ingested | `text-primary` | `bg-primary-container/10` |
| Indexing | `text-on-surface-variant` | `bg-surface-variant` |
| Pending | `text-on-surface-variant/40` | `bg-surface-variant/50` |
| No PDF | `text-error` | `bg-error-container/40` |
| PDF | `text-secondary` | `bg-secondary-container/30` |
| Indexed | `text-primary` | `bg-primary-container/10` |

Stat card badge pills (LIVE, ALERT, SYNC, WARN): same mono base but `rounded-full` radius.

### Inputs & Forms
- Background: `bg-surface-container` or transparent
- Border: `border border-outline-variant/20`
- Radius: `rounded-xl`
- Focus: `focus:outline-none focus:ring-2 focus:ring-primary/20`
- Text: `text-on-surface` / `text-[13px]`
- Placeholder / label: `text-on-surface-variant`
- Range sliders: `accent-primary`, `h-1.5 bg-outline-variant rounded-lg`
- Checkboxes: `rounded border-outline text-primary focus:ring-primary h-5 w-5`

### Dropdowns & Menus
- Container: `rounded-xl border border-outline-variant/20 bg-surface-container-high shadow-xl p-2`
- Items: `rounded-lg text-sm px-3 py-2 hover:bg-surface-container-low text-on-surface`
- Active item: `bg-primary/10 text-primary font-semibold`
- Entrance: `motion` `opacity: 0, y: 6` → `opacity: 1, y: 0`

### Bottom Sheet (Filter Panel)
- Overlay: `bg-on-surface/20 backdrop-blur-sm`
- Sheet: `rounded-t-[2rem] bg-surface-container-highest shadow-2xl border-t border-outline-variant/20`
- Handle: `w-12 h-1.5 bg-outline-variant rounded-full group-hover:bg-primary transition-colors`
- Entrance: spring `type: "spring", damping: 25, stiffness: 200`, slides from `y: "100%"`
- Internal padding: `px-10 pb-12`
- Section labels inside sheet: mono-label pattern

### Source / Filter Chips (Toggle Pills)
- **Inactive**: `bg-surface-container-high text-on-surface-variant border-outline-variant/30 border`
- **Active**: `bg-primary text-on-primary border-primary`
- Radius: `rounded-full`
- Size: `px-3 py-1.5 text-xs font-medium`

---

## 5. Layout Principles

### App Shell Structure
```
┌─────────────────────────────────────────────────────┐
│  Sidebar (fixed, 248/84px)  │  TopNav (fixed, 52px) │
│                             ├───────────────────────┤
│  - Brand Logo               │                       │
│  - New Chat Button          │  View Content         │
│  - Nav Items                │  (scrollable)         │
│  - Chat History             │                       │
│  - User Profile             │                       │
└─────────────────────────────────────────────────────┘
```
- Sidebar: `position: fixed`, `z-40`, full viewport height
- TopNav: `position: fixed`, `z-50`, `left` tracks sidebar width via inline style + transition
- Main content: `marginLeft` matches sidebar width with `transition-[margin] duration-300 ease-out`
- Content area: `mt-[3.25rem]` to clear TopNav, `overflow-hidden` on outer, scroll per-view

### Spacing System
- Base unit: 8px (0.5rem in Tailwind)
- Standard content padding: `p-8` (32px) for view-level padding
- Card inner padding: `p-6` (24px) stats, `p-5` (20px) content cards
- Section gaps: `gap-6` (24px) between cards in grids
- Component internal gaps: `gap-2` (8px), `gap-3` (12px), `gap-4` (16px)
- Section stacking: `space-y-8` (32px) between year groups in lists, `space-y-3` between items
- History section item spacing: `space-y-1` (4px) between chat items, `space-y-3` (12px) between date groups

### Grid System
- Stat cards: `grid-cols-1 md:grid-cols-4 gap-6`
- Paper grid: `grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4`
- Filter panel: `grid-cols-1 md:grid-cols-3 gap-10`
- Max content area width: unconstrained (fills available space minus sidebar)

### Page Transitions
All view-level route changes use `AnimatePresence mode="wait"` with:
```
initial: { opacity: 0, x: 10 }
animate: { opacity: 1, x: 0 }
exit: { opacity: 0, x: -10 }
transition: { duration: 0.3, ease: [0.22, 1, 0.36, 1] }
```

### Whitespace Philosophy
- **Content-first density**: Data-dense views (Library, Search) use compact rows but generous section padding. Chat view gives messages breathing room with asymmetric padding.
- **Section rhythm through subtle tonal shifts**: No hard dividers between sections; separation comes from `border-t border-outline-variant/10` (a ~10% opacity whisper) and background-color shifts within the surface scale.
- **Year-grouped chronology**: Library and History use date groups as visual anchors. The pattern is: `font-serif text-xl bold` year label + `font-mono text-xs text-on-surface-variant bg-surface-container px-2 rounded` count badge + `flex-1 h-px bg-outline-variant/10` hairline rule.

### Border Radius Scale
| Name | Value | Usage |
|------|-------|-------|
| Pill (full) | `9999px` / `rounded-full` | Stat badge pills, filter chips, icon buttons |
| Fluid Large | `rounded-[28px]` | User menu popup |
| Fluid | `rounded-[20px]` | Sidebar brand button, profile trigger |
| Fluid Medium | `rounded-[18px]` | New Chat button |
| Bottom Sheet | `rounded-t-[2rem]` | Filter bottom sheet |
| Large | `rounded-2xl` (24px) | Menu item icon containers |
| Standard | `rounded-xl` (12px) | Cards, dropdowns, input fields, action buttons |
| Small | `rounded-lg` (8px) | Dropdown menu items, icon-only hover backgrounds |
| Micro | `rounded` (4px) | Mono badges (status, PDF, Indexed), inline chips |
| Circle | `rounded-full` | User avatar, status dots |

---

## 6. Depth & Elevation

| Level | Treatment | Token / Class | Use |
|-------|-----------|---------------|-----|
| Flat (0) | Surface background color only | `bg-surface` | Page backgrounds, text blocks |
| Card (1) | Surface container + whisper border | `bg-surface-container-low border-outline-variant/10` | Standard content cards, paper rows |
| Raised Card (2) | Card + `shadow-md` on hover | `hover:shadow-md` | Interactive cards on hover state |
| Floating Menu (3) | Container-high + `shadow-xl` | `bg-surface-container-high shadow-xl` | Dropdowns, sort menus |
| Modal / Drawer (4) | Container-lowest + `shadow-2xl` | `bg-surface-container-lowest shadow-2xl` | Session context menu, Quick Settings drawer |
| Deep Sheet (5) | Container-highest + `shadow-2xl` + border | `bg-surface-container-highest shadow-2xl border-t border-outline-variant/20` | Filter bottom sheet |
| User Menu (6) | Container-lowest + custom shadow + backdrop blur | `shadow-[0_24px_50px_rgba(23,29,26,0.16)] backdrop-blur-xl` | User profile popup — peak elevation |

**Shadow Philosophy**: The system prefers **surface tonal elevation** (M3 pattern) over shadows. Shadows are reserved for floating/overlay elements that sit above the page surface. The deepest custom shadow `rgba(23,29,26,0.16)` uses the on-surface near-black with green undertone to keep depth in the brand's color family.

**Status Glow**: Ingested papers use a single exception to the no-glow rule: `shadow-[0_0_8px_rgba(26,107,74,0.4)]` on the status dot — a subtle primary-colored bloom that signals "healthy/active" state without disrupting the flat surface language.

---

## 7. Responsive Behavior

### Breakpoints (Tailwind defaults)
| Name | Min Width | Key Changes |
|------|-----------|-------------|
| Mobile | < 768px | Sidebar should collapse by default; single-column grids |
| Tablet (`md`) | 768px | 4-column stat grid, 2-column paper grid, 3-column filter panel begin |
| Desktop (`xl`) | 1280px | 3-column paper grid |
| Large Desktop | > 1440px | Content fills available space; sidebar stays fixed |

### Sidebar Collapse Behavior
- Collapsed (84px): icon-only nav, brand hidden, history hidden, profile shows avatar only
- Expanded (248px): full labels, New Chat button, history section, full profile row
- Transition: `transition-[width] duration-300 ease-out` on sidebar; `transition-[margin] duration-300 ease-out` on main content; `transition-[left] duration-300 ease-out` on TopNav

### Touch & Interaction Targets
- Nav link items: `py-2.5` vertical padding (min ~44px touch height)
- Action buttons: `p-2` icon buttons (min 36px), `px-4 py-2` for labeled buttons
- Bottom sheet: drag handle `h-16` drag zone for touch activation

---

## 8. Accessibility & States

### Focus System
- All interactive elements: `focus:outline-none focus:ring-2 focus:ring-primary/20`
- The `primary/20` ring (20% opacity forest green) is the universal focus indicator
- Destructive actions (Delete): color differentiated with `text-error` to signal intent before action

### Interactive States
| State | Treatment |
|-------|-----------|
| Default | Base surface + outline-variant whisper border |
| Hover | `bg-surface-container` or `bg-surface-container-high` background shift; icon color `text-primary` |
| Active/Pressed | `active:scale-95` transform + `active:opacity-80` for icon buttons |
| Focus | `ring-2 ring-primary/20` |
| Active Nav | `bg-surface-container-high text-primary border-l-4 border-primary` |
| Selected Item | `bg-primary/10 text-primary font-semibold` (dropdowns) or `bg-primary text-on-primary` (chips) |
| Disabled | `text-on-surface-variant/40 bg-surface-variant/50` (see Pending badge as semantic example) |
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
Use for: filter section headers ("Document Status", "Source Type"), stat card sub-labels, any metadata category label.

### Signature Gradient Button (Copy-Paste)
```
signature-gradient text-on-primary font-semibold text-sm rounded-xl px-4 py-2 active:scale-95 shadow-lg
```
Use for: primary modal confirm, top-level CTAs only.

### Example Component Prompts

**"Create a stat card"**
> White-ish card (`bg-surface-container-low`) with `border border-outline-variant/10 rounded-xl p-6`. Top row: icon in brand color + `rounded-full` mono badge (`text-[10px] font-mono font-bold px-2 py-0.5`, color-matched `bg-*/10` background). Metric: `font-mono text-3xl font-bold` in brand color. Label: `text-xs font-medium uppercase tracking-wider text-on-surface-variant`. Entrance animation: `opacity: 0, y: 20` → `opacity: 1, y: 0` staggered.

**"Create a paper list row"**
> Fixed `h-[72px]`, `flex items-center px-6 rounded-xl bg-surface-container-low hover:bg-surface-container-high`. Left: 8px status dot (`rounded-full`, color by status; ingested gets glow `shadow-[0_0_8px_rgba(26,107,74,0.4)]`). Title: `font-serif text-base font-semibold text-on-surface truncate`. Meta: `text-xs font-sans text-on-surface-variant`. Badges: `text-[10px] font-mono font-bold px-2 py-0.5 rounded uppercase leading-none`. Hover actions: ExternalLink + MoreVertical, `opacity-0 group-hover:opacity-100`.

**"Create a sidebar nav item (active)"**
> `flex items-center gap-3 px-3 py-2.5 rounded-xl bg-surface-container-high text-primary border-l-4 border-primary`. Icon: `w-5 h-5 text-primary`. Label: `font-sans text-[13px] font-medium`.

**"Create a filter chip (active)"**
> `px-3 py-1.5 text-xs font-medium rounded-full border bg-primary text-on-primary border-primary`.

**"Create a filter chip (inactive)"**
> `px-3 py-1.5 text-xs font-medium rounded-full border bg-surface-container-high text-on-surface-variant border-outline-variant/30`.

**"Create a bottom sheet"**
> Full-screen overlay `bg-on-surface/20 backdrop-blur-sm`. Sheet: `w-full max-w-4xl bg-surface-container-highest rounded-t-[2rem] shadow-2xl border-t border-outline-variant/20`. Handle: centered `w-12 h-1.5 bg-outline-variant rounded-full hover:bg-primary transition-colors`. Spring entrance: `y: "100%"` → `y: 0`, `type: "spring", damping: 25, stiffness: 200`. Internal: `px-10 pb-12`, serif heading + mono "CLEAR ALL" action. Confirm CTA: `signature-gradient rounded-full px-10 py-3 font-bold text-sm`.

**"Create a year group section header"**
> `flex items-center gap-4 mb-4`. Year: `font-serif text-xl font-bold text-on-surface`. Count badge: `text-xs font-mono text-on-surface-variant bg-surface-container px-2 py-0.5 rounded`. Hairline: `flex-1 h-px bg-outline-variant/10`.

### Iteration Rules
1. **Surface tonal elevation first** — before adding a shadow, step up the surface token (`container-low` → `container-high` → `container-highest`). Shadows only for overlay/floating elements.
2. **Green undertones always** — never use neutral grays. All surface tokens carry the `#f5fbf6` green tint lineage.
3. **Mono for data, serif for headings, sans for everything else** — never use sans for headings or mono for prose.
4. **Whisper borders only** — `border-outline-variant/10` to `/20`. Never solid or full-opacity borders.
5. **Primary color is earned** — use `text-primary` / `bg-primary` only for active states, interactive CTAs, and focus indicators. Do not scatter it.
6. **Signature gradient is exclusive** — only on primary CTA buttons. No backgrounds, no cards.
7. **Badge radius = `rounded` (4px)**, not pill — badges in this system use `rounded` micro-radius for a data-terminal aesthetic. Only stat-card indicator pills use `rounded-full`.
8. **Active nav indicator** = left border — `border-l-4 border-primary` is the nav active pattern, not background change alone.
9. **Glow is singular** — only the ingested status dot gets a glow. No other element uses `box-shadow` glow effects.
10. **Stagger card entrances** — any grid of cards uses `motion.div` with `delay: i * 0.1` stagger. Single cards or rows do not need entrance animation.
