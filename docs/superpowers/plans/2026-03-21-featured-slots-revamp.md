# Featured Slots UX Revamp — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refactor the featured-slots view to reduce friction: single Publish/Unpublish action, drag-to-select, column toggle, responsive grid, protected booked slots.

**Architecture:** Single-file rewrite of `featured-slots.js`. The render is split into an initial DOM build (`renderGrid`) and a lightweight cell-update function (`updateCells`). Drag logic uses mousedown/mousemove/mouseup with column confinement. No backend changes.

**Tech Stack:** Vanilla JS (ES modules), existing CSS variables, existing API endpoints.

**Spec:** `docs/superpowers/specs/2026-03-21-featured-slots-revamp-design.md`

---

## File Structure

| File | Action | Responsibility |
|------|--------|----------------|
| `src/frontend/views/featured-slots.js` | Rewrite | All view logic: state, render, drag, publish |
| `src/frontend/styles/components.css` | Modify (lines 598-607) | Updated `.fs-*` styles: responsive, drag preview, touch targets |

No new files.

---

## Task 1: Refactor render — split DOM build from cell updates

**Files:**
- Modify: `src/frontend/views/featured-slots.js`

The current `render()` rebuilds the entire DOM via innerHTML on every toggle. We need to split it so drag can update cells cheaply.

- [ ] **Step 1: Add `renderGrid()` — builds DOM once with data-attributes on cells**

Replace the current `render()` function. The new `renderGrid()` builds the full HTML (header + grid) but adds `data-key="YYYY-MM-DD_HH:MM"` and `data-day="YYYY-MM-DD"` on each `.fs-cell`, and `data-day` on each `.fs-day-col` header. It calls `updateCells()` at the end.

```js
function renderGrid() {
  const c = document.getElementById('contentArea');
  const pract = practitioners.find(p => p.id === selectedPractId);
  const practName = pract?.display_name || '';
  const weekEndDate = addDays(weekStart, 6);
  const wsLabel = fmtDate(weekStart);
  const weLabel = fmtDate(weekEndDate);
  const isPast = weekStart < getMonday(new Date());

  // Practitioner selector
  let practSelect = '';
  if (practitioners.length > 1) {
    const opts = practitioners.map(p =>
      `<option value="${p.id}"${p.id === selectedPractId ? ' selected' : ''}>${esc(p.display_name)}</option>`
    ).join('');
    practSelect = `<select id="fsPractSelect" onchange="fsSwitchPract(this.value)" style="font-size:.85rem;padding:6px 10px;border:1px solid var(--border);border-radius:var(--radius-xs);background:var(--bg)">${opts}</select>`;
  } else {
    practSelect = `<span style="font-weight:600;font-size:.9rem">${esc(practName)}</span>`;
  }

  // Week nav
  const weekNav = `<div style="display:flex;align-items:center;gap:10px">
    <button class="btn-outline btn-sm" onclick="fsWeekNav(-1)">${IC.chevronLeft || '&lt;'}</button>
    <span style="font-size:.85rem;font-weight:600;min-width:200px;text-align:center">${wsLabel} — ${weLabel}</span>
    <button class="btn-outline btn-sm" onclick="fsWeekNav(1)">${IC.chevronRight || '&gt;'}</button>
  </div>`;

  // Grid
  const startMin = timeToMin(slotMin);
  const endMin = timeToMin(slotMax);
  const days = [];
  for (let i = 0; i < 7; i++) days.push(addDays(weekStart, i));

  let grid = '<div class="fs-grid" id="fsGrid">';
  grid += '<div class="fs-row fs-header"><div class="fs-time-col"></div>';
  days.forEach(d => {
    const clickable = isPast ? '' : `onclick="fsToggleColumn('${d}')" style="cursor:pointer"`;
    grid += `<div class="fs-day-col" data-day="${d}" ${clickable}>${fmtDate(d)}</div>`;
  });
  grid += '</div>';

  for (let m = startMin; m < endMin; m += 30) {
    const timeStr = minToTime(m);
    grid += `<div class="fs-row"><div class="fs-time-col">${timeStr}</div>`;
    days.forEach(d => {
      const key = d + '_' + timeStr;
      const isBooked = !!bookedSlots[key];
      const title = isBooked ? 'title="Créneau déjà réservé"' : '';
      grid += `<div class="fs-cell" data-key="${key}" data-day="${d}" ${title}></div>`;
    });
    grid += '</div>';
  }
  grid += '</div>';

  // State badge + buttons placeholder
  let h = `<p style="font-size:.85rem;color:var(--text-3);margin-bottom:16px">Sélectionnez vos créneaux disponibles, puis publiez pour les rendre visibles aux clients.</p>`;
  h += `<div class="card"><div class="card-h" style="flex-wrap:wrap;gap:10px">`;
  h += `<div style="display:flex;align-items:center;gap:12px">${practSelect}${weekNav}<span id="fsBadge"></span></div>`;
  if (!isPast) {
    h += `<div style="display:flex;gap:8px;align-items:center" id="fsActions"></div>`;
  }
  h += `</div><div style="padding:14px 18px;overflow-x:auto">${grid}`;
  h += `<div style="display:flex;gap:16px;margin-top:12px;font-size:.78rem;color:var(--text-4)">`;
  h += `<span style="display:flex;align-items:center;gap:4px"><span style="width:14px;height:14px;border-radius:3px;background:var(--primary-bg);border:1.5px solid var(--primary)"></span>Sélectionné</span>`;
  h += `<span style="display:flex;align-items:center;gap:4px"><span style="width:14px;height:14px;border-radius:3px;background:var(--bg-3);border:1.5px solid var(--border)"></span>Déjà réservé</span>`;
  h += `</div></div></div>`;

  c.innerHTML = h;
  updateCells();
}
```

