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
- `fcIsMobile()` in `touch.js` returns true at ≤768px — gates mobile toolbar rows, FAB visibility, mobile list view

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

**Breakpoint migration — replacing the 1000px sidebar collapse:**
The existing `@media(max-width:1000px)` rules in `responsive.css` that collapse the sidebar to 60px icons must be **removed and replaced** by the new `@media(max-width:1024px)` drawer behavior. The 60px icon-only mode is eliminated — the sidebar is either fully visible (>1024px) or hidden as a drawer (≤1024px). All associated rules (`.main { margin-left: 60px }`, `.sidebar { width: 60px }`, `.sb-label { display: none }`, etc.) at 1000px are replaced by the drawer rules at 1024px.

**CSS approach:**
- `@media(max-width:1024px)` on `.sidebar` for transform/position/width
- New `.sidebar.open` class for slide-in
- `.drawer-overlay` element for the backdrop
- Transition: `transform .25s cubic-bezier(.4,0,.2,1)`

**JS approach:**
- New `src/frontend/utils/drawer.js` module
- `toggleDrawer()`, `openDrawer()`, `closeDrawer()` functions
- Close on: overlay click, nav item click, swipe left gesture, orientation change
- Swipe detection: touchstart/touchmove/touchend on sidebar element, threshold 80px leftward, direction-locked (ignore vertical movement >30px)

**Orientation change handling:**
- Drawer closes on orientation change
- Modals reflow but stay open
- In-progress drag operations are cancelled by FullCalendar natively

### 2. Calendar Full Width

**Layout:**
- At ≤1024px: `.main { margin-left: 0 }` — calendar takes 100% viewport width
- Topbar: full width, hamburger on left

**Resource column (practitioner names):**
- Desktop (>1024px): `140px` (unchanged)
- Tablet landscape (769px–1024px): `120px`
- Tablet portrait (≤768px): `100px`
- Implementation: JS `matchMedia` listener that calls `calendar.setOption('resourceAreaWidth', value)` on breakpoint change
- Names displayed as "Prénom I." format on tablet if truncated (CSS `text-overflow: ellipsis`)

**Week view:**
- Landscape (>768px): 7 days visible (full week)
- Portrait (≤768px): 5 days visible (Monday–Friday)
- Implementation: The existing `rollingWeek` custom view (defined in `calendar-init.js` with `duration: { days: 7 }`) must have its duration changed dynamically. On portrait tablets, call `calendar.setOption('duration', { days: 5 })` or use `calendar.changeView('rollingWeek', { duration: { days: 5 } })`. Use a `matchMedia('(max-width:768px)')` listener to toggle between 5 and 7 days.

**Day view:**
- Full width, unchanged behavior
- Swipe left/right to navigate to next/previous day (see Section 4)

**Slot height:**
- All tablet orientations: 26px (unchanged). Reducing slot height was considered but rejected — maintaining consistent 44px touch targets on events is more important than fitting extra time slots.

### 3. Toolbar Optimization (≤1024px)

**The mobile detection threshold problem:**
The existing `fcIsMobile()` function in `touch.js` returns true only at ≤768px. The mobile toolbar rows (`.at-row1`, `.at-row2`) and FAB are gated behind this function and the `@media(min-width:769px)` CSS rule that hides them.

**Solution:** Introduce `fcIsTablet()` in `touch.js`: `() => window.innerWidth <= 1024 && window.innerWidth > 768`. Keep `fcIsMobile()` unchanged at ≤768px. The tablet toolbar uses a **hybrid approach**: keep the desktop toolbar structure (`.at-row-nav`) but restyle it for touch, and show the FAB.

**Tablet toolbar layout (769px–1024px):**
```
┌──────────────────────────────────────────────────────────┐
│ ☰  [◄] [►] [Auj.]  Mer. 20 mars 2026     [J] [S] [M]  │
│ [Sophie L.] [Martin D.] [Julie R.] [+2]            🔍  │
└──────────────────────────────────────────────────────────┘
```

**Row 1 (navigation) — restyle `.at-row-nav`:**
- Hamburger ☰: 44×44px, opens drawer, inserted as first child
- Nav buttons ◄ ►: 44×44px (up from 30px)
- Today button: padding 10px 16px, 44px height
- Title: current date, 1rem font
- View buttons: labels "J" / "S" / "M" (short), 44px touch targets

**Row 2 (practitioners) — restyle `.at-filter-panel` or practitioner pills row:**
- Practitioner pills: `max-width: 60vw` (up from 40vw), horizontal scroll if overflow
- Pill touch targets: padding 8px 14px, min-height 40px
- Search: icon-only (🔍), expands to 200px input on tap

