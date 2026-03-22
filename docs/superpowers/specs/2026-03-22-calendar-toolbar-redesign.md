# Calendar Toolbar Redesign

## Problem

The calendar toolbar has grown organically and is now messy:
- Too many controls visible at once (nav, view switcher, practitioner pills, status filters, search, lock, featured slots, gap analyzer, smart optimizer, fill bar)
- No logical grouping — practitioner filters mixed with tools mixed with navigation
- 2nd row mixes view switching with tool buttons without clear separation
- Tablet experience suffers: practitioners use the calendar all day on tablets

## Design: Two Rows with Logical Separation

### Principle

**Row 1 = Actions** (what you DO: navigate, create, search)
**Row 2 = Filters** (what you SEE: which view, which practitioner, which status)
**Fill bar** = thin progress bar below (4-6px)

Secondary tools (featured slots, gap analyzer) move to overflow menu.

### Desktop Layout (1280px+)

```
Row 1: [hamburger] [← Auj →]  Sem. 12 — 17-23 mars     [search] [quick-book] [lock] [⋮]
Row 2: [J | S | M]  |  [Tous] [DK] [SN] [AM]  |  [En attente] [Annules] [No-show]
Fill:  ████████████░░░░░░░░░░ 68%
```

**Row 1 details:**
- Hamburger (sidebar toggle) — leftmost
- Navigation group: prev/today/next — compact, same as current
- Title: month/week display — flex-grow fills space
- Right side actions (flex, gap:6px):
  - Search icon (expandable input on click)
  - Quick booking (lightning bolt) — `IC` icon
  - Lock toggle — `IC.lock` / `IC.unlock`
  - Overflow menu (3-dot) — contains: Featured slots, Gap analyzer, Smart optimizer

**Row 2 details:**
- View switcher pills `[J|S|M]` — segmented control, leftmost
- Visual separator (1px border or 8px gap)
- Practitioner pills — scrollable, color dots, "Tous" first
- Visual separator
- Status filter pills — En attente (amber), Annules (red), No-show (gold)
- All pills in one scrollable row if overflow

**Fill bar:**
- 4px height (thinner than current 6px)
- Full width below row 2
- Same color logic: primary fill on surface background

### Tablet Layout (768-1279px)

```
Row 1: [☰] [←][Auj][→]  17-23 mars           [search] [⚡] [lock] [⋮]
Row 2: [J|S|M] | [Tous][DK][SN] | [Att.][Ann.][NS]  ← horizontal scroll
Fill:  ████████████░░░░░░░░░░
```

**Changes from desktop:**
- Title shortened: no "Sem. 12 —", just date range
- Status labels abbreviated: "Att.", "Ann.", "NS"
- Row 2 is a single horizontal scroll container
- View switcher labels: J/S/M (single letter)
- All touch targets minimum 44px height
- Pills get `padding: 8px 14px` for fat fingers
- Practitioner pills max-width removed — scroll handles overflow naturally

### Mobile Layout (<600px)

```
Row 1: [←][Auj][→]  22 mars        [list|grid] [⚡]
Row 2: [Tous][DK][SN] [Att.][Ann.]  ← horizontal scroll
```

**Changes from tablet:**
- No hamburger (sidebar is drawer overlay, triggered differently)
- View switcher replaced by list/grid toggle (2 icons)
- Lock and overflow move into overflow or are hidden
- Quick booking (lightning) stays visible — used constantly
- FAB (+) bottom-right for quick create remains
- No fill bar
- Row 2: same scroll strip with practitioner + status pills

### Overflow Menu Contents

The `⋮` button opens a dropdown (`.at-overflow-menu`) containing:
- Featured slots toggle (star icon + label)
- Gap analyzer toggle (grid icon + label + badge if gaps found)
- Smart optimizer (bolt icon + label)
- On mobile: Lock toggle also moves here

### What Changes vs Current

| Element | Current | New |
|---|---|---|
| Row 1 | Nav + title + prac pills + search + filter toggle | Nav + title + action buttons (search, quick-book, lock, overflow) |
| Row 2 | View switcher + tool buttons (lock, featured, gap, SO) | View switcher + practitioner pills + status pills |
| Practitioner pills | Row 1, mixed with nav | Row 2, grouped with filters |
| Status filters | In filter panel (hidden by default) + duplicated in pills | Row 2, always visible, next to prac pills |
| Filter panel | Collapsible extra row | Removed — status filters are inline in row 2 |
| Filter toggle button | Funnel icon in row 1 | Removed — no longer needed |
| Featured/Gap/SO | Individual buttons in row 2 | Inside overflow menu |
| Lock | Row 2 tool buttons | Row 1 right side (promoted — used daily) |
| Quick booking | Row 2 tool buttons | Row 1 right side (promoted — used daily) |
| Fill bar | Row 3, 6px | Below row 2, 4px (thinner) |
| Category chips | In filter panel | In overflow menu or removed if rarely used |

### What Stays the Same

- Navigation behavior (prev/today/next)
- Practitioner pill click behavior and color dots
- Status toggle behavior (active/inactive with dashed borders)
- Search expand/collapse animation
- Mobile FAB for quick create
- Sticky positioning with backdrop blur
- All data-fetching and filter logic

### CSS Class Mapping

| Current class | New usage |
|---|---|
| `.at-row-nav` | Row 1 (nav + actions) |
| `.at-row-views` | Row 2 (view switcher + filter pills) |
| `.at-row-stats` | Fill bar (thinner) |
| `.at-filter-panel` | Removed |
| `.at-filter-toggle` | Removed |
| `.at-prac-pills` | Moves to row 2 |
| `.prac-pill.st-toggle` | Moves to row 2 (after prac pills) |
| `.at-view-pill` | Stays in row 2, but leftmost |
| `.at-views` | Removed (tools go to overflow) |
| `.at-overflow-btn` | Stays in row 1 right side, always visible |
| `.at-overflow-menu` | Updated contents (featured, gap, SO, optionally lock on mobile) |

### Touch Target Requirements

All interactive elements must meet minimum 44x44px on tablet/mobile:
- Navigation buttons: 44x44px
- Pills: 44px height, padding 8px 14px minimum
- Action buttons (search, quick-book, lock): 44x44px
- Overflow menu items: 44px row height

### Responsive Breakpoints

- Desktop: >1280px — full labels, spacious layout
- Tablet: 768-1279px — abbreviated labels, scroll row 2, 44px targets
- Mobile: <600px (existing) — restructured to 2 compact rows + FAB

### No Behavioral Changes

This is a layout-only refactor. All filter logic, calendar rendering, practitioner selection, status toggling, view switching, and search remain identical. Only the HTML structure and CSS of the toolbar changes.