- [ ] **Step 2: Add `updateCells()` — lightweight class/icon updater**

This function iterates existing `.fs-cell` elements and updates their classes and content based on `selectedSlots`, `bookedSlots`, `weekLocked`, and `isPast`. Also updates the badge and action buttons.

```js
function updateCells() {
  const isPast = weekStart < getMonday(new Date());
  const selCount = Object.keys(selectedSlots).length;

  // Update each cell
  document.querySelectorAll('.fs-cell').forEach(cell => {
    const key = cell.dataset.key;
    const isSelected = !!selectedSlots[key];
    const isBooked = !!bookedSlots[key];

    cell.className = 'fs-cell';
    if (isBooked) cell.classList.add('fs-booked');
    else if (isSelected) cell.classList.add('fs-selected');

    // Icon
    if (isSelected) {
      cell.innerHTML = '<svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:14px;height:14px"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>';
    } else if (isBooked) {
      cell.innerHTML = '<svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:12px;height:12px;opacity:.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';
    } else {
      cell.innerHTML = '';
    }
  });

  // Update badge
  const badge = document.getElementById('fsBadge');
  if (badge) {
    badge.innerHTML = weekLocked
      ? `<span style="color:var(--green);font-size:.78rem;font-weight:600">${IC.check || '✓'} Publié</span>`
      : `<span style="color:var(--text-4);font-size:.78rem">● Brouillon</span>`;
  }

  // Update action buttons
  const actions = document.getElementById('fsActions');
  if (actions && !isPast) {
    let btns = `<span style="font-size:.8rem;color:var(--text-4)">${selCount} créneau${selCount > 1 ? 'x' : ''}</span>`;
    if (!weekLocked) {
      btns += `<button class="btn-outline btn-sm btn-danger" onclick="fsClear()" ${selCount === 0 ? 'disabled' : ''}>Tout effacer</button>`;
      btns += `<button class="btn-primary btn-sm" onclick="fsPublish()" ${selCount === 0 ? 'disabled title="Sélectionnez au moins un créneau"' : ''}>${IC.send || '▶'} Publier</button>`;
    } else {
      btns += `<button class="btn-outline btn-sm btn-danger" onclick="fsUnpublish()">Dépublier</button>`;
    }
    actions.innerHTML = btns;
  }
}
```

- [ ] **Step 3: Replace all `render()` calls with `renderGrid()` except after toggle**

In `loadFeaturedSlots()`, `fsWeekNav()`, `fsSwitchPract()`: replace `render()` → `renderGrid()`.
In `fsToggle()`: replace `render()` → `updateCells()`.
In `fsClear()` after `loadWeekData()`: use `renderGrid()`.

- [ ] **Step 4: Verify manually — load featured-slots page, check grid renders, click a cell toggles it**

- [ ] **Step 5: Commit**

```bash
git add src/frontend/views/featured-slots.js
git commit -m "refactor(featured-slots): split render into renderGrid + updateCells"
```

