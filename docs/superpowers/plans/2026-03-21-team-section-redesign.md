# Team Section Redesign — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign team member cards (simplified) and edit modal (harmonized with calendar modals) to fix UX/UI issues and prevent accidental modal closure.

**Architecture:** Refactor `team.js` in-place: rewrite card rendering function and modal rendering function. Add imports for existing utilities (trapFocus, enableSwipeClose, showConfirmDialog, initTimeInputs). Restyle via CSS. No new files needed — all utilities exist.

**Tech Stack:** Vanilla JS, existing modal design system (m-overlay, m-dialog, m-header), CSS in modal.css/components.css.

**Spec:** `docs/superpowers/specs/2026-03-21-team-section-redesign.md`

---

### Task 1: Redesign member cards

**Files:**
- Modify: `src/frontend/views/team.js` (lines 95-182 — loadTeam card rendering)
- Modify: `src/frontend/styles/components.css` (team card CSS)

- [ ] **Step 1: Read current card rendering**

Read `src/frontend/views/team.js` lines 95-185 to understand the current card HTML structure and data available (name, title, photo_url, color, work_days, bookings_30d, contract_type, is_active, hire_date, service_count, has_login, booking_enabled, vacation, waitlist_mode, cal_sync).

- [ ] **Step 2: Rewrite card HTML in loadTeam()**

Replace the card rendering inside `practs.forEach(p => { ... })` with simplified cards:

```javascript
const initials = p.display_name?.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2) || '??';
const regime = computeRegime(p.work_days);
const isInactive = !p.is_active;

h += `<div class="tm-card${isInactive ? ' inactive' : ''}" onclick="openPractModal('${p.id}')">`;

// Avatar
if (p.photo_url) {
  h += `<div class="tm-avatar"><img src="${esc(p.photo_url)}" alt="${esc(p.display_name)}" loading="lazy"></div>`;
} else {
  h += `<div class="tm-avatar" style="background:linear-gradient(135deg,${esc(p.color || '#0D7377')},${esc(p.color || '#0D7377')}CC)">${initials}</div>`;
}

// Info
h += `<div class="tm-info">`;
h += `<p class="tm-name">${esc(p.display_name)}${isInactive ? ' <span class="tm-badge-inactive">Inactif</span>' : ''}</p>`;
h += `<p class="tm-title">${esc(p.title || '')}</p>`;
if (regime.label !== '—') h += `<p class="tm-regime">${regime.label}${regime.detail ? ' · ' + regime.detail : ''}</p>`;

// Summary line
const parts = [];
if (p.bookings_30d != null) parts.push(p.bookings_30d + ' RDV/mois');
if (p.contract_type && CONTRACT_LABELS[p.contract_type]) parts.push(CONTRACT_LABELS[p.contract_type]);
if (parts.length) h += `<p class="tm-summary">${parts.join(' · ')}</p>`;

h += `</div>`; // end tm-info
h += `</div>`; // end tm-card
```

The entire card is clickable (`onclick="openPractModal('${p.id}')"`) — no separate "Modifier" button needed. The card IS the button.

- [ ] **Step 3: Update the "+ Ajouter" card**

Replace the current button with a card-style add button:

```javascript
h += `<div class="tm-card tm-add" onclick="openPractModal()">
  <div class="tm-avatar tm-add-icon"><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg></div>
  <div class="tm-info"><p class="tm-name">Ajouter un ${esc(pracLabel)}</p></div>
</div>`;
```

- [ ] **Step 4: Replace team card CSS in components.css**

Find and replace the existing `.team-grid2`, `.team-member`, `.tm-header`, `.tm-stats`, `.tm-badges`, `.tm-actions` styles with the new simplified card styles:

