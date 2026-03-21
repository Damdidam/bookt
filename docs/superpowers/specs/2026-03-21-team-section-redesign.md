# Team Section Redesign — Cards + Edit Modal

## Context

The Team section of the Bookt dashboard is used by salon owners/managers to manage their practitioners (hairdressers, aestheticians). The current implementation has UX/UI problems: overloaded cards, inconsistent modal design (not aligned with the harmonized calendar modals), missing accessibility features, accidental modal closure, and poor responsive behavior.

**Target users:** Salon owners/managers, non-technical, often on tablet.

**Goal:** Redesign the team member cards and the practitioner edit modal to match the harmonized design system established for calendar modals (gradient headers, focus trap, dirty-guard, loading states, touch targets, responsive behavior).

## Current State

- **Cards:** 300px grid, overloaded with 7 work dots, 4 stat blocks, 8 badges, 4 action buttons per card
- **Modal:** Uses `.m-overlay`/`.m-dialog` but missing focus trap, swipe-to-close, has hardcoded `height:85vh`, no loading states, no `noBackdropClose`, closes accidentally on outside click or delete actions
- **File:** `src/frontend/views/team.js` (1,213 lines)
- **CSS:** Spread across `modal.css` and `components.css`

## Design

### 1. Member Cards

**Simplified layout:**
- Avatar: 64px, rounded 14px, photo or initials on practitioner color gradient
- Name: bold, font-size 15px
- Title/specialty: secondary text, 13px
- Regime: simplified "Lun-Ven" text with dot indicator (replaces 7 individual dots)
- Summary line: compact text with key info (bookings/month, contract type, status)
- Single "Modifier" button per card (secondary actions moved to modal)
- Inactive practitioners: card at 50% opacity with "Inactif" badge overlay

**Grid responsive:**
- Desktop (>1280px): `repeat(auto-fill, minmax(280px, 1fr))` — typically 3-4 columns
- Tablet (≤1280px): 2-3 columns, touch targets 44px on button
- Mobile (≤600px): 1 column, "Modifier" button full-width

**CSS classes:**
- `.tm-card` — card container (replaces `.team-member`)
- `.tm-avatar` — 64px avatar with photo or gradient+initials
- `.tm-name` — practitioner name
- `.tm-title` — title/specialty
- `.tm-regime` — regime indicator
- `.tm-summary` — compact stats line
- `.tm-btn` — edit button
- `.tm-card.inactive` — reduced opacity state

**"+ Ajouter" button:**
- Styled as a card with dashed border and "+" icon
- Same height as member cards
- Touch target: entire card is clickable

### 2. Edit Modal — Header

Identical to calendar modal headers:

- `.m-header` with `.m-header-bg` gradient (practitioner color, 135deg pattern)
- `.m-close` round button with blur (28px desktop, 44px tablet/mobile)
- `.m-header-content` with `.m-client-hero` (align-items: center)
- `.m-avatar` 52px with photo or initials
- `.m-modal-title` (sans-serif, `var(--text-2xl)`, `var(--text)` color)
- Dynamic gradient update when practitioner color changes in the form

**Photo on avatar:**
- Click avatar → file picker opens (existing behavior, kept)
- Small camera icon overlay on hover
- "Supprimer la photo" link below avatar (if photo exists)

### 3. Edit Modal — Structure

**Modal classes:** `.m-overlay` + `.m-dialog.m-flex.m-lg`
- `max-width: 680px` (desktop)
- `max-width: min(680px, 90vw)` at ≤1280px (tablet)
- Full screen at ≤680px (mobile) — existing behavior
- NO hardcoded `height:85vh` — use CSS `max-height:90vh` only
- `.m-drag-handle` visible on mobile

**Tabs:** `.m-tabs` with 5 tabs
- Profil, Compétences, Horaire, Congés (edit only), Paramètres
- Horizontally scrollable on mobile (`overflow-x: auto`, `-webkit-overflow-scrolling: touch`)
- Each tab: `min-height:44px` touch target
- Active tab: bottom border accent color

**Body:** `.m-body` scrollable
- Only active tab panel rendered (`.m-panel.active`)
- All form fields use `.m-field-label` + `.m-input` pattern
- Sections use `.m-sec` with `.m-sec-head` headers

**Bottom bar:** `.m-bottom` sticky
- "Annuler" button (secondary) + "Enregistrer" / "Créer" button (primary)
- Sticky on mobile above keyboard (`position:sticky; bottom:0`)
- Loading state (`.is-loading`) on save button during API call

### 4. Edit Modal — Protection Against Accidental Closure

**CRITICAL — these rules prevent data loss:**