**Hidden on tablet:**
- Vedette/Gap/Lock buttons → moved into a "⋯" overflow menu
- Stats bar (`.at-row-stats`) → `display: none`

**Overflow menu (⋯) specification:**
- Trigger: 44×44px button with three dots icon, positioned at end of Row 1
- Dropdown panel: `position: absolute; right: 0; top: 100%`
- Width: `200px`, background `var(--white)`, border `1px solid var(--border-light)`, border-radius `var(--radius-sm)`, box-shadow `var(--shadow-md)`
- Z-index: 35 (above toolbar at 30, below modals at 300)
- Items: Vedette toggle, Gap Analyzer toggle, Lock toggle, Stats toggle — each 48px height, full width
- Close on: item click, click outside, scroll
- CSS class: `.at-overflow-menu`, `.at-overflow-item`

**Mobile toolbar (≤768px):**
- Unchanged — continues using `.at-row1`/`.at-row2` mobile layout
- FAB visible (unchanged)

**FAB visibility:**
- Change the `@media(min-width:769px)` rule that hides `.cal-fab` to `@media(min-width:1025px)` — FAB visible on both tablet and mobile
- FAB position: `bottom: calc(24px + env(safe-area-inset-bottom))`

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
| Sidebar nav items (in drawer) | 18px height | 48px height |

**Calendar interactions (unchanged):**
- Tap → open detail
- Long press (800ms) → drag to move
- Double-tap empty slot → Quick Create

**Day view swipe navigation:**
- Swipe left → `calendar.next()` (next day)
- Swipe right → `calendar.prev()` (previous day)
- Implementation: touchstart/touchmove/touchend on the calendar container
- Threshold: 60px horizontal, direction-locked (ignore if vertical movement >30px)
- Only active in day view (`timeGridDay`), not week/month
- File: `src/frontend/views/agenda/calendar-interactions.js`

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
- Virtual keyboard handling: listen to `visualViewport.resize` event on Android, ensure `.m-body` scrolls and `.m-bottom` remains visible

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

The Quick Booking feature (lightning bolt button) opens a specialized panel for fast phone-in bookings. Its exact UI flow will be analyzed during implementation by reading the associated JS files.

**Tablet rules (same as other modals/panels):**
- Lightning bolt button: 44px minimum touch target
- Whatever panel/modal it opens: `max-width: min(540px, 90vw)`, 44px touch targets, sticky action button at bottom
- Preserve existing flow — responsive adaptation only, no functional changes

**Note:** This section is intentionally light. The Quick Booking flow is complex and will be fully specified during the implementation planning phase after code analysis.

## Files to Modify

### CSS
- `src/frontend/styles/responsive.css` — refactor 1000px breakpoint to 1024px drawer, add tablet toolbar/touch rules
- `src/frontend/styles/sidebar.css` — drawer mode, overlay, transition, touch targets
- `src/frontend/styles/calendar.css` — toolbar hamburger, overflow menu, resource column
- `src/frontend/styles/modal.css` — extend 44px touch targets to ≤1024px breakpoint
- `src/frontend/styles/topbar.css` — full width at ≤1024px, hamburger space
- `src/frontend/styles/buttons.css` — 44px touch targets on `.btn-primary`, `.btn-outline`, `.btn-sm` at ≤1024px
- `src/frontend/styles/components.css` — touch target adjustments for `.cal-btn`, `.dg-btn` at ≤1024px

### JS
- New: `src/frontend/utils/drawer.js` — sidebar drawer toggle, overlay, swipe-to-close
- `src/frontend/utils/touch.js` — add `fcIsTablet()` function
- `src/frontend/views/agenda/calendar-init.js` — responsive resourceAreaWidth, week day count via matchMedia
- `src/frontend/views/agenda/calendar-toolbar.js` or equivalent — hamburger button, overflow menu rendering
- `src/frontend/views/agenda/calendar-interactions.js` — day view swipe navigation
- `src/frontend/views/agenda/index.js` — import and wire drawer.js

### HTML
- `public/dashboard.html` — hamburger button in topbar, drawer overlay element, overflow menu trigger in toolbar

## Constraints

- Desktop (>1024px) must remain completely unchanged
- All responsive changes via `@media(max-width:1024px)` queries or JS `matchMedia`
- No breaking changes to existing calendar functionality
- FullCalendar Scheduler Premium API for view/resource configuration
- Performance: no layout thrashing on orientation change
- The existing 1000px sidebar collapse rules are fully replaced by the 1024px drawer behavior
- `fcIsMobile()` stays at ≤768px threshold — new `fcIsTablet()` added for 769px–1024px range
