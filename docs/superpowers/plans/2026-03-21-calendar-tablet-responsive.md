# Calendar Tablet Responsive — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Bookt calendar dashboard fully usable on Android tablets (≤1024px) with proper touch targets, sidebar drawer, and responsive calendar.

**Architecture:** Replace the 1000px sidebar icon-collapse with a 1024px off-screen drawer. Restyle the desktop toolbar for tablet touch targets (hybrid approach — no mobile row restructure). Add `fcIsTablet()` to gate tablet-specific JS behavior. All changes behind `@media(max-width:1024px)` or `matchMedia` to protect desktop.

**Tech Stack:** Vanilla CSS/JS, FullCalendar Scheduler Premium, no build step changes.

**Spec:** `docs/superpowers/specs/2026-03-20-calendar-tablet-responsive-design.md`

---

### Task 1: Add `fcIsTablet()` and update touch.js

**Files:**
- Modify: `src/frontend/utils/touch.js` (14 lines total)

- [ ] **Step 1: Add fcIsTablet function**

```javascript
// After line 6, add:
export const fcIsTablet = () => window.innerWidth <= 1024 && window.innerWidth > 768;
```

- [ ] **Step 2: Verify existing exports unchanged**

`fcIsMobile` stays at `<= 768`, `fcIsTouch` stays as-is, `initTouchBlockers` unchanged.

- [ ] **Step 3: Commit**

```bash
git add src/frontend/utils/touch.js
git commit -m "feat: add fcIsTablet() for 769-1024px range"
```

---

### Task 2: Sidebar drawer CSS

**Files:**
- Modify: `src/frontend/styles/sidebar.css` (24 lines)
- Modify: `src/frontend/styles/responsive.css` (lines 2–19 — replace 1000px block)
- Modify: `src/frontend/styles/topbar.css` (line 2, 3, 5)

- [ ] **Step 1: Add drawer and overlay styles to sidebar.css**

Append at end of `sidebar.css`:

```css
/* ── Drawer mode (tablet ≤1024px) ── */
.drawer-overlay{position:fixed;inset:0;background:rgba(0,0,0,.4);z-index:49;opacity:0;pointer-events:none;transition:opacity .25s}
.drawer-overlay.open{opacity:1;pointer-events:auto}

@media(max-width:1024px){
  .sidebar{transform:translateX(-100%);transition:transform .25s cubic-bezier(.4,0,.2,1);width:280px;z-index:50}
  .sidebar.open{transform:translateX(0)}
  .ni{padding:14px 16px;min-height:48px;font-size:.85rem}
  .sb-label{padding:16px 16px 6px}
  .sb-foot{padding:18px 16px}
}
```

- [ ] **Step 2: Replace 1000px sidebar collapse in responsive.css**

Remove the sidebar-related rules from the `@media(max-width:1000px)` block (lines 2–9). Keep any non-sidebar rules at 1000px (toolbar padding etc). The new sidebar rules are in sidebar.css at 1024px.

Replace lines 2–9 of responsive.css with:

```css
/* ── Tablet ≤1024px ── */
@media(max-width:1024px){
  .main{margin-left:0}
  .topbar{padding:14px 16px}
  .content{padding:20px 16px}
  .agenda-toolbar{padding:8px 16px 6px;margin:0 -16px;width:calc(100% + 32px)}
}
```

- [ ] **Step 3: Update topbar.css for full width at tablet**

In `topbar.css` line 2, `.main { margin-left: 234px }` stays for desktop. The `margin-left: 0` override is in the new `@media(max-width:1024px)` block in responsive.css.

No changes needed to topbar.css itself — the responsive.css override handles it.

- [ ] **Step 4: Commit**

```bash
git add src/frontend/styles/sidebar.css src/frontend/styles/responsive.css
git commit -m "feat: sidebar drawer CSS — hidden off-screen at ≤1024px, slide-in overlay"
```

---

### Task 3: Drawer JS module + hamburger button

**Files:**
- Create: `src/frontend/utils/drawer.js`
- Modify: `public/dashboard.html` (lines 18, 61 — add overlay element and hamburger)
- Modify: `src/frontend/views/agenda/index.js` (import drawer)