```css
/* ── Team cards ── */
.team-grid2{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:16px}
.tm-card{display:flex;align-items:center;gap:16px;padding:16px 20px;background:var(--white);border:1px solid var(--border-light);border-radius:var(--radius);cursor:pointer;transition:all .15s}
.tm-card:hover{border-color:var(--primary-soft);box-shadow:var(--shadow)}
.tm-card.inactive{opacity:.5}
.tm-card.tm-add{border-style:dashed;justify-content:center}
.tm-card.tm-add:hover{border-color:var(--primary);background:var(--primary-light)}
.tm-avatar{width:64px;height:64px;border-radius:var(--radius);display:flex;align-items:center;justify-content:center;color:#fff;font-size:1.1rem;font-weight:700;flex-shrink:0;overflow:hidden}
.tm-avatar img{width:100%;height:100%;object-fit:cover}
.tm-add-icon{background:var(--surface);color:var(--text-4)}
.tm-add-icon svg{width:24px;height:24px}
.tm-info{min-width:0;flex:1}
.tm-name{font-size:.92rem;font-weight:600;color:var(--text);margin-bottom:2px;display:flex;align-items:center;gap:8px}
.tm-title{font-size:.78rem;color:var(--text-3);margin-bottom:4px}
.tm-regime{font-size:.72rem;color:var(--text-4);margin-bottom:4px}
.tm-summary{font-size:.72rem;color:var(--text-4)}
.tm-badge-inactive{font-size:.62rem;font-weight:700;background:var(--red-bg);color:var(--red);padding:2px 8px;border-radius:100px}
```

Remove old `.team-member`, `.tm-header`, `.tm-stats`, `.tm-stat`, `.tm-badges`, `.tm-badge`, `.tm-actions`, `.tm-work-dots`, `.tm-work-dot` classes. Keep other team-related classes that are still used (like schedule editor classes).

- [ ] **Step 5: Add responsive rules**

In `responsive.css`, inside the `@media(max-width:1280px)` block, add:

```css
.tm-card{min-height:80px}
```

Add a new block or extend existing:

```css
@media(max-width:600px){
  .team-grid2{grid-template-columns:1fr}
  .tm-card{padding:14px 16px}
}
```

- [ ] **Step 6: Commit**

```bash
git add src/frontend/views/team.js src/frontend/styles/components.css src/frontend/styles/responsive.css
git commit -m "feat: redesign team cards — simplified layout, clickable cards, responsive grid"
```

---

### Task 2: Harmonize edit modal header

**Files:**
- Modify: `src/frontend/views/team.js` (lines 206-260 — modal header rendering in openPractModal)

- [ ] **Step 1: Read current modal header code**

Read `src/frontend/views/team.js` lines 206-260 to understand the current header structure.

- [ ] **Step 2: Rewrite modal header**

Replace the header HTML generation with the harmonized pattern. The modal should use:

```javascript
// Header with gradient (like calendar modals)
const accentColor = p?.color || '#0D7377';
const initials = p?.display_name?.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2) || '??';
const photoHtml = p?.photo_url
  ? `<img src="${esc(p.photo_url)}" alt="${esc(p.display_name)}" style="width:100%;height:100%;object-fit:cover">`
  : initials;

// Modal HTML
const html = `<div class="m-overlay" id="teamModalOverlay">
  <div class="m-dialog m-flex m-lg">
    <div class="m-drag-handle"></div>
    <div class="m-header">
      <div class="m-header-bg" id="tmHeaderBg" style="background:linear-gradient(135deg,${accentColor} 0%,${accentColor}AA 60%,${accentColor}55 100%)"></div>
      <button class="m-close" onclick="closeTeamModal()" aria-label="Fermer">
        <svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      </button>
      <div class="m-header-content">
        <div class="m-client-hero" style="align-items:center">
          <div class="m-avatar" id="tmAvatar" style="background:linear-gradient(135deg,${accentColor},${accentColor}CC);cursor:pointer" onclick="document.getElementById('pPhotoInput').click()">
            ${photoHtml}
          </div>
          <div class="m-modal-title">${esc(p?.display_name || 'Nouveau ' + sectorLabels.practitioner)}</div>
        </div>
      </div>
    </div>
    ... tabs, body, bottom bar (keep existing)
  </div>
</div>`;
```

- [ ] **Step 3: Remove hardcoded height:85vh**

Find the inline `style="height:85vh"` on the `.m-dialog` and remove it. The CSS `max-height:90vh` from modal.css handles this.

- [ ] **Step 4: Update gradient when color changes**

Add a color change listener (like calendar modals):