---

## Task 2: Implement Publish / Unpublish (merge save + lock)

**Files:**
- Modify: `src/frontend/views/featured-slots.js`

- [ ] **Step 1: Add `fsPublish()` — saves slots then locks the week**

```js
async function fsPublish() {
  const selCount = Object.keys(selectedSlots).length;
  if (selCount === 0) {
    GendaUI.toast('Sélectionnez au moins un créneau', 'info');
    return;
  }

  const slots = [];
  Object.keys(selectedSlots).sort().forEach(key => {
    const [date, time] = key.split('_');
    slots.push({ date, start_time: time });
  });

  try {
    // Save slots
    const r1 = await fetch('/api/featured-slots', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + api.getToken() },
      body: JSON.stringify({ practitioner_id: selectedPractId, week_start: weekStart, slots })
    });
    if (!r1.ok) throw new Error((await r1.json()).error);

    // Lock week
    const r2 = await fetch('/api/featured-slots/lock', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + api.getToken() },
      body: JSON.stringify({ practitioner_id: selectedPractId, week_start: weekStart })
    });
    if (!r2.ok) {
      GendaUI.toast('Créneaux sauvegardés mais verrouillage échoué — retentez Publier', 'error');
      await loadWeekData();
      updateCells();
      return;
    }

    weekLocked = true;
    savedSlots = { ...selectedSlots };
    GendaUI.toast(`${selCount} créneau${selCount > 1 ? 'x' : ''} publié${selCount > 1 ? 's' : ''}`, 'success');
    updateCells();
  } catch (e) {
    GendaUI.toast('Erreur: ' + e.message, 'error');
  }
}
```

- [ ] **Step 2: Add `fsUnpublish()` — unlocks the week**

```js
async function fsUnpublish() {
  try {
    const r = await fetch(`/api/featured-slots/lock?practitioner_id=${selectedPractId}&week_start=${weekStart}`, {
      method: 'DELETE',
      headers: { 'Authorization': 'Bearer ' + api.getToken() }
    });
    if (!r.ok) throw new Error((await r.json()).error);
    weekLocked = false;
    GendaUI.toast('Semaine dépubliée — vous pouvez modifier vos créneaux', 'success');
    updateCells();
  } catch (e) {
    GendaUI.toast('Erreur: ' + e.message, 'error');
  }
}
```

- [ ] **Step 3: Remove old `fsSave()` and `fsToggleLock()` functions**

Delete both functions. They are replaced by `fsPublish()` and `fsUnpublish()`.

- [ ] **Step 4: Update `fsClear()` — also unlocks if needed**

Keep the existing `fsClear()` logic but replace `render()` calls with `renderGrid()` and update `savedSlots`:

```js
async function fsClear() {
  if (!confirm('Effacer tous les créneaux vedettes de cette semaine ?')) return;
  try {
    const r = await fetch(`/api/featured-slots?practitioner_id=${selectedPractId}&week_start=${weekStart}`, {
      method: 'DELETE',
      headers: { 'Authorization': 'Bearer ' + api.getToken() }
    });
    if (!r.ok) throw new Error((await r.json()).error);
    selectedSlots = {};
    if (weekLocked) {
      await fetch(`/api/featured-slots/lock?practitioner_id=${selectedPractId}&week_start=${weekStart}`, {
        method: 'DELETE',
        headers: { 'Authorization': 'Bearer ' + api.getToken() }
      });
      weekLocked = false;
    }
    savedSlots = {};
    GendaUI.toast('Créneaux vedettes effacés', 'success');
    updateCells();
  } catch (e) {
    GendaUI.toast('Erreur: ' + e.message, 'error');
  }
}
```

- [ ] **Step 5: Update bridge and exports**

```js
bridge({ loadFeaturedSlots, fsToggle, fsPublish, fsUnpublish, fsClear, fsWeekNav, fsSwitchPract, fsToggleColumn });
export { loadFeaturedSlots, fsToggle, fsPublish, fsUnpublish, fsClear, fsWeekNav, fsSwitchPract, fsToggleColumn };
```

- [ ] **Step 6: Verify manually — Publish button saves + locks, Unpublish unlocks, badge updates**

- [ ] **Step 7: Commit**

```bash
git add src/frontend/views/featured-slots.js
git commit -m "feat(featured-slots): merge save+lock into single Publish/Unpublish"
```