- [ ] **Step 1: Create drawer.js**

```javascript
/**
 * Sidebar drawer for tablet — slide-in overlay navigation.
 * Toggle via hamburger button. Close on overlay click, nav click, swipe left.
 */

const SWIPE_THRESHOLD = 80;

let _sidebar, _overlay;

export function initDrawer() {
  _sidebar = document.querySelector('.sidebar');
  _overlay = document.querySelector('.drawer-overlay');
  if (!_sidebar || !_overlay) return;

  // Close on overlay click
  _overlay.addEventListener('click', closeDrawer);

  // Close on nav item click
  _sidebar.querySelectorAll('.ni').forEach(el => {
    el.addEventListener('click', () => setTimeout(closeDrawer, 150));
  });

  // Swipe left to close
  let startX = 0, currentX = 0, swiping = false;
  _sidebar.addEventListener('touchstart', e => {
    startX = e.touches[0].clientX;
    currentX = startX;
    swiping = true;
    _sidebar.style.transition = 'none';
  }, { passive: true });

  _sidebar.addEventListener('touchmove', e => {
    if (!swiping) return;
    currentX = e.touches[0].clientX;
    const diff = currentX - startX;
    if (diff < 0) {
      _sidebar.style.transform = `translateX(${diff}px)`;
    }
  }, { passive: true });

  _sidebar.addEventListener('touchend', () => {
    if (!swiping) return;
    swiping = false;
    _sidebar.style.transition = '';
    if (startX - currentX > SWIPE_THRESHOLD) {
      closeDrawer();
    } else {
      _sidebar.style.transform = '';
    }
  });

  // Close on orientation change
  window.addEventListener('orientationchange', closeDrawer);
}

export function openDrawer() {
  if (!_sidebar || !_overlay) return;
  _sidebar.classList.add('open');
  _overlay.classList.add('open');
}

export function closeDrawer() {
  if (!_sidebar || !_overlay) return;
  _sidebar.classList.remove('open');
  _overlay.classList.remove('open');
  _sidebar.style.transform = '';
}

export function toggleDrawer() {
  if (_sidebar?.classList.contains('open')) closeDrawer();
  else openDrawer();
}
```

- [ ] **Step 2: Add overlay and hamburger to dashboard.html**

After the opening `<body>` tag (before `<aside class="sidebar">`), add:

```html
<div class="drawer-overlay"></div>
```

In the topbar (line 61), add a hamburger button as first child:

```html
<div class="topbar">
  <button class="hamburger" onclick="toggleDrawer()" aria-label="Menu">
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>
  </button>
  <h1 id="pageTitle">Dashboard</h1>
  ...
</div>
```

- [ ] **Step 3: Add hamburger CSS to topbar.css**

Append to `topbar.css`:

```css
.hamburger{display:none;width:44px;height:44px;border:none;background:none;cursor:pointer;color:var(--text);flex-shrink:0;align-items:center;justify-content:center;border-radius:var(--radius-xs)}
.hamburger:hover{background:var(--surface)}
@media(max-width:1024px){.hamburger{display:flex}}
```

- [ ] **Step 4: Wire drawer in index.js**

Add import at top of `src/frontend/views/agenda/index.js`:

```javascript
import { initDrawer } from '../../utils/drawer.js';
```

Call `initDrawer()` during initialization. Also bridge `toggleDrawer`:

```javascript
import { toggleDrawer } from '../../utils/drawer.js';
// In bridge():
bridge({ toggleDrawer, ... });
```

NOTE: If `index.js` isn't the right place for a global init (drawer is app-wide, not agenda-specific), wire it in the main app entry point instead. Read the file first to determine the correct location.

- [ ] **Step 5: Commit**

```bash
git add src/frontend/utils/drawer.js public/dashboard.html src/frontend/styles/topbar.css src/frontend/views/agenda/index.js
git commit -m "feat: sidebar drawer with hamburger — toggle, overlay, swipe-to-close"
```

---

### Task 4: Toolbar tablet optimization

**Files:**
- Modify: `src/frontend/styles/responsive.css` (the new 1024px block)
- Modify: `src/frontend/styles/calendar.css` (toolbar button styles)
- Modify: `src/frontend/views/agenda/index.js` (lines 281–314 — toolbar HTML generation)