```javascript
// After modal is rendered:
const colorInput = document.getElementById('p_color'); // hidden input from cswHTML
if (colorInput) {
  colorInput.addEventListener('change', () => {
    const c = colorInput.value || '#0D7377';
    document.getElementById('tmHeaderBg').style.background = `linear-gradient(135deg,${c} 0%,${c}AA 60%,${c}55 100%)`;
    document.getElementById('tmAvatar').style.background = `linear-gradient(135deg,${c},${c}CC)`;
  });
}
```

- [ ] **Step 5: Commit**

```bash
git add src/frontend/views/team.js
git commit -m "feat: harmonize team modal header — gradient, avatar, m-close, no hardcoded height"
```

---

### Task 3: Add modal protection (focus trap, noBackdropClose, swipe-close)

**Files:**
- Modify: `src/frontend/views/team.js` (imports + modal open/close functions)

- [ ] **Step 1: Add imports**

At the top of `team.js`, add to existing imports:

```javascript
import { trapFocus, releaseFocus } from '../utils/focus-trap.js';
import { enableSwipeClose } from '../utils/swipe-close.js';
import { showConfirmDialog } from '../utils/dirty-guard.js';
import { initTimeInputs } from '../utils/dom.js';
```

Note: `guardModal` is already imported. `showConfirmDialog` may already be importable from dirty-guard.js — check the existing import line.

- [ ] **Step 2: Update guardModal call to use noBackdropClose**

Find the `guardModal()` call in openPractModal (around line 388). Change to:

```javascript
guardModal(document.getElementById('teamModalOverlay'), { noBackdropClose: true });
```

- [ ] **Step 3: Add trapFocus after modal render**

After the modal HTML is inserted and displayed:

```javascript
const modal = document.getElementById('teamModalOverlay');
modal.classList.add('open');
trapFocus(modal, () => closeTeamModal());
enableSwipeClose(modal.querySelector('.m-dialog'), () => closeTeamModal());
```

- [ ] **Step 4: Update closeTeamModal to release focus**

Find `closeTeamModal()` function. Add `releaseFocus()` before removing the modal:

```javascript
function closeTeamModal() {
  const modal = document.getElementById('teamModalOverlay');
  if (!modal) return;
  // dirty-guard check is handled by closeModal() from dirty-guard.js
  releaseFocus();
  modal._dirtyGuard?.destroy();
  modal.remove();
  document.body.classList.remove('has-modal');
}
```

Or if it uses `closeModal('teamModalOverlay')` from dirty-guard.js, add `releaseFocus()` inside that flow.

- [ ] **Step 5: Add initTimeInputs after schedule tab renders**

In the schedule editor rendering function (renderScheduleEditor or wherever slot time inputs are created), call `initTimeInputs(container)` after the HTML is inserted. Also change any `type="time"` to `type="text" class="m-input m-time"` in the slot modal.

- [ ] **Step 6: Apply same protection to sub-modals (tasks, invite, role)**

For each sub-modal (tasksModalOverlay, inviteModalOverlay, roleModalOverlay):
- Add `{ noBackdropClose: true }` to guardModal call
- Add trapFocus/releaseFocus
- No swipe-close needed on these small modals

- [ ] **Step 7: Commit**

```bash
git add src/frontend/views/team.js
git commit -m "feat: team modal protection — focus trap, noBackdropClose, swipe-close, time inputs"
```

---

### Task 4: Add loading states and confirmDialog for destructive actions

**Files:**
- Modify: `src/frontend/views/team.js` (save function, deactivate function, photo delete)

- [ ] **Step 1: Add loading state to save button**

In `savePract()` function (around line 675), add loading class to save button:

```javascript
const saveBtn = document.querySelector('#teamModalOverlay .m-bottom .btn-primary');
if (saveBtn) { saveBtn.disabled = true; saveBtn.classList.add('is-loading'); }
try {
  // ... existing save logic ...
} finally {
  if (saveBtn) { saveBtn.classList.remove('is-loading'); saveBtn.disabled = false; }
}
```

- [ ] **Step 2: Replace confirm() with showConfirmDialog for deactivation**

Find the deactivate function (around line 795). Replace any `confirm()` or `GendaUI.confirm()` with:

```javascript
const confirmed = await showConfirmDialog(
  'Désactiver ' + sectorLabels.practitioner,
  'Désactiver ce praticien ? Ses RDV futurs seront annulés.',
  'Désactiver',
  'danger'
);
if (!confirmed) return;
```

- [ ] **Step 3: Replace confirm() with showConfirmDialog for photo delete**

In `pRemovePhoto()` (around line 780):

```javascript
const confirmed = await showConfirmDialog(
  'Supprimer la photo',
  'Supprimer la photo de profil ?',
  'Supprimer',
  'danger'
);
if (!confirmed) return;
```

- [ ] **Step 4: Replace any remaining confirm() calls**

Search for `confirm(` in team.js and replace ALL with `showConfirmDialog()`. These may include:
- Reactivate practitioner
- Delete schedule slots
- Any other destructive action

Make sure all calling functions are `async` (add `async` keyword if needed).

- [ ] **Step 5: Commit**

```bash
git add src/frontend/views/team.js
git commit -m "feat: team modal — loading states on save, showConfirmDialog for all destructive actions"
```

---

### Task 5: Schedule editor — time input fix + validation

**Files:**
- Modify: `src/frontend/views/team.js` (slot modal rendering + validation)

- [ ] **Step 1: Fix time inputs in slot modal**

Find where the slot add/edit modal is rendered (teamAddSlot, teamEditSlot — around lines 567-616). Replace `type="time"` inputs with `type="text" class="m-input m-time"`:

```javascript
<input type="text" class="m-input m-time" id="slotStart" value="${startVal}">
<input type="text" class="m-input m-time" id="slotEnd" value="${endVal}">
```

After the modal HTML is inserted, call:
```javascript
initTimeInputs(document.getElementById('teamSlotModal'));
```

- [ ] **Step 2: Add time validation**

In `teamConfirmAddSlot()` and the edit equivalent, add validation before accepting the slot:

```javascript
const start = document.getElementById('slotStart').value;
const end = document.getElementById('slotEnd').value;
if (!start || !end) { gToast('Heures requises', 'error'); return; }
if (start >= end) { gToast('L\'heure de fin doit être après le début', 'error'); return; }

// Check overlap with existing slots for this day
const existing = teamEditSchedule[day] || [];
const hasOverlap = existing.some(s => {
  if (editIndex !== undefined && existing.indexOf(s) === editIndex) return false;
  return start < s.end_time && end > s.start_time;
});
if (hasOverlap) { gToast('Ce créneau chevauche un autre', 'error'); return; }
```

- [ ] **Step 3: Commit**

```bash
git add src/frontend/views/team.js
git commit -m "feat: schedule editor — digit time inputs, overlap validation"
```

---

### Task 6: Visual polish and testing

**Files:**
- Modify: `src/frontend/styles/modal.css` (m-lg responsive rule)
- All modified files for testing

- [ ] **Step 1: Add m-lg responsive rule**

In `modal.css`, add inside the `@media(max-width:1280px)` block:

```css
.m-dialog.m-lg{max-width:min(680px,90vw)}
```

This ensures the team modal (`.m-lg`) respects tablet width.

- [ ] **Step 2: Verify desktop**

Open team section at >1280px:
- Cards display in 3+ columns
- Click card → modal opens with gradient header
- Close button is round with blur
- Save shows loading spinner
- Deactivate shows confirm dialog
- Click outside does NOT close modal
- Escape triggers dirty-guard if unsaved changes
- Color change updates gradient live

- [ ] **Step 3: Verify tablet (≤1280px)**

Resize to 1280px or tablet:
- Cards in 2-3 columns
- Modal at min(680px, 90vw)
- Touch targets 44px (close, tabs, buttons)
- Tabs scrollable if needed

- [ ] **Step 4: Verify mobile (≤680px)**

Resize to 680px or smaller:
- Cards in 1 column
- Modal full-screen
- Drag handle visible
- Swipe-to-close works (with dirty-guard)
- Bottom bar sticky

- [ ] **Step 5: Commit if polish needed**

```bash
git add -A
git commit -m "fix: team section visual polish"
```