---

## Task 3: Add dirty-state tracking + navigation guard

**Files:**
- Modify: `src/frontend/views/featured-slots.js`

- [ ] **Step 1: Add `savedSlots` state and `isDirty()` helper**

At the top of the file, alongside other state variables:

```js
let savedSlots = {}; // snapshot of selectedSlots after last load/save
```

In `loadWeekData()`, after building `selectedSlots`, add:

```js
savedSlots = { ...selectedSlots };
```

Add helper:

```js
function isDirty() {
  const selKeys = Object.keys(selectedSlots).sort().join(',');
  const savedKeys = Object.keys(savedSlots).sort().join(',');
  return selKeys !== savedKeys;
}
```

- [ ] **Step 2: Add guard to `fsWeekNav()` and `fsSwitchPract()`**

```js
async function fsWeekNav(dir) {
  if (isDirty() && !confirm('Vos modifications ne sont pas publiées. Quitter quand même ?')) return;
  weekStart = addDays(weekStart, dir * 7);
  const c = document.getElementById('contentArea');
  c.innerHTML = '<div class="loading"><div class="spinner"></div></div>';
  await loadWeekData();
  renderGrid();
}

async function fsSwitchPract(pid) {
  if (isDirty() && !confirm('Vos modifications ne sont pas publiées. Quitter quand même ?')) return;
  selectedPractId = pid;
  const c = document.getElementById('contentArea');
  c.innerHTML = '<div class="loading"><div class="spinner"></div></div>';
  try {
    const ar = await fetch('/api/availabilities', { headers: { 'Authorization': 'Bearer ' + api.getToken() } });
    const ad = await ar.json();
    const pa = ad.availabilities?.[pid];
    if (pa) {
      slotMin = pa.slot_min || '08:00';
      slotMax = pa.slot_max || '19:00';
    }
  } catch (e) { /* use defaults */ }
  await loadWeekData();
  renderGrid();
}
```

- [ ] **Step 3: Verify manually — modify slots, navigate away, confirm dialog appears**

- [ ] **Step 4: Commit**

```bash
git add src/frontend/views/featured-slots.js
git commit -m "feat(featured-slots): dirty-state tracking + navigation guard"
```

---

## Task 4: Add column toggle (click day header)

**Files:**
- Modify: `src/frontend/views/featured-slots.js`

- [ ] **Step 1: Add `fsToggleColumn()` function**

```js
function fsToggleColumn(day) {
  if (weekLocked) return;
  // Get all cell keys for this day that are NOT booked
  const startMin = timeToMin(slotMin);
  const endMin = timeToMin(slotMax);
  const keys = [];
  for (let m = startMin; m < endMin; m += 30) {
    const key = day + '_' + minToTime(m);
    if (!bookedSlots[key]) keys.push(key);
  }
  // If any key is unselected → select all; else deselect all
  const allSelected = keys.every(k => !!selectedSlots[k]);
  keys.forEach(k => {
    if (allSelected) delete selectedSlots[k];
    else selectedSlots[k] = true;
  });
  updateCells();
}
```

- [ ] **Step 2: Verify — click day header selects all free slots, click again deselects**

- [ ] **Step 3: Commit**

```bash
git add src/frontend/views/featured-slots.js
git commit -m "feat(featured-slots): column toggle via day header click"
```

---

## Task 5: Add drag-to-select

**Files:**
- Modify: `src/frontend/views/featured-slots.js`

- [ ] **Step 1: Add drag state variables**

```js
let dragState = null; // { day, startKey, startMin, selecting, lastMin, previewKeys }
```

- [ ] **Step 2: Add drag handlers**

