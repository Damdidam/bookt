# Calendar Toolbar Redesign — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reorganize the calendar toolbar into two logically separated rows (actions vs filters) with secondary tools in overflow menu.

**Architecture:** Layout-only refactor of HTML generation in `index.js` (lines 282-315) and CSS in `calendar.css` + `responsive.css`. No behavioral changes — all filter/nav/view logic stays identical.

**Tech Stack:** Vanilla JS (template strings), CSS

**Spec:** `docs/superpowers/specs/2026-03-22-calendar-toolbar-redesign.md`

---

### Task 1: Restructure Desktop Toolbar HTML (index.js)

**Files:**
- Modify: `src/frontend/views/agenda/index.js:282-315`

- [ ] **Step 1: Rewrite Row 1 (`.at-row-nav`) — actions only**

Replace lines 287-295 with new Row 1 that contains: hamburger, nav group, title, then RIGHT side: search, quick-booking, lock, overflow button.

```javascript
  // Row 1: Navigation + Actions
  toolbar += `<div class="at-row-nav">`;
  toolbar += `<button class="at-hamburger hamburger" onclick="toggleDrawer()" aria-label="Menu"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg></button>`;
  toolbar += `<div class="at-nav"><button class="at-nav-btn" onclick="atNav('prev')">\u2039</button><button class="at-today" id="atDate" onclick="atNav('today')">${todayLabel}</button><button class="at-nav-btn" onclick="atNav('next')">\u203a</button></div>`;
  toolbar += `<span class="at-title" id="atTitle"></span>`;
  toolbar += `<div class="at-actions">`;
  toolbar += `<div class="at-search-wrap" id="atSearchWrap"><button class="at-search-icon" onclick="fcToggleSearch()" title="Rechercher">${searchIconSvg}</button>${searchHtml}</div>`;
  toolbar += soBtnHtml;
  toolbar += lockBtnHtml;
  toolbar += `<button class="at-overflow-btn hamburger" onclick="toggleOverflowMenu()" aria-label="Plus d'options"><svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="5" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="12" cy="19" r="2"/></svg></button>`;
  toolbar += `<div class="at-overflow-menu" id="atOverflowMenu"></div>`;
  toolbar += `</div>`;
  toolbar += `</div>`;
```

Key changes: practitioner pills REMOVED from row 1, filter toggle REMOVED, search/SO/lock/overflow grouped in `.at-actions` div on the right.

- [ ] **Step 2: Rewrite Row 2 (`.at-row-views`) — filters only**

Replace lines 296-305 with new Row 2 that contains: view switcher, separator, practitioner pills, separator, status pills.

```javascript
  // Row 2: View switcher + Filter pills (scrollable)
  toolbar += `<div class="at-row-filters">`;
  toolbar += `<div class="at-view-pill">`;
  toolbar += `<button class="at-vp-btn${initView === 'resourceTimeGridDay' || initView === 'timeGridDay' ? ' active' : ''}" data-view="resourceTimeGridDay" onclick="atView('resourceTimeGridDay')"><span class="vl">Jour</span><span class="vs">J</span></button>`;
  toolbar += `<button class="at-vp-btn${initView === 'rollingWeek' ? ' active' : ''}" data-view="rollingWeek" onclick="atView('rollingWeek')"><span class="vl">Semaine</span><span class="vs">S</span></button>`;
  toolbar += `<button class="at-vp-btn${initView === 'dayGridMonth' ? ' active' : ''}" data-view="dayGridMonth" onclick="atView('dayGridMonth')"><span class="vl">Mois</span><span class="vs">M</span></button>`;
  toolbar += `</div>`;
  toolbar += `<div class="at-filter-sep"></div>`;
  if (pillsHtml) toolbar += `<div class="at-prac-pills">${pillsHtml}</div>`;
  toolbar += `<div class="at-filter-sep"></div>`;
  toolbar += `<div class="at-status-pills">${statusPillsHtml}</div>`;
  toolbar += `</div>`;
```

Key changes: view pill is leftmost, prac pills + status pills inline with separators, no tool buttons.

- [ ] **Step 3: Remove filter panel, keep fill bar**

Remove the filter panel line (309) and the filter toggle button variable (286, `filterIconSvg`). Keep the fill bar (307).

```javascript
  // Fill bar (thinner)
  toolbar += `<div class="at-row-stats" id="atRowStats"><div class="fill-bar"><div class="fill-bar-inner" id="fillBarInner"></div></div></div>`;
```

- [ ] **Step 4: Update overflow menu contents**

Find the `toggleOverflowMenu()` function in `calendar-toolbar.js` and update it to include featured slots, gap analyzer, and smart optimizer as menu items (instead of showing them as toolbar buttons). The overflow menu items should use the same onclick handlers.

- [ ] **Step 5: Verify syntax**

Run: `node -c src/frontend/views/agenda/index.js`
Expected: no errors

- [ ] **Step 6: Commit**

```bash
git add src/frontend/views/agenda/index.js
git commit -m "refactor(calendar): restructure toolbar HTML — actions row + filters row"
```

---

### Task 2: Update Desktop CSS (calendar.css)

