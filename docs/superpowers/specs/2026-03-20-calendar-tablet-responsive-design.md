# Calendar Tablet Responsive Design

## Context

Bookt is a SaaS booking platform for Belgian aesthetic practitioners and hairdressers. The calendar dashboard is the primary interface — practitioners spend 90%+ of their time on it. They access it on Android tablets in both portrait and landscape orientations, often under stress (between clients, hands wet/gloved, phone calls). The UI must be fast, obvious, and forgiving.

**Target users:** Non-technical staff (hairdressers, aestheticians) who need to check their schedule and book appointments quickly.

**Target devices:** Android tablets, portrait and landscape. Landscape recommended for best experience.

**Practitioners per view:** Typically 1–4, max 5 resource columns.

**Key user flows:** View schedule, switch day/week, create RDV (Quick Create from slot click), Quick Booking (lightning bolt for phone-in bookings), open booking detail.

## Current State

- Sidebar: 234px fixed, collapses to 60px icons at ≤1000px
- Calendar: `margin-left` adjusts for sidebar, `resourceAreaWidth` fixed at 140px
- Toolbar: custom implementation with nav buttons, view switcher, practitioner pills, search
- Breakpoints: 1200px, 1000px, 768px, 680px, 640px, 500px — no dedicated tablet range
- Touch targets: many elements below 44px minimum (nav items 18px, buttons 30px, modal close 28px)
- Modals: full-screen only at ≤680px, no intermediate tablet optimization

## Design

### 1. Sidebar → Drawer (≤1024px)

**Behavior:**
- At ≤1024px, the sidebar hides off-screen (`transform: translateX(-100%)`)
- A hamburger button (☰) appears in the topbar, left side
- Tapping ☰ slides the sidebar over the content as an overlay drawer
- Width: 280px (Material Design standard)
- Overlay behind: `rgba(0,0,0,.4)`, tap to close
- Swipe left on drawer to close
- Tapping a nav item closes the drawer and navigates

**Sidebar content in drawer:**
- Same navigation items as current sidebar
- Touch targets: 48px minimum height on every nav item
- Font size slightly larger for readability

**Desktop (>1024px):**
- Sidebar stays at 234px fixed (unchanged)

**CSS approach:**
- `@media(max-width:1024px)` on `.sidebar` for transform/position
- New `.sidebar.open` class for slide-in
- `.drawer-overlay` element for the backdrop
- Transition: `transform .25s cubic-bezier(.4,0,.2,1)`

**JS approach:**
- Toggle function on hamburger click
- Close on overlay click, nav item click, swipe gesture
- Store state in memory (not persisted)

### 2. Calendar Full Width

**Layout:**
- At ≤1024px: `.main { margin-left: 0 }` — calendar takes 100% viewport width
- Topbar: full width, hamburger on left

**Resource column (practitioner names):**
- Desktop (>1024px): `140px` (unchanged)
- Tablet landscape (769px–1024px): `120px`
- Tablet portrait (≤768px): `100px`
- Names displayed as "Prénom I." format on tablet if truncated

**Week view:**
- Landscape: 7 days visible (full week)
- Portrait (≤768px): 5 days visible (Monday–Friday), scrollable to weekend
- Implementation: FullCalendar `dayCount` or `visibleRange` adjusted via JS `matchMedia`

**Day view:**
- Full width, unchanged behavior
- Swipe left/right to navigate to next/previous day

**Slot height:**
- Landscape: 26px (unchanged)
- Portrait with >3 practitioners: consider 22px to show more time slots

### 3. Toolbar Optimization (≤1024px)

**Layout:**
```
┌──────────────────────────────────────────────────────────┐
│ ☰  [◄] [►] [Auj.]  Mer. 20 mars 2026     [J] [S] [M]  │
│ [Sophie L.] [Martin D.] [Julie R.] [+2]            🔍  │
└──────────────────────────────────────────────────────────┘
```

**Row 1 (navigation):**
- Hamburger ☰: 44×44px, opens drawer
- Nav buttons ◄ ►: 44×44px (up from 30px)
- Today button: padding 10px 16px, 44px height
- Title: current date, 1rem font
- View buttons: labels "J" / "S" / "M" (short), 44px touch targets