- [ ] **Step 1: Add hamburger to toolbar HTML in index.js**

In `index.js`, the toolbar HTML is generated around lines 281–314. In the `.at-row-nav` section, add a hamburger button as first element:

```javascript
// Inside the at-row-nav div, before the nav buttons:
`<button class="at-hamburger hamburger" onclick="toggleDrawer()" aria-label="Menu">
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>
</button>`
```

This uses the same `.hamburger` class (hidden on desktop, visible at ≤1024px).

- [ ] **Step 2: Show FAB on tablet — update responsive.css**

Change the `@media(min-width:769px)` block (line 128–132) to `@media(min-width:1025px)`:

```css
/* Was: @media(min-width:769px) — now include tablet */
@media(min-width:1025px){
  .cal-fab{display:none!important}
  .at-row1,.at-row2{display:none!important}
  .mob-list{display:none!important}
}
```

- [ ] **Step 3: Add FAB to toolbar generation for tablet**

In `index.js` line 314, the FAB is only generated when `mobile` is true. Change to include tablet:

```javascript
// Was: mobile ? `<button class="cal-fab" ...>` : ''
// Change to: (mobile || tablet) ? `<button class="cal-fab" ...>` : ''
```

Import `fcIsTablet` from touch.js and set `const tablet = fcIsTablet()` alongside the existing `const mobile = fcIsMobile()`.

- [ ] **Step 4: Add tablet toolbar CSS to responsive.css**

Inside the `@media(max-width:1024px)` block, add:

```css
/* Toolbar touch targets */
.at-nav-btn{width:44px;height:44px;font-size:.9rem}
.at-today{padding:10px 16px;min-height:44px}
.at-vp-btn{padding:10px 16px;min-height:44px;font-size:.7rem}
.at-prac-pills{max-width:60vw}
.prac-pill{padding:8px 14px;min-height:40px;font-size:.68rem}
.at-search-wrap.expanded .at-search{width:200px}

/* Hide advanced tools on tablet */
.at-row-stats{display:none}
```

- [ ] **Step 5: Add overflow menu for Vedette/Gap/Lock**

Add an overflow menu trigger button in the toolbar HTML (index.js), visible only on tablet:

```javascript
// After view buttons, add:
`<button class="at-overflow-btn hamburger" onclick="toggleOverflowMenu()" aria-label="Plus d'options">
  <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="5" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="12" cy="19" r="2"/></svg>
</button>
<div class="at-overflow-menu" id="atOverflowMenu">
  <!-- Vedette, Gap, Lock buttons moved here on tablet -->
</div>`
```

Add CSS for the overflow menu in calendar.css:

```css
.at-overflow-btn{display:none}
.at-overflow-menu{display:none;position:absolute;right:0;top:100%;width:200px;background:var(--white);border:1px solid var(--border-light);border-radius:var(--radius-sm);box-shadow:var(--shadow-md);z-index:35;padding:4px 0}
.at-overflow-menu.open{display:block}
.at-overflow-item{display:flex;align-items:center;gap:10px;padding:12px 16px;min-height:48px;width:100%;border:none;background:none;font-family:var(--sans);font-size:var(--text-base);color:var(--text);cursor:pointer;text-align:left}
.at-overflow-item:hover{background:var(--surface)}
@media(max-width:1024px){.at-overflow-btn{display:flex}}
```

Add a simple `toggleOverflowMenu()` function and bridge it. Close on click outside.

- [ ] **Step 6: Add safe-area FAB positioning**

In responsive.css, update the FAB rule in the ≤768px block (line 88–91):

```css
.cal-fab{bottom:calc(24px + env(safe-area-inset-bottom))}
```

- [ ] **Step 7: Commit**

```bash
git add src/frontend/styles/responsive.css src/frontend/styles/calendar.css src/frontend/views/agenda/index.js
git commit -m "feat: tablet toolbar — hamburger, 44px targets, overflow menu, FAB visible"
```

---

### Task 5: Responsive calendar (resource width + week view)

