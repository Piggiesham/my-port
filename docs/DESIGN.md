---
version: alpha
name: My-Port-design-system
description: A dense, calm dark-mode fintech dashboard for a single-user portfolio tracker. Near-black canvas (#0a0a0b) with layered panel greys carrying every surface; one cool accent (#7dd3fc "sky") for focus rings, links, and the benchmark line, and a strict green-up / red-down (#4ade80 / #f87171) semantic that governs every gain, loss, and directional cue. Type is Inter for UI and JetBrains Mono (tabular-nums, via the .num class) for every number — the monospace figures are the system's signature, keeping columns of prices and percentages optically aligned. Shape language is soft-but-tight: 16px cards, 8–12px controls, and fully-pill (999px) tabs/toggles/chips. The whole UI is one max-1440px column that collapses cleanly at 880px into a mobile layout where data tables restack as labeled cards and the side modal goes full-screen. Colors live as real CSS custom properties in src/index.css; spacing, type sizes, and most component styling are currently hardcoded inline — this document distills the *intended* system from what the code actually renders.

colors:
  bg: "#0a0a0b"
  panel: "#131316"
  panel-2: "#18181c"
  panel-3: "#1f1f24"
  border: "#232328"
  border-strong: "#2d2d33"
  text: "#f5f5f7"
  text-dim: "#a1a1aa"
  text-faint: "#6b6b73"
  green: "#4ade80"
  green-dim: "#16a34a"
  red: "#f87171"
  red-dim: "#dc2626"
  accent: "#7dd3fc"
  accent-2: "#38bdf8"
  dime: "#6EF5A4"
  brokerage-dime: "#6EF5A4"
  brokerage-webull: "#3b82f6"
  brokerage-binance: "#f0b90b"
  brokerage-multiple: "#71717a"
  modal-surface: "#161618"

palette:
  - "#7dd3fc"
  - "#a78bfa"
  - "#f472b6"
  - "#fbbf24"
  - "#4ade80"
  - "#fb7185"
  - "#22d3ee"
  - "#facc15"
  - "#c4b5fd"
  - "#f97316"
  - "#34d399"
  - "#e879f9"

typography:
  display:
    fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, sans-serif"
    fontSize: 28px
    fontWeight: 600
    letterSpacing: -0.02em
    use: "Hero portfolio value, chart summary big number"
  title:
    fontFamily: "'Inter', sans-serif"
    fontSize: 22px
    fontWeight: 700
    letterSpacing: -0.015em
    use: "Modal titles (.modal-head h2), KPI tile value"
  lg:
    fontFamily: "'Inter', sans-serif"
    fontSize: 16px
    fontWeight: 600
    use: "Brand wordmark, card titles"
  md:
    fontFamily: "'Inter', sans-serif"
    fontSize: 14px
    fontWeight: 500
    use: "Form inputs, desktop nav, row primary text"
  base:
    fontFamily: "'Inter', sans-serif"
    fontSize: 13px
    fontWeight: 500
    use: "Default body — buttons, dropdown items, tabs, table rows"
  sm:
    fontFamily: "'Inter', sans-serif"
    fontSize: 12px
    fontWeight: 500
    use: "Secondary labels, range tabs, captions, KPI labels"
  xs:
    fontFamily: "'Inter', sans-serif"
    fontSize: 11px
    fontWeight: 500
    use: "Source/type tags, status pills, mobile sub-values"
  micro:
    fontFamily: "'Inter', sans-serif"
    fontSize: 10px
    fontWeight: 500
    letterSpacing: 0.04em
    textTransform: uppercase
    use: "Type tags (ETF, STOCK), uppercase micro-labels"
  num:
    fontFamily: "'JetBrains Mono', ui-monospace, monospace"
    fontVariantNumeric: tabular-nums
    use: "EVERY number — prices, quantities, %s, dates in tables. Applied via the .num class at any size."

radii:
  xs: 4px
  sm: 6px
  md: 8px
  lg: 10px
  xl: 12px
  xxl: 14px
  card: 16px
  pill: 999px
  circle: 50%

spacing:
  xxs: 2px
  xs: 4px
  sm: 8px
  md: 12px
  base: 16px
  lg: 20px
  xl: 24px
  xxl: 28px
  section: 32px

elevation:
  raise: "0 1px 2px rgba(0,0,0,0.2)"
  tooltip: "0 8px 24px rgba(0,0,0,0.5)"
  dropdown: "0 12px 32px rgba(0,0,0,0.4)"
  popover: "0 16px 40px rgba(0,0,0,0.5)"

breakpoints:
  mobile: "max-width 880px"
  narrow: "max-width 700px"
  tiny: "max-width 520px"

components:
  card:
    background: "{colors.panel}"
    border: "1px solid {colors.border}"
    rounded: "{radii.card}"
    padding: 24px
  modal:
    background: "{colors.modal-surface}"
    borderLeft: "1px solid {colors.border-strong}"
    width: 480px
    use: "Right-side drawer; full-screen below {breakpoints.mobile}"
  dropdown-btn:
    background: "{colors.panel-2}"
    border: "1px solid {colors.border}"
    rounded: "{radii.pill}"
    typography: "{typography.base}"
    padding: 8px 12px 8px 14px
  dropdown-menu:
    background: "{colors.panel-2}"
    border: "1px solid {colors.border-strong}"
    rounded: "{radii.xl}"
    elevation: "{elevation.dropdown}"
    padding: 6px
  pill-tabs:
    background: "{colors.panel-2}"
    border: "1px solid {colors.border}"
    rounded: "{radii.xl}"
    activeBackground: "{colors.panel}"
    activeElevation: "{elevation.raise}"
    use: "Portfolio tabs, range tabs, nav (desktop)"
  range-tabs:
    background: "{colors.panel-2}"
    rounded: "{radii.lg}"
    itemRounded: "{radii.sm}"
    typography: "{typography.sm}"
  btn-primary:
    background: "{colors.text}"
    textColor: "{colors.bg}"
    rounded: "{radii.pill}"
    typography: "{typography.base}"
    fontWeight: 600
    padding: 11px 18px
  btn-mini:
    rounded: "{radii.sm}"
    padding: 5px 11px
    typography: "{typography.sm}"
  pill-btn:
    background: transparent
    border: "1px solid {colors.border}"
    rounded: "{radii.pill}"
    typography: "{typography.base}"
    padding: 9px 14px
  field-input:
    background: "{colors.panel-3}"
    border: "1px solid transparent"
    focusBorder: "1px solid {colors.border-strong}"
    rounded: "{radii.lg}"
    typography: "{typography.md}"
    padding: 14px 16px
  currency-toggle:
    background: "{colors.panel}"
    border: "1px solid {colors.border}"
    rounded: "{radii.pill}"
    activeBackground: "{colors.text}"
    activeTextColor: "{colors.bg}"
  kpi-tile:
    background: "{colors.panel}"
    rounded: "{radii.card}"
    padding: 16px 18px
    labelType: "{typography.sm}"
    valueType: "{typography.title}"
  chart-card:
    background: "{colors.panel}"
    rounded: "{radii.card}"
    tooltip: "{elevation.tooltip}"
    use: "SVG line chart, viewBox matched to rendered px so axis text stays 11px"
  meter-bar:
    track: "{colors.panel-2}"
    rounded: "{radii.pill}"
    height: 8px-10px
    use: "Contribution bar, rebalance drift bar"
  source-tag:
    background: "{colors.panel-2}"
    border: "1px solid {colors.border}"
    rounded: "{radii.pill}"
    typography: "{typography.xs}"
    dotSize: 6px
  type-tag:
    background: "{colors.panel-2}"
    border: "1px solid {colors.border}"
    rounded: "{radii.xs}"
    typography: "{typography.micro}"
  citation-chip:
    typography: "{typography.sm}"
    use: "NotebookLM provenance label (e.g. 'NotebookLM · 7 July 2026')"
  empty-state:
    background: "{colors.panel}"
    border: "1px dashed {colors.border-strong}"
    rounded: "{radii.card}"
    padding: 96px 24px
  tooltip:
    background: "{colors.panel-2}"
    border: "1px solid {colors.border-strong}"
    rounded: "{radii.md}"
    elevation: "{elevation.tooltip}"
    typography: "{typography.sm}"
---

## Overview

My-Port is a single-user, dark-mode portfolio tracker. The base canvas is a
near-black **`{colors.bg}`** (#0a0a0b), with depth built from four layered greys
— **`{colors.panel}`** (#131316) for cards, **`{colors.panel-2}`** (#18181c) for
inset controls and menus, **`{colors.panel-3}`** (#1f1f24) for form fields, and
**`{colors.modal-surface}`** (#161618) for the side drawer. Separation comes from
1px borders (**`{colors.border}`**, **`{colors.border-strong}`**) rather than
heavy shadows; the whole UI reads as flat panels floating on black.

There is **one cool accent** — **`{colors.accent}`** (#7dd3fc "sky") — used for
focus rings, the benchmark line on the Performance chart, and the brand gradient.
It is used sparingly. The colors that actually carry meaning are the **semantic
pair**: **`{colors.green}`** (#4ade80) for up / gain / positive and
**`{colors.red}`** (#f87171) for down / loss / negative. This pairing is the
loudest signal in the product and appears on nearly every screen.

The system's true signature is **monospace numerals**. Every number — price,
quantity, percentage, in-table date — renders in **JetBrains Mono** with
`font-variant-numeric: tabular-nums` via the **`.num`** class, so columns of
figures align optically down to the decimal. UI chrome (labels, buttons, nav)
runs **Inter**. This split — Inter for words, mono for numbers — is non-negotiable
and is what makes a dense financial table legible.

Shape language is **soft but tight**: cards at 16px (`{radii.card}`), controls at
8–12px (`{radii.md}`–`{radii.xl}`), and every tab / toggle / chip fully pill
(`{radii.pill}`). Nothing is sharp-cornered except the SVG chart plots.

**Key Characteristics:**
- Layered-grey depth on a near-black floor; borders over shadows for separation.
- One accent (`{colors.accent}`), used scarcely; meaning is carried by the green-up / red-down pair.
- Monospace tabular numerals (`.num`) on **every** number — the defining trait.
- Pill-shaped segmented controls: portfolio tabs, range tabs, currency toggle, filter chips all use the `{component.pill-tabs}` idiom (inset `{colors.panel-2}` track, active item lifts to `{colors.panel}` with `{elevation.raise}`).
- A single right-side **drawer modal** (`{component.modal}`) for all add/edit/detail flows — slides in from the right on desktop, goes full-screen on mobile.
- One content column, max 1440px, that collapses at 880px: data tables restack from grid rows into labeled cards, and desktop pill-nav swaps for a dropdown.
- Brokerage identity colors (Dime! green, Webull blue, Binance gold) appear only as small dots, never as fills.

## Colors

### Surface (layered greys, darkest → lightest)
- **Bg** (`{colors.bg}` — #0a0a0b): The page floor. Everything sits on this.
- **Panel** (`{colors.panel}` — #131316): Default card surface (`{component.card}`), and the *active* state of pill-tabs.
- **Panel-2** (`{colors.panel-2}` — #18181c): Inset controls — the track behind segmented tabs, dropdown menus, tooltips, tags, meter-bar tracks.
- **Panel-3** (`{colors.panel-3}` — #1f1f24): Form field fill (`{component.field-input}`) — the deepest interactive surface.
- **Modal surface** (`{colors.modal-surface}` — #161618): The drawer modal body and footer. Slightly warmer/lighter than a card so the overlay reads as separate from the page.

### Borders
- **Border** (`{colors.border}` — #232328): Default 1px separator — card edges, row dividers, control outlines, tag borders.
- **Border Strong** (`{colors.border-strong}` — #2d2d33): Heavier stroke — menu/tooltip/modal edges, field focus border, dashed empty-state outline, scrollbar thumbs.

### Text
- **Text** (`{colors.text}` — #f5f5f7): Primary — headlines, values, active labels. Near-white, never pure white.
- **Text Dim** (`{colors.text-dim}` — #a1a1aa): Secondary — inactive tabs, sub-labels, muted meta, secondary figures.
- **Text Faint** (`{colors.text-faint}` — #6b6b73): Tertiary — placeholders, axis labels, mobile row label prefixes, disabled hints.

### Semantic (the meaning layer)
- **Green** (`{colors.green}` — #4ade80): Up / gain / positive return / Buy / Deposit / Dividend. Used on text, chart lines, meter fills, and tinted chip backgrounds (`rgba(74,222,128,0.12)`).
- **Green Dim** (`{colors.green-dim}` — #16a34a): Deeper green for cash-asset logos and denser fills.
- **Red** (`{colors.red}` — #f87171): Down / loss / negative return / Sell / Withdraw / Fee / Tax / notification dot.
- **Red Dim** (`{colors.red-dim}` — #dc2626): Deeper red (e.g. THB cash logo).

### Accent
- **Accent / Sky** (`{colors.accent}` — #7dd3fc): Focus-visible ring, benchmark line on the Performance chart, first palette slot. The one non-semantic brand color.
- **Accent-2** (`{colors.accent-2}` — #38bdf8): Gradient partner for the brand dot.

### Brokerage identity (dots only)
- **Dime!** `{colors.brokerage-dime}` #6EF5A4 · **Webull** `{colors.brokerage-webull}` #3b82f6 · **Binance** `{colors.brokerage-binance}` #f0b90b · **Multiple** `{colors.brokerage-multiple}` #71717a (sentinel for combined same-ticker rows). Each has a darker `dot` variant. These appear **only** as 6–8px dots beside a portfolio name — never as backgrounds or text.

### Categorical palette
A fixed 12-color `{palette}` drives the allocation donut (PieChart) and the
strategy bucket colors (`bucketColorMap`). Colors are assigned by index position
so a bucket keeps one stable color across the Rebalance / Suggestions / Research
sections. Do not hand-pick from this list per chart — always assign by position.

## Typography

### Families
- **Inter** (400/500/600/700) — all UI text: labels, buttons, nav, headings, body.
- **JetBrains Mono** (400/500/600) — all numerals, via the **`.num`** class, which also sets `font-variant-numeric: tabular-nums`.

Both are loaded from Google Fonts in `src/index.css`.

### Scale
The code hardcodes sizes inline; this is the canonical scale new work must snap to.

| Token | Size | Weight | Use |
|---|---|---|---|
| `{typography.display}` | 28px | 600 | Hero portfolio value, chart summary big number (32px on mobile hero) |
| `{typography.title}` | 22px | 700 | Modal titles, KPI tile values |
| `{typography.lg}` | 16px | 600 | Brand wordmark, card titles |
| `{typography.md}` | 14px | 500 | Form inputs, desktop nav, row primary text |
| `{typography.base}` | 13px | 500 | **Default body** — buttons, dropdown items, tabs, table rows |
| `{typography.sm}` | 12px | 500 | Secondary labels, range tabs, captions, KPI labels |
| `{typography.xs}` | 11px | 500 | Source/type tags, status pills, mobile sub-values |
| `{typography.micro}` | 10px | 500 | Uppercase type tags (ETF, STOCK), tracked +0.04em |
| `{typography.num}` | any | 400–600 | JetBrains Mono, tabular-nums — every number, applied over any size above |

### Principles
- **Numbers are always `.num`.** A price, quantity, percentage, or in-table date without the mono class is a bug — columns must align.
- **13px is the workhorse.** Most interactive text (buttons, tabs, dropdown items, rows) is 13/500. Reserve 14px for form inputs and emphasis.
- **Loud moments are rare.** Only the hero value, chart big number (28px), and modal titles / KPI values (22px) are large. Everything else stays ≤14px — density is the point.
- **Negative tracking on large text.** Display/title sizes use `-0.015em`/`-0.02em` to keep big Inter from feeling loose.

## Layout

### Container
One centered column: `.app` at `max-width: 1440px`, with responsive padding
using `env(safe-area-inset-*)` — `max(32px, inset)` on desktop sides, tightening
to `max(16px, inset)` below 880px. The bottom padding is always ≥80px so the
final row clears the mobile home indicator.

### Spacing scale
4-based. Tokens: `{spacing.xxs}` 2 · `{spacing.xs}` 4 · `{spacing.sm}` 8 ·
`{spacing.md}` 12 · `{spacing.base}` 16 · `{spacing.lg}` 20 · `{spacing.xl}` 24 ·
`{spacing.xxl}` 28 · `{spacing.section}` 32.
- **Card padding:** 24px desktop (`{spacing.xl}`), 18px on mobile.
- **Card-to-card gap in the two-up grid:** 20px (`.grid`), collapsing to 16px and one column on mobile.
- **Control gaps:** 8px (`{spacing.sm}`) between related controls; 4px inside dense segmented tracks.
- **Section rhythm:** page sections stack with ~20–24px gaps (`.strategy-page`, `.perf-page`).

### Grids
- **Overview:** `.grid` is a 2-column split (chart + donut) → 1 column below 880px.
- **Performance KPIs:** `auto-fit minmax(150px, 1fr)` → forced 2-column below 700px.
- **Tables** (holdings `.row`, transactions `.tx-row`): CSS grid with fixed column
  templates on desktop → single column of labeled cards on mobile (see Responsive).

## Elevation

Depth is mostly **borders on flat panels**, not shadows. There are four shadow
tiers, used only where something floats above the page:

- **Raise** (`{elevation.raise}` — `0 1px 2px rgba(0,0,0,0.2)`): the active pill-tab lifting off its track. The only "resting" shadow.
- **Tooltip** (`{elevation.tooltip}` — `0 8px 24px rgba(0,0,0,0.5)`): chart hover tooltips.
- **Dropdown** (`{elevation.dropdown}` — `0 12px 32px rgba(0,0,0,0.4)`): picker/select menus.
- **Popover** (`{elevation.popover}` — `0 16px 40px rgba(0,0,0,0.5)`): the notification bell panel.

The drawer modal uses a slide-in animation and a border-left rather than a drop
shadow. There is no progressive multi-tier elevation system — pick the tier by
role, not by "how high."

## Components

### Card
`{component.card}` — `{colors.panel}` fill, 1px `{colors.border}`, 16px radius,
24px padding. The universal container for every chart, table, KPI group, and
strategy section. A card has a `.card-head` (title + optional controls, wraps on
mobile) and a body. Card title is `{typography.lg}`; card sub-label is
`{typography.sm}` in `{colors.text-dim}`.

### Modal (drawer)
`{component.modal}` — a 480px right-side drawer on `{colors.modal-surface}` with a
`border-left`, sliding in over a scrim. Structure: `.modal-head` (22px/700 title +
32px close button), scrollable `.modal-body`, and a `.modal-foot` with a top
border holding the primary action. Below 880px it becomes full-width with
safe-area padding top and bottom. All add / edit / detail / import flows use this
one shell.

### Dropdown / picker
`{component.dropdown-btn}` triggers `{component.dropdown-menu}`. The button is a
pill (`{colors.panel-2}`, 1px border) with a label and a **10×10 chevron caret**
(the standard caret across the app — `M2 4l3 3 3-3`, rotates 180° when open). The
menu floats with `{elevation.dropdown}`, 12px radius, 6px padding, and holds
`.dropdown-item` rows (13px, 8px radius, selected state marked). Closes on outside
click via the shared `useClickOutside` hook. Used by every select, sort, and
benchmark picker.

### Segmented pill-tabs
`{component.pill-tabs}` — an inset `{colors.panel-2}` track with a 1px border and
pill/rounded corners; items are pill/rounded buttons in `{typography.base}`
`{colors.text-dim}`, and the active item lifts to `{colors.panel}` +
`{colors.text}` with `{elevation.raise}`. Three instances share this idiom:
**portfolio tabs** (All / Dime! / Webull / Binance, with a leading brokerage dot),
**range tabs** (`{component.range-tabs}`: 1W…ALL, tighter at 12px), and the
desktop **nav**.

### Buttons
- `{component.btn-primary}` — high-contrast inverse: `{colors.text}` fill,
  `{colors.bg}` text, pill, 13px/600. The one strong CTA (Add, Import, Save).
- `{component.pill-btn}` — transparent, 1px border, pill. Secondary/utility
  actions (filters, "Add transaction" openers).
- `{component.btn-mini}` — compact 7px-radius button for inline row actions
  (Edit / Skip in the import preview).

### Form field
`{component.field-input}` — `{colors.panel-3}` fill, **transparent** border that
becomes `{colors.border-strong}` on focus (no glow, no ring), 10px radius, 14px
text. Variants: `.field-with-suffix` (right padding for the currency chip),
`.field-with-icon` (left padding). Paired with a `.field-label` above.
`CurrencySuffix` is the per-field USD/THB chip; `EditDateField` is the
DD/MM/YYYY input + calendar popover. Both are shared across the add and edit
modals.

### Currency toggle
`{component.currency-toggle}` — a two-segment USD/THB pill on `{colors.panel}`;
the active segment inverts to `{colors.text}` fill / `{colors.bg}` text. Lives in
the top bar and flips the entire app's render currency.

### KPI tile
`{component.kpi-tile}` — a `{component.card}` variant: 16–18px padding, a
`{typography.sm}` `{colors.text-dim}` label over a `{typography.title}` value.
Value color is semantic (green/red) for returns, plain text for neutral metrics.
Used in the Performance KPI row (auto-fit grid, 2-up on mobile).

### Chart card
`{component.chart-card}` — an SVG line chart inside a card. The viewBox is matched
to the rendered pixel size (via ResizeObserver) so axis labels render at their
true 11px at any card width. A vertical hover-line + `hover-dot` track the cursor,
feeding a `{component.tooltip}`. Line color is semantic (green/red by sign);
benchmark overlays use `{colors.accent}`. Shared idiom between ReturnChart and
PerformancePage.

### Meter bar
`{component.meter-bar}` — a rounded `{colors.panel-2}` track with a colored fill.
Two uses: the **contribution bar** (fill width ∝ |pp|, green/red by sign) and the
**rebalance drift bar** (bucket-color fill + a target tick + a green-under /
red-over gap segment). Height 8–10px, pill radius.

### Tags & chips
- `{component.source-tag}` — small pill with a 6px brokerage dot + name.
- `{component.type-tag}` — 4px-radius uppercase micro-label (ETF, STOCK, CASH).
- `{component.citation-chip}` — NotebookLM provenance label (`citeLabel`, e.g.
  "NotebookLM · 7 July 2026").
- `.type-pill` — a colored-border status pill (transaction actions).

### Empty state
`{component.empty-state}` — a dashed-border panel, 96px vertical padding, a 64px
rounded icon well, a `{typography.md}` title, and `{typography.base}`
`{colors.text-dim}` body. Used when a page has no data yet.

## Responsive Behavior

The layout is desktop-first with three `max-width` breakpoints. There is **no
separate mobile design** — the same components restack; only the patterns below
change.

| Breakpoint | Width | Key changes |
|---|---|---|
| Desktop | > 880px | Full pill-nav centered; two-up `.grid`; tables as multi-column grid rows; modal as 480px right drawer. |
| Mobile | ≤ 880px | **Nav swaps**: `.nav-desktop` hides, `.nav-mobile` dropdown shows. `.grid` → 1 column. **Tables → labeled cards** (see below). **Modal → full-screen** with safe-area padding. Card padding 24→18px. Chart uses a fixed 220px height (not aspect-ratio). User-pill name and cur-toggle labels shrink. |
| Narrow | ≤ 700px | Performance KPI grid → 2 columns; contribution rows tighten (smaller columns, 12px text). |
| Tiny | ≤ 520px | Brand wordmark text hides (dot only); hero value 32→28px; portfolio tabs tighten to 12px. |

### The table→card collapse (the key mobile pattern)
On desktop, holdings (`.row`) and transactions (`.tx-row`) are CSS-grid rows under
a shared header row (`.list-head` / `.tx-head-row`). Below 880px:
- The header row is hidden (`display: none`).
- Each row becomes a single-column stack (one card per record).
- Each cell reveals its column name via a `::before { content: attr(data-label) }`
  prefix in `{colors.text-faint}`, laid out as a label–value flex row.

Any new data table must follow this pattern: give cells a `data-label`, hide the
header on mobile, and restack. Never horizontal-scroll a table.

### Mobile-specific rules
- **Safe areas:** always pad with `max(Npx, env(safe-area-inset-*))`; keep ≥80px
  bottom clearance.
- **iOS chart fix:** `aspect-ratio` on `.chart-wrap` makes iOS Safari size width
  from the ratio and overflow; on mobile use a plain fixed `height` instead.
- **Segmented controls scroll, not wrap-break:** portfolio/range tracks use
  `overflow-x: auto` with hidden scrollbars; ranges may `flex-wrap` inside a card.

## Conventions

Rules that aren't components but are binding for consistency:

- **Green up, red down — always.** `{colors.green}` = gain / positive / Buy /
  Deposit / Dividend; `{colors.red}` = loss / negative / Sell / Withdraw / Fee /
  Tax. Never invert, never use another color for direction.
- **Every number is `.num`.** Mono + tabular-nums on all figures and in-table
  dates. Words stay Inter.
- **USD is canonical.** All values are stored and computed in USD; multiply by the
  live `fxRate` from `CurrencyContext` only at render. The currency toggle is the
  single control that flips display.
- **Brokerage colors are dots, not fills.** Dime!/Webull/Binance identity shows
  only as a small dot beside the name.
- **One caret.** The 10×10 chevron (`M2 4l3 3 3-3`) is the app-wide dropdown
  indicator; rotate it for open state rather than swapping glyphs.
- **Outside-click via `useClickOutside`.** Every popover/menu closes through the
  shared hook — don't hand-roll listeners.
- **Focus is a ring, not a glow.** `:focus-visible` → 2px `{colors.accent}`
  outline; field focus is a border-color change to `{colors.border-strong}`.

## Known Gaps

- **Inline styles.** ~200 `style={{}}` blocks across the components hold spacing,
  type sizes, and one-off layout literals. This doc distills the *intended* system
  from them; the code is not yet tokenized to match. New work should follow the
  scales here, not copy arbitrary inline values.
- **Legacy off-scale values.** A few sizes sit between scale steps (e.g. 12.5px,
  13.5px in isolated spots). Treat these as legacy — snap to the nearest scale
  token for anything new.
- **No spacing/type CSS variables.** Only colors are real custom properties.
  `{spacing.*}` and `{typography.*}` here are documentation tokens, not code
  variables — until a future tokenization pass adds `--space-*` / `--text-*`.
- **Hover states** are lightly specified (mostly color shifts to `{colors.text}`);
  no formal hover-elevation system.
- **Loading / skeleton states** are minimal — charts show a "Loading price
  history…" line; there is no shared skeleton component.
- **Light mode** does not exist; the system is dark-only by design.