**Row 2 (practitioners):**
- Practitioner pills: `max-width: 60vw` (up from 40vw), horizontal scroll if overflow
- Pill touch targets: padding 8px 14px, min-height 40px
- Search: icon-only (🔍), expands to 200px input on tap

**Hidden on tablet:**
- Vedette/Gap/Lock buttons → moved into a "⋯" overflow menu
- Stats bar (fill rate) → hidden, accessible via ⋯ menu

### 4. Touch Targets (≤1024px)

**Universal rule: 44px minimum on all interactive elements.**

| Element | Current | Tablet |
|---------|---------|--------|
| Nav buttons (◄ ►) | 30×30px | 44×44px |
| Today button | 6px 16px padding | 10px 16px padding |
| View buttons (J/S/M) | 6px 16px padding | 10px 16px padding |
| Practitioner pills | 6px 16px padding | 8px 14px padding |
| Event resizer handle | 10px (desktop) | 28px (force at ≤1024px, not just pointer:coarse) |
| FAB (+) | 56px, bottom:24px | 56px, bottom: calc(24px + env(safe-area-inset-bottom)) |
| Quick Booking (⚡) | current size | 44px minimum |
| Modal close button | 28px | 44px (extend from 680px breakpoint to 1024px) |
| Modal status buttons | current | min-height 44px |
| Modal duration chips | current | min-height 44px |
| Modal tabs | current | min-height 44px |

**Calendar interactions (unchanged):**
- Tap → open detail
- Long press (800ms) → drag to move
- Double-tap empty slot → Quick Create
- Swipe left/right on day view → navigate days

### 5. Modals on Tablet (680px–1024px)

**New intermediate breakpoint for modals:**

| Width | Behavior |
|-------|----------|
| >1024px | Centered dialog, fixed max-width (unchanged) |
| 680px–1024px | Centered dialog, `max-width: min(540px, 90vw)`, 44px touch targets |
| ≤680px | Full screen, drag handle, swipe-to-close (unchanged) |

**Quick Create modal:**
- Centered, not full-screen on tablet
- Width: `min(540px, 90vw)`
- "Créer le RDV" button: sticky at bottom, visible above virtual keyboard
- All inputs/selects: 44px touch targets
- Virtual keyboard handling: `.m-body` scrolls, bottom bar stays visible

**Booking Detail modal:**
- Same approach: centered, `min(540px, 90vw)`
- 44px touch targets on status buttons, chips, tabs
- Header gradient unchanged

**Task Detail modal:**
- Centered, `min(440px, 90vw)`
- Same touch target rules

**Confirm dialogs (showConfirmDialog):**
- Centered in parent modal, unchanged
- Touch targets already adequate (`.dg-btn min-height: 48px`)

**Toast stack:**
- Position: `bottom: calc(90px + env(safe-area-inset-bottom))` to clear FAB
- Unchanged behavior

### 6. Quick Booking (⚡)

- Lightning bolt button: 44px minimum touch target on tablet
- The modal/panel that opens: same rules as Quick Create — centered dialog `min(540px, 90vw)`, 44px touch targets, sticky action button
- Exact flow preserved from current implementation (to be analyzed during implementation)

## Files to Modify

### CSS
- `src/frontend/styles/responsive.css` — main responsive rules, new ≤1024px breakpoint
- `src/frontend/styles/sidebar.css` — drawer mode, overlay, transition
- `src/frontend/styles/calendar.css` — toolbar hamburger, resource column
- `src/frontend/styles/modal.css` — extend 44px touch targets to ≤1024px
- `src/frontend/styles/topbar.css` — full width, hamburger space

### JS
- New: `src/frontend/utils/drawer.js` — sidebar drawer toggle, overlay, swipe-to-close
- `src/frontend/views/agenda/calendar-init.js` — responsive resourceAreaWidth, week day count
- `src/frontend/views/agenda/calendar-toolbar.js` or equivalent — hamburger button, overflow menu
- Possibly: `src/frontend/utils/touch.js` — day view swipe navigation

### HTML
- `public/dashboard.html` — hamburger button in topbar, drawer overlay element, toolbar restructure

## Constraints

- Desktop (>1024px) must remain completely unchanged
- All responsive changes via `@media(max-width:1024px)` queries or JS `matchMedia`
- No breaking changes to existing calendar functionality
- FullCalendar Scheduler Premium API for view/resource configuration
- Performance: no layout thrashing on orientation change