**Files:**
- Modify: `src/frontend/styles/calendar.css`

- [ ] **Step 1: Add `.at-actions` styles for row 1 right-side group**

```css
.at-actions{display:flex;align-items:center;gap:6px;flex-shrink:0}
```

- [ ] **Step 2: Rename/add `.at-row-filters` styles for row 2**

Row 2 becomes a scrollable flex container with view pill + separator + prac pills + separator + status pills:

```css
.at-row-filters{display:flex;align-items:center;gap:6px;padding:6px 16px;overflow-x:auto;-webkit-overflow-scrolling:touch;scrollbar-width:none}
.at-row-filters::-webkit-scrollbar{display:none}
.at-filter-sep{width:1px;height:18px;background:var(--border-light);flex-shrink:0}
.at-status-pills{display:flex;gap:4px;flex-shrink:0}
```

- [ ] **Step 3: Thin the fill bar from 6px to 4px**

Update `.fill-bar` height to 4px.

- [ ] **Step 4: Remove `.at-filter-panel` and `.at-filter-toggle` styles**

Delete the CSS rules for the collapsible filter panel and the funnel toggle button. These are no longer needed.

- [ ] **Step 5: Remove `.at-views` and `.at-row-views` styles**

Replace with `.at-row-filters`. The `.at-views` container (which held lock/featured/gap/SO buttons) is gone.

- [ ] **Step 6: Commit**

```bash
git add src/frontend/styles/calendar.css
git commit -m "style(calendar): update toolbar CSS — actions group, filters row, remove filter panel"
```

---

### Task 3: Update Responsive CSS (responsive.css)

**Files:**
- Modify: `src/frontend/styles/responsive.css`

- [ ] **Step 1: Update tablet breakpoint (768-1279px)**

- `.at-row-filters` scrolls horizontally, touch targets 44px
- `.at-view-pill .vl` hidden, `.vs` shown (J/S/M)
- `.at-prac-pills` no max-width — scroll handles overflow
- All buttons/pills minimum height 44px
- `.at-lock-btn` stays visible (promoted to row 1)
- `.at-filter-sep` visible as thin separator

- [ ] **Step 2: Update mobile breakpoint (<600px)**

- `.at-row-nav`, `.at-row-filters`, `.at-row-stats` hidden
- `.at-row1` and `.at-row2` shown (existing mobile structure)
- Quick booking button (`.so-toggle-btn`) visible in `.at-row1`
- Lock and overflow hidden on mobile
- No fill bar

- [ ] **Step 3: Commit**

```bash
git add src/frontend/styles/responsive.css
git commit -m "style(calendar): responsive toolbar — tablet scroll, mobile compact"
```

---

### Task 4: Update Overflow Menu (calendar-toolbar.js)

**Files:**
- Modify: `src/frontend/views/agenda/calendar-toolbar.js`

- [ ] **Step 1: Update `toggleOverflowMenu()` to render featured/gap/SO as menu items**

The overflow menu should now include:
- Featured slots toggle (star icon + "Créneaux vedettes") — only if user is owner/manager and feature enabled
- Gap analyzer toggle (grid icon + "Analyseur de gaps" + badge) — only if owner/manager
- Smart optimizer (bolt icon + "Quick booking") — only if owner/manager
- On mobile only: Lock toggle

Each menu item uses the same onclick handlers (`fsToggleMode()`, `gaToggleMode()`, `soToggleMode()`, `fcToggleLock()`).

- [ ] **Step 2: Remove `fcToggleFilterPanel()` function if it exists in toolbar**

This function is no longer needed since the filter panel is removed.

- [ ] **Step 3: Verify syntax**

Run: `node -c src/frontend/views/agenda/calendar-toolbar.js`

- [ ] **Step 4: Commit**

```bash
git add src/frontend/views/agenda/calendar-toolbar.js
git commit -m "refactor(calendar): move secondary tools to overflow menu"
```

---

### Task 5: Smoke Test and Final Cleanup

**Files:**
- All modified files

- [ ] **Step 1: Build check**

Run: `npx vite build` or equivalent build command to verify no import/syntax errors.

- [ ] **Step 2: Visual verification checklist**

Desktop (>1280px):
- Row 1: hamburger, nav, title, search icon, quick-book, lock, overflow
- Row 2: [J|S|M] | [Tous][pills...] | [En attente][Annulés][No-show]
- Fill bar thin below
- Overflow menu opens with featured/gap/SO items

Tablet (768-1279px):
- Same 2 rows, row 2 scrolls horizontally
- Touch targets >= 44px
- Labels abbreviated

Mobile (<600px):
- Row 1: nav + title + list/grid + quick-book
- Row 2: scrollable pills
- FAB visible
- No fill bar

- [ ] **Step 3: Verify filter behavior unchanged**

- Click practitioner pills → calendar filters
- Click status pills → calendar filters
- Toggle lock → calendar editable state changes
- Click overflow → menu opens with secondary tools
- Search → filters bookings by client name

- [ ] **Step 4: Final commit and push**

```bash
git add -A
git commit -m "refactor(calendar): complete toolbar redesign — actions + filters rows"
git push
```