```js
function fsDragStart(e) {
  if (weekLocked) return;
  const cell = e.target.closest('.fs-cell');
  if (!cell || !cell.dataset.key) return;
  const key = cell.dataset.key;
  if (bookedSlots[key]) return;

  e.preventDefault();
  const [day, time] = key.split('_');
  const m = timeToMin(time);
  const selecting = !selectedSlots[key]; // true = adding, false = removing

  dragState = { day, startKey: key, startMin: m, selecting, lastMin: m, previewKeys: [key] };
  updateDragPreview();
}

function fsDragMove(e) {
  if (!dragState) return;
  e.preventDefault();

  let target;
  if (e.touches) {
    const touch = e.touches[0];
    target = document.elementFromPoint(touch.clientX, touch.clientY);
  } else {
    target = e.target;
  }

  const cell = target?.closest?.('.fs-cell');
  if (!cell || cell.dataset.day !== dragState.day) return;

  const key = cell.dataset.key;
  const [, time] = key.split('_');
  const m = timeToMin(time);
  if (m === dragState.lastMin) return;

  dragState.lastMin = m;

  // Build preview keys for the range
  const minM = Math.min(dragState.startMin, m);
  const maxM = Math.max(dragState.startMin, m);
  const previewKeys = [];
  for (let t = minM; t <= maxM; t += 30) {
    const k = dragState.day + '_' + minToTime(t);
    if (!bookedSlots[k]) previewKeys.push(k);
  }
  dragState.previewKeys = previewKeys;
  updateDragPreview();
}

function fsDragEnd(e) {
  if (!dragState) return;
  e.preventDefault();

  // Apply selection/deselection
  dragState.previewKeys.forEach(k => {
    if (dragState.selecting) selectedSlots[k] = true;
    else delete selectedSlots[k];
  });

  // Clear preview
  document.querySelectorAll('.fs-cell.fs-drag-preview').forEach(c => c.classList.remove('fs-drag-preview'));
  dragState = null;
  updateCells();
}

function updateDragPreview() {
  // Clear old previews
  document.querySelectorAll('.fs-cell.fs-drag-preview').forEach(c => c.classList.remove('fs-drag-preview'));
  if (!dragState) return;
  dragState.previewKeys.forEach(k => {
    const cell = document.querySelector(`.fs-cell[data-key="${k}"]`);
    if (cell) cell.classList.add('fs-drag-preview');
  });
}
```

- [ ] **Step 3: Add `fsToggle()` update — only fires on click (not drag)**

Update `fsToggle` to handle click vs drag. Replace inline onclick with event delegation in `renderGrid()`:

After `c.innerHTML = h;` in `renderGrid()`, add event binding:

```js
// Event delegation for cell interactions
const grid = document.getElementById('fsGrid');
if (grid && !isPast) {
  grid.addEventListener('mousedown', fsDragStart);
  document.addEventListener('mousemove', fsDragMove);
  document.addEventListener('mouseup', fsDragEnd);

  // Touch events
  grid.addEventListener('touchstart', fsDragStart, { passive: false });
  document.addEventListener('touchmove', fsDragMove, { passive: false });
  document.addEventListener('touchend', fsDragEnd);

  // Simple click fallback (for single taps on mobile)
  grid.addEventListener('click', (e) => {
    const cell = e.target.closest('.fs-cell');
    if (!cell || !cell.dataset.key) return;
    if (weekLocked) return;
    const key = cell.dataset.key;
    if (bookedSlots[key]) return;
    // Only toggle on click if no drag happened (drag handles its own)
    // Click fires after mouseup, so check if drag was a single cell
  });
}
```

Actually, simplify: the drag handlers already handle single-click (drag with 0 movement = single cell toggle via `fsDragEnd`). Remove the old `fsToggle` click handler. The `fsDragEnd` applies the preview which includes the start cell.

- [ ] **Step 4: Remove old `fsToggle()` and inline onclick from cells**

In `renderGrid()`, cells no longer have `onclick`. The grid event delegation handles everything.

Remove the old `fsToggle(key)` function — drag start/end replaces it.

- [ ] **Step 5: Disable drag on small screens**

In the event binding after `c.innerHTML = h;`:

```js
const canDrag = window.matchMedia('(min-width: 768px) and (pointer: fine)').matches;
if (grid && !isPast) {
  if (canDrag) {
    grid.addEventListener('mousedown', fsDragStart);
    document.addEventListener('mousemove', fsDragMove);
    document.addEventListener('mouseup', fsDragEnd);
    grid.addEventListener('touchstart', fsDragStart, { passive: false });
    document.addEventListener('touchmove', fsDragMove, { passive: false });
    document.addEventListener('touchend', fsDragEnd);
  } else {
    // Tap-only mode for mobile
    grid.addEventListener('click', (e) => {
      const cell = e.target.closest('.fs-cell');
      if (!cell || !cell.dataset.key || weekLocked) return;
      const key = cell.dataset.key;
      if (bookedSlots[key]) return;
      if (selectedSlots[key]) delete selectedSlots[key];
      else selectedSlots[key] = true;
      updateCells();
    });
  }
}
```