**Files:**
- Modify: `src/frontend/views/agenda/calendar-init.js` (lines 169–173, 218)

- [ ] **Step 1: Make resourceAreaWidth responsive**

After the calendar is created (around line 266), add a `matchMedia` listener:

```javascript
// After calState.fcCal = new Calendar(...)
const mqTabletLandscape = window.matchMedia('(max-width:1024px) and (min-width:769px)');
const mqTabletPortrait = window.matchMedia('(max-width:768px)');

function updateResourceWidth() {
  if (mqTabletPortrait.matches) {
    calState.fcCal.setOption('resourceAreaWidth', '100px');
  } else if (mqTabletLandscape.matches) {
    calState.fcCal.setOption('resourceAreaWidth', '120px');
  } else {
    calState.fcCal.setOption('resourceAreaWidth', '140px');
  }
}

mqTabletLandscape.addEventListener('change', updateResourceWidth);
mqTabletPortrait.addEventListener('change', updateResourceWidth);
updateResourceWidth();
```

- [ ] **Step 2: Make week view show 5 days in portrait**

Add a listener to adjust the rollingWeek duration:

```javascript
function updateWeekDuration() {
  const view = calState.fcCal.view;
  if (view.type !== 'rollingWeek' && view.type !== 'timeGridWeek') return;
  if (mqTabletPortrait.matches) {
    calState.fcCal.setOption('duration', { days: 5 });
  } else {
    calState.fcCal.setOption('duration', { days: 7 });
  }
}

mqTabletPortrait.addEventListener('change', updateWeekDuration);
```

NOTE: Test if `setOption('duration', ...)` works on a custom view. If not, use `calendar.changeView()` to switch to a different custom view definition with 5 days. Read FullCalendar docs during implementation to determine the correct API.

- [ ] **Step 3: Commit**

```bash
git add src/frontend/views/agenda/calendar-init.js
git commit -m "feat: responsive calendar — resource width and 5-day week on portrait tablet"
```

---

### Task 6: Touch targets — modals and buttons

**Files:**
- Modify: `src/frontend/styles/modal.css` (lines 38–64 — extend breakpoint)
- Modify: `src/frontend/styles/buttons.css`
- Modify: `src/frontend/styles/calendar.css` (event resizer)

- [ ] **Step 1: Extend modal touch targets from 680px to 1024px**

In `modal.css`, the touch target rules are inside `@media(max-width:680px)` (lines 38–64). Create a **new** `@media(max-width:1024px)` block that includes ONLY the touch target rules (not the full-screen rules which stay at 680px):

```css
/* ── Tablet touch targets (≤1024px) ── */
@media(max-width:1024px){
  .m-close{width:44px;height:44px}
  .m-st-btn{min-height:44px;padding:10px 14px}
  .m-chip{min-height:44px;padding:8px 14px}
  .m-tab{min-height:44px;padding:12px 16px}
  .m-qbtn{width:44px;height:44px}
  .csw-dot{width:32px;height:32px}
  .cal-btn{min-height:44px}
  .dg-btn{min-height:48px}
  .m-dialog{max-width:min(540px,90vw)}
}
```

The existing 680px block keeps its full-screen rules. The touch targets will apply from 1024px down (cascading).

- [ ] **Step 2: Add responsive button sizing**

Append to `buttons.css`:

```css
@media(max-width:1024px){
  .btn-primary,.btn-outline{padding:12px 18px;min-height:44px}
  .btn-sm{padding:8px 14px;min-height:40px}
}
```

- [ ] **Step 3: Force event resizer at tablet**

In `calendar.css`, the resizer is 28px only for `@media(pointer:coarse)` (lines 136–139). Add a width-based override:

```css
@media(max-width:1024px){
  .fc-timegrid-event .fc-event-resizer-end{height:28px}
}
```

- [ ] **Step 4: Commit**

```bash
git add src/frontend/styles/modal.css src/frontend/styles/buttons.css src/frontend/styles/calendar.css
git commit -m "feat: 44px touch targets on modals, buttons, and calendar at ≤1024px"
```

---

### Task 7: Day view swipe navigation

**Files:**
- Modify: `src/frontend/views/agenda/calendar-interactions.js`