- `guardModal(overlay, { noBackdropClose: true })` — clicking outside does NOT close
- Only the ✕ button closes the modal
- ✕ button checks dirty-guard: if unsaved changes → `showDirtyPrompt()` ("Rester" / "Quitter")
- `trapFocus(modal, onClose)` — Tab cycles within modal, Escape triggers close (with dirty-guard)
- `enableSwipeClose(dialog, onClose)` — mobile swipe down triggers close (with dirty-guard)

**Destructive actions (in Paramètres tab):**
- "Désactiver le praticien" button → `showConfirmDialog(title, msg, label, 'danger')` → API call → toast → close modal → refresh list
- Never closes the modal silently or without confirmation
- "Supprimer la photo" → `showConfirmDialog()` → API DELETE → refresh avatar

### 5. Edit Modal — Form Fields (Profil Tab)

All fields use harmonized patterns:

```
Nom*                    [input.m-input]
Titre / Spécialité      [input.m-input]
Années d'expérience     [input.m-input type=number]
Couleur                 [color swatches - cswHTML()]

── Contact ──
Email                   [input.m-input type=email]
Téléphone               [input.m-input]
Bio                     [textarea.m-input rows=3]
LinkedIn                [input.m-input placeholder="https://..."]

── Contrat ──
Type de contrat         [select.m-input]
Date d'embauche         [input.m-input type=date]
Heures/semaine          [input.m-input type=number step=0.5]

── Urgence ──
Contact d'urgence       [input.m-input]
Tél. urgence            [input.m-input]

── Notes ──
Notes internes          [textarea.m-input rows=2]
Réservation en ligne    [checkbox] Activé
```

### 6. Edit Modal — Schedule Tab (Horaire)

- 7 day rows, each showing time slot chips
- Chips: `.slot-chip` with start–end time, edit (pencil) + delete (×) icons
- "Ajouter un créneau" button per day (dashed style)
- Add/Edit slot opens a sub-modal (`.m-dialog.m-sm`, 400px)
- Sub-modal time inputs: `.m-time` (digit-based, no Android clock picker)
- Validation: end time must be after start time, no overlaps within same day
- Sub-modal: `guardModal()` for dirty protection

### 7. Edit Modal — Other Tabs

**Compétences tab:**
- Service checkboxes grouped by category
- Each checkbox: proper `<label>` wrapping, no `tabindex="-1"`
- "Tout sélectionner / Tout désélectionner" toggle with count feedback

**Congés tab (edit only):**
- Leave balance table responsive: stacked layout on mobile (label above input)
- Number inputs with min=0, step=0.5
- Color-coded balance (green=ok, orange=low, red=negative)

**Paramètres tab:**
- Max concurrent bookings (select 1-10)
- Online booking toggle
- Calendar sync status
- "Désactiver le praticien" danger button (at bottom, separated by spacer)

### 8. Loading & Feedback

- **Save button:** `.is-loading` class during API call (spinner + disabled)
- **Photo upload:** Loading indicator on avatar during upload
- **Schedule save:** Loading state on confirm button
- **Delete/deactivate:** `showConfirmDialog()` → loading on confirm button
- **Errors:** `gToast(message, 'error')` for API errors
- **Success:** `gToast('Praticien mis à jour', 'success')` after save
- **Field validation:** Required field (name) validated before API call, inline error style

## Files to Modify

### JS
- `src/frontend/views/team.js` — Main refactor: cards HTML, modal HTML, add focus trap + swipe close + loading states + noBackdropClose + time inputs
- No new files needed — all utilities exist (focus-trap.js, swipe-close.js, dirty-guard.js, dom.js)

### CSS
- `src/frontend/styles/modal.css` — Add `.m-lg` responsive rule for tablet, ensure `.tm-*` card classes are defined
- `src/frontend/styles/components.css` — Refactor team card CSS (`.tm-card`, `.tm-avatar`, etc.)
- `src/frontend/styles/responsive.css` — Team grid responsive rules if needed

### HTML
- `public/dashboard.html` — No changes (team section is fully dynamic)

## Constraints

- All existing team functionality must keep working (CRUD practitioners, schedule, services, leave, photo, roles)
- Use existing shared utilities: `trapFocus/releaseFocus`, `enableSwipeClose`, `guardModal/showDirtyPrompt`, `showConfirmDialog`, `gToast`, `withLoading`, `initTimeInputs`, `cswHTML`
- Modal must never close on outside click (`noBackdropClose: true`)
- Destructive actions always go through `showConfirmDialog()`
- Desktop (>1280px) must not regress
- Follow existing code patterns in team.js (dynamic modal creation via insertAdjacentHTML)