- [ ] **Step 6: Verify manually — drag vertically selects range, drag across columns stays in original column, single click toggles on mobile**

- [ ] **Step 7: Commit**

```bash
git add src/frontend/views/featured-slots.js
git commit -m "feat(featured-slots): drag-to-select with touch support and mobile fallback"
```

---

## Task 6: CSS updates — responsive, touch targets, drag preview

**Files:**
- Modify: `src/frontend/styles/components.css` (lines 598-607)

- [ ] **Step 1: Replace existing `.fs-*` styles with updated responsive styles**

Replace lines 598-607 in `components.css` with:

```css
/* Featured Slots Grid */
.fs-grid{display:grid;gap:0;min-width:500px}
.fs-row{display:grid;grid-template-columns:56px repeat(7,1fr);gap:0}
.fs-header .fs-day-col{font-size:.72rem;font-weight:700;text-align:center;padding:8px 2px;color:var(--text-3);border-bottom:2px solid var(--border);text-transform:uppercase;user-select:none}
.fs-header .fs-day-col[onclick]{cursor:pointer}
.fs-header .fs-day-col[onclick]:hover{background:var(--surface);color:var(--primary)}
.fs-time-col{font-size:.7rem;color:var(--text-4);padding:4px 6px 4px 0;text-align:right;font-variant-numeric:tabular-nums;display:flex;align-items:center;justify-content:flex-end}
.fs-cell{min-height:36px;min-width:36px;border:1px solid var(--border-light);display:flex;align-items:center;justify-content:center;cursor:pointer;transition:background .1s,border-color .1s;border-radius:0;user-select:none;-webkit-user-select:none}
.fs-cell:hover{background:var(--surface)}
.fs-cell.fs-selected{background:var(--primary-bg);border-color:var(--primary);color:var(--primary)}
.fs-cell.fs-booked{background:var(--bg-3);color:var(--text-4);cursor:not-allowed}
.fs-cell.fs-booked:hover{background:var(--bg-3)}
.fs-cell.fs-drag-preview{border:2px dashed var(--primary);background:rgba(var(--primary-rgb),.08)}
.fs-header .fs-time-col{border-bottom:2px solid var(--border)}

/* Responsive: tablet+ */
@media(max-width:768px){
  .fs-grid{min-width:400px}
  .fs-row{grid-template-columns:44px repeat(7,1fr)}
  .fs-day-col{font-size:.6rem;padding:6px 1px}
  .fs-time-col{font-size:.6rem;padding:2px 3px 2px 0}
  .fs-cell{min-height:44px;min-width:44px}
}

/* Responsive: small mobile */
@media(max-width:480px){
  .fs-grid{min-width:340px}
  .fs-row{grid-template-columns:36px repeat(7,1fr)}
  .fs-cell{min-height:44px}
}
```

- [ ] **Step 2: Verify — grid scrolls horizontally on mobile, cells are 44px touch targets, drag preview shows dashed border**

- [ ] **Step 3: Commit**

```bash
git add src/frontend/styles/components.css
git commit -m "style(featured-slots): responsive grid, touch targets, drag preview"
```

---

## Task 7: Final integration + cleanup

**Files:**
- Modify: `src/frontend/views/featured-slots.js`

- [ ] **Step 1: Clean up — remove any dead code from old fsSave/fsToggleLock**

Verify no references to `fsSave` or `fsToggleLock` remain anywhere.

- [ ] **Step 2: Update the description paragraph**

Already done in renderGrid (step 1 of task 1). Verify the text reads:
"Sélectionnez vos créneaux disponibles, puis publiez pour les rendre visibles aux clients."

- [ ] **Step 3: Full manual test cycle**

1. Load featured-slots page → grid renders
2. Click a single cell → toggles
3. Drag vertically → selects range
4. Click day header → selects entire column (skips booked)
5. Click Publier → saves + locks, badge shows "Publié"
6. Click Dépublier → unlocks, badge shows "Brouillon"
7. Modify slots → navigate away → confirmation dialog
8. Resize to mobile → tap-only works, grid scrolls
9. Booked slots → cannot be selected by any method

- [ ] **Step 4: Commit**

```bash
git add src/frontend/views/featured-slots.js
git commit -m "feat(featured-slots): cleanup and final integration"
```