- [ ] **Step 1: Add swipe detection for day view navigation**

Add at the end of the file (or in an appropriate init section):

```javascript
export function initDaySwipe(calendarEl) {
  if (!('ontouchstart' in window)) return;

  let startX = 0, startY = 0, swiping = false;
  const THRESHOLD = 60;
  const VERTICAL_LOCK = 30;

  calendarEl.addEventListener('touchstart', e => {
    startX = e.touches[0].clientX;
    startY = e.touches[0].clientY;
    swiping = true;
  }, { passive: true });

  calendarEl.addEventListener('touchmove', e => {
    if (!swiping) return;
    const dy = Math.abs(e.touches[0].clientY - startY);
    if (dy > VERTICAL_LOCK) swiping = false; // vertical scroll, not swipe
  }, { passive: true });

  calendarEl.addEventListener('touchend', e => {
    if (!swiping) return;
    swiping = false;
    const endX = e.changedTouches[0].clientX;
    const diff = endX - startX;
    const view = calState.fcCal?.view;
    if (!view || (view.type !== 'timeGridDay' && view.type !== 'resourceTimeGridDay')) return;

    if (diff < -THRESHOLD) {
      calState.fcCal.next();
    } else if (diff > THRESHOLD) {
      calState.fcCal.prev();
    }
  });
}
```

- [ ] **Step 2: Call initDaySwipe from calendar init**

In `calendar-init.js`, after the calendar is rendered, call:

```javascript
import { initDaySwipe } from './calendar-interactions.js';
// After calendar.render():
initDaySwipe(document.getElementById('fcCalendar'));
```

- [ ] **Step 3: Commit**

```bash
git add src/frontend/views/agenda/calendar-interactions.js src/frontend/views/agenda/calendar-init.js
git commit -m "feat: swipe left/right to navigate days in day view on touch devices"
```

---

### Task 8: Toast position adjustment

**Files:**
- Modify: `src/frontend/styles/modal.css` (toast stack position)

- [ ] **Step 1: Adjust toast position to clear FAB on tablet**

In `modal.css`, find `.g-toast-stack` (around line 288) and add a tablet override:

```css
@media(max-width:1024px){
  .g-toast-stack{bottom:calc(90px + env(safe-area-inset-bottom))}
}
```

This ensures toasts appear above the FAB button (56px + 24px bottom + margin).

- [ ] **Step 2: Commit**

```bash
git add src/frontend/styles/modal.css
git commit -m "feat: position toast stack above FAB on tablet"
```

---

### Task 9: Integration testing and polish

**Files:**
- All modified files

- [ ] **Step 1: Verify desktop unchanged**

Open the app at >1024px viewport width. Verify:
- Sidebar visible at 234px
- No hamburger button shown
- Toolbar unchanged (full labels, all buttons visible)
- Calendar resource column at 140px
- FAB not visible
- Modals at fixed max-width
- All existing functionality works

- [ ] **Step 2: Verify tablet landscape (1024px)**

Resize to 1024px or test on tablet landscape:
- Sidebar hidden, hamburger visible in topbar and toolbar
- Tap hamburger → drawer slides in (280px, overlay)
- Tap overlay → drawer closes
- Swipe left on drawer → closes
- Calendar full width, resource column 120px
- Week view shows 7 days
- All toolbar buttons 44px touch targets
- Vedette/Gap/Lock in overflow menu (⋯)
- FAB visible bottom-right
- Stats bar hidden
- Modals centered at min(540px, 90vw), touch targets 44px

- [ ] **Step 3: Verify tablet portrait (768px)**

Resize to 768px:
- Same drawer behavior
- Resource column 100px
- Week view shows 5 days
- Day view: swipe left/right works
- FAB with safe-area-inset-bottom
- Toast stack above FAB

- [ ] **Step 4: Verify mobile unchanged (≤680px)**

Resize to 680px or narrower:
- Mobile toolbar rows (at-row1, at-row2) still work
- Mobile list view still works
- Modals full-screen
- All existing mobile behavior intact

- [ ] **Step 5: Final commit if any polish needed**

```bash
git add -A
git commit -m "fix: tablet responsive polish"
```
