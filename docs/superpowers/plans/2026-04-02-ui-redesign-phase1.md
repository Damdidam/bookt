# UI Redesign Phase 1 — Foundations + Sidebar Restructure

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add missing CSS components (page tabs, toggle switch, badge variants), restructure the sidebar into 4 groups (Planning, Salon, Finance, Admin), add gift-cards to the sidebar, move profile to footer, and update RBAC.

**Architecture:** Extend the existing design system (variables.css + 10 CSS files) with missing component classes. Modify dashboard.html for sidebar restructure. Update state.js for RBAC and router.js for new sections. No view logic changes.

**Tech Stack:** Vanilla CSS, vanilla JS, Vite bundling. CSS imports via `src/frontend/main.js`.

---

## File Map

| Action | File | Responsibility |
|--------|------|---------------|
| Modify | `src/frontend/styles/components.css` | Add page-level tabs, toggle switch, badge variants |
| Modify | `public/dashboard.html` | Restructure sidebar groups, move profile to footer |
| Modify | `src/frontend/state.js` | Update ROLE_ACCESS to include gift-cards for owner |
| Modify | `src/frontend/router.js` | Add SECTION_TITLES entries for gift-cards, promotions label |
| Modify | `src/frontend/main.js` | Update sidebar filtering logic if needed |

---

### Task 1: Add page-level tabs CSS

Page-level tabs are needed for Settings (7 onglets). The modal tabs (`.m-tabs`, `.m-tab`) already exist but are scoped to modals. We add a reusable page-level variant.

**Files:**
- Modify: `src/frontend/styles/components.css` (append at end)

- [ ] **Step 1: Add page tabs CSS**

Append to `src/frontend/styles/components.css`:

```css
/* ===== PAGE TABS ===== */
.page-tabs{display:flex;gap:0;border-bottom:2px solid var(--border-light);margin-bottom:24px;overflow-x:auto;-webkit-overflow-scrolling:touch;scrollbar-width:none}
.page-tabs::-webkit-scrollbar{display:none}
.page-tab{padding:12px 20px;font-size:var(--text-base);font-weight:600;color:var(--text-4);cursor:pointer;border-bottom:2.5px solid transparent;transition:all .15s;white-space:nowrap;margin-bottom:-2px;background:none;border-top:none;border-left:none;border-right:none;font-family:var(--sans)}
.page-tab:hover{color:var(--text-2)}
.page-tab.active{color:var(--primary);border-bottom-color:var(--primary)}
@media(max-width:1280px){.page-tab{padding:14px 18px;min-height:44px}}
@media(max-width:600px){.page-tab{padding:12px 14px;font-size:var(--text-sm)}}
```

- [ ] **Step 2: Verify no conflicts**

Run: `grep -n 'page-tab' src/frontend/styles/*.css`
Expected: Only the lines just added in components.css.

- [ ] **Step 3: Commit**

```bash
git add src/frontend/styles/components.css
git commit -m "style: add page-level tabs component (.page-tabs, .page-tab)"
```

---

### Task 2: Add toggle switch CSS

Toggle switches are currently inline-styled in settings.js, clients.js, etc. Add a reusable class.

**Files:**
- Modify: `src/frontend/styles/components.css` (append at end)

- [ ] **Step 1: Add toggle switch CSS**

Append to `src/frontend/styles/components.css`:

```css
/* ===== TOGGLE SWITCH ===== */
.toggle{position:relative;display:inline-flex;align-items:center;cursor:pointer;gap:10px}
.toggle input{position:absolute;opacity:0;width:0;height:0}
.toggle-track{width:44px;height:24px;border-radius:var(--radius-pill);background:var(--surface-2);transition:background .2s;flex-shrink:0;position:relative}
.toggle-track::after{content:'';position:absolute;left:2px;top:2px;width:20px;height:20px;border-radius:50%;background:var(--white);transition:all .2s;box-shadow:0 1px 3px rgba(0,0,0,.15)}
.toggle input:checked+.toggle-track{background:var(--primary)}
.toggle input:checked+.toggle-track::after{left:22px}
.toggle input:focus-visible+.toggle-track{outline:2px solid var(--primary);outline-offset:2px}
.toggle-label{font-size:var(--text-base);font-weight:500;color:var(--text)}
.toggle.disabled{opacity:.5;cursor:not-allowed}
@media(max-width:1280px){.toggle-track{width:48px;height:28px}.toggle-track::after{width:24px;height:24px}.toggle input:checked+.toggle-track::after{left:22px}}
```

- [ ] **Step 2: Verify no conflicts**

Run: `grep -n '\.toggle' src/frontend/styles/*.css | head -20`
Expected: Only the new lines. If `.toggle` exists elsewhere, check it's not a name collision.

- [ ] **Step 3: Commit**

```bash
git add src/frontend/styles/components.css
git commit -m "style: add toggle switch component (.toggle, .toggle-track)"
```

---

### Task 3: Add badge variant CSS

Currently only `.badge-teal` exists in cards.css and status-specific badges (`.bk-status.confirmed`, `.c-status.regulier`, etc.) are scattered. Add semantic badge variants for reuse across all views.

**Files:**
- Modify: `src/frontend/styles/components.css` (append at end)

- [ ] **Step 1: Add badge variants CSS**

Append to `src/frontend/styles/components.css`:

```css
/* ===== BADGE VARIANTS ===== */
.badge{font-size:.68rem;font-weight:700;padding:3px 10px;border-radius:var(--radius-pill);display:inline-flex;align-items:center;gap:4px;white-space:nowrap}
.badge-success{background:var(--green-bg);color:var(--green)}
.badge-warning{background:var(--gold-bg);color:var(--gold)}
.badge-danger{background:var(--red-bg);color:var(--red)}
.badge-info{background:var(--blue-bg);color:var(--blue)}
.badge-neutral{background:var(--surface);color:var(--text-3)}
.badge-amber{background:var(--amber-bg);color:var(--amber-dark)}
.badge-purple{background:var(--purple-bg);color:var(--purple)}
```

Note: `.badge` base class already exists in cards.css (line 21). The definition here is identical (same properties) — it will be applied last due to import order and won't conflict. The variant classes are new.

- [ ] **Step 2: Verify existing badge class**

Run: `grep -n '\.badge' src/frontend/styles/cards.css`
Expected: Line 21 shows `.badge{font-size:.68rem;font-weight:700;padding:3px 10px;border-radius:var(--radius-pill)}`.
The new definition adds `display:inline-flex;align-items:center;gap:4px;white-space:nowrap` — safe additions.

- [ ] **Step 3: Commit**

```bash
git add src/frontend/styles/components.css
git commit -m "style: add semantic badge variants (success, warning, danger, info, neutral, amber, purple)"
```

---

### Task 4: Restructure sidebar HTML

Reorganize the sidebar groups in `dashboard.html`:
- **Planning:** Agenda, Clients, Liste d'attente (remove Services)
- **Salon:** Équipe, Planning, Horaires, Prestations (add Services, remove Mon site)
- **Finance:** new group with Facturation, Acomptes, Cartes cadeau, Abonnements, Promotions
- **Admin:** Statistiques, Avis clients, Mon site, Paramètres (remove profile, add Mon site)
- **Footer:** Profile link via avatar click

**Files:**
- Modify: `public/dashboard.html`

- [ ] **Step 1: Restructure the sidebar nav section**

Replace the entire `<nav class="sb-nav">...</nav>` block (lines 21-54) with:

```html
  <nav class="sb-nav">
    <a class="ni active" href="#" data-section="home"><span class="ic"><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="20" x2="12" y2="10"/><line x1="18" y1="20" x2="18" y2="4"/><line x1="6" y1="20" x2="6" y2="16"/></svg></span><span>Dashboard</span></a>
    <div class="sb-section" data-group="planning">
      <div class="sb-label" onclick="toggleSbSection(this)"><span>Planning</span><svg class="sb-chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg></div>
      <div class="sb-items">
        <a class="ni" href="#" data-section="bookings"><span class="ic"><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg></span><span>Agenda</span></a>
        <a class="ni" href="#" data-section="clients"><span class="ic"><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg></span><span id="sbClientsLabel">Clients</span></a>
        <a class="ni" href="#" data-section="waitlist"><span class="ic"><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 22h14"/><path d="M5 2h14"/><path d="M17 22v-4.172a2 2 0 0 0-.586-1.414L12 12l-4.414 4.414A2 2 0 0 0 7 17.828V22"/><path d="M7 2v4.172a2 2 0 0 0 .586 1.414L12 12l4.414-4.414A2 2 0 0 0 17 6.172V2"/></svg></span><span>Liste d'attente</span></a>
      </div>
    </div>
    <div class="sb-section" data-group="cabinet">
      <div class="sb-label" id="sbBizName" onclick="toggleSbSection(this)"><span>Salon</span><svg class="sb-chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg></div>
      <div class="sb-items">
        <a class="ni" href="#" data-section="team"><span class="ic"><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg></span><span>Équipe</span></a>
        <a class="ni" href="#" data-section="planning"><span class="ic"><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/><path d="M8 14h.01M12 14h.01M16 14h.01M8 18h.01M12 18h.01"/></svg></span><span>Planning</span></a>
        <a class="ni" href="#" data-section="hours"><span class="ic"><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg></span><span>Horaires</span></a>
        <a class="ni" href="#" data-section="services"><span class="ic"><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2"/></svg></span><span id="sbServicesLabel">Prestations</span></a>
      </div>
    </div>
    <div class="sb-section" data-group="finance">
      <div class="sb-label" onclick="toggleSbSection(this)"><span>Finance</span><svg class="sb-chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg></div>
      <div class="sb-items">
        <a class="ni" href="#" data-section="invoices"><span class="ic"><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 2v20l2-1 2 1 2-1 2 1 2-1 2 1 2-1 2 1V2l-2 1-2-1-2 1-2-1-2 1-2-1-2 1Z"/><path d="M16 8h-6a2 2 0 1 0 0 4h4a2 2 0 1 1 0 4H8"/><path d="M12 17.5v-11"/></svg></span><span>Facturation</span></a>
        <a class="ni" href="#" data-section="deposits"><span class="ic"><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 1v22M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg></span><span>Acomptes</span></a>
        <a class="ni" href="#" data-section="gift-cards"><span class="ic"><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="8" width="18" height="13" rx="2"/><path d="M12 8V21"/><path d="M3 12h18"/><path d="M12 8c-2-3-6-3-6 0s4 4 6 0"/><path d="M12 8c2-3 6-3 6 0s-4 4-6 0"/></svg></span><span>Cartes cadeau</span></a>
        <a class="ni" href="#" data-section="passes"><span class="ic"><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 9a3 3 0 0 1 0 6v2a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-2a3 3 0 0 1 0-6V7a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2Z"/><path d="M13 5v2"/><path d="M13 17v2"/><path d="M13 11v2"/></svg></span><span>Abonnements</span></a>
        <a class="ni" href="#" data-section="promotions"><span class="ic"><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/></svg></span><span>Promotions</span></a>
      </div>
    </div>
    <div class="sb-section" data-group="admin">
      <div class="sb-label" onclick="toggleSbSection(this)"><span>Admin</span><svg class="sb-chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg></div>
      <div class="sb-items">
        <a class="ni" href="#" data-section="analytics"><span class="ic"><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/></svg></span><span>Statistiques</span></a>
        <a class="ni" href="#" data-section="reviews"><span class="ic"><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg></span><span>Avis clients</span></a>
        <a class="ni" href="#" data-section="site"><span class="ic"><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg></span><span>Mon site</span></a>
        <a class="ni" href="#" data-section="settings"><span class="ic"><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg></span><span>Paramètres</span></a>
      </div>
    </div>
  </nav>
```

- [ ] **Step 2: Update sidebar footer for profile access**

Replace the `<div class="sb-foot">` block (lines 56-60) with:

```html
  <div class="sb-foot" style="cursor:pointer" onclick="document.querySelector('.ni[data-section=profile]')?.click() || (function(){document.querySelectorAll('.ni').forEach(n=>n.classList.remove('active'));document.getElementById('pageTitle').textContent='Mon profil';import('/src/frontend/views/profile.js').then(m=>m.loadProfile())})()">
    <div style="display:flex;align-items:center;gap:10px">
      <div id="userAvatar" style="width:32px;height:32px;border-radius:50%;background:var(--sidebar-active);display:flex;align-items:center;justify-content:center;font-size:.72rem;font-weight:700;flex-shrink:0"></div>
      <div>
        <div class="nm" id="userName">—</div>
        <div class="rl" id="userRole">—</div>
      </div>
    </div>
    <div class="logout" onclick="event.stopPropagation();doLogout()">Déconnexion</div>
  </div>
```

Note: We keep a hidden `data-section="profile"` anchor for practitioner role, but render it differently. The profile route is loaded programmatically from the footer click.

- [ ] **Step 3: Commit**

```bash
git add public/dashboard.html
git commit -m "feat: restructure sidebar — 4 groups (Planning, Salon, Finance, Admin), profile in footer"
```

---

### Task 5: Update router for gift-cards

The router needs a `gift-cards` case and updated section title.

**Files:**
- Modify: `src/frontend/router.js`

- [ ] **Step 1: Add gift-cards to SECTION_TITLES**

In `src/frontend/router.js`, add `'gift-cards': 'Cartes cadeau'` to the `SECTION_TITLES` object (after the `passes` entry, around line 23).

```javascript
// Add after line 23 (passes: 'Abonnements',)
  'gift-cards': 'Cartes cadeau',
```

- [ ] **Step 2: Add gift-cards case to loadSection switch**

In `src/frontend/router.js`, add this case in the switch block (after the `promotions` case, around line 137):

```javascript
      case 'gift-cards':
        mod = await import('./views/gift-cards.js');
        mod.loadGiftCards();
        break;
```

- [ ] **Step 3: Verify gift-cards view exists and exports loadGiftCards**

Run: `grep -n 'export.*function.*loadGiftCards\|export.*loadGiftCards' src/frontend/views/gift-cards.js`
Expected: A matching export. If the function name differs, adjust the router case.

- [ ] **Step 4: Commit**

```bash
git add src/frontend/router.js
git commit -m "feat: add gift-cards route to router"
```

---

### Task 6: Update RBAC for gift-cards visibility

Gift-cards is already in the owner ROLE_ACCESS array in state.js. Verify and ensure the sidebar filtering in main.js will show it.

**Files:**
- Modify: `src/frontend/state.js` (if needed)
- Modify: `src/frontend/main.js` (if needed)

- [ ] **Step 1: Verify gift-cards is in ROLE_ACCESS**

Run: `grep 'gift-cards' src/frontend/state.js`
Expected: `gift-cards` appears in the owner array. It's already there (line 41).

- [ ] **Step 2: Check sidebar filtering logic in main.js**

Run: `grep -n 'allowedSections\|data-section\|sb-section\|sb-items' src/frontend/main.js | head -20`

Verify the logic that hides sidebar items not in `allowedSections` works with the new `gift-cards` data-section attribute. The existing logic (`querySelectorAll('.ni[data-section]')`) should work since we added the `data-section="gift-cards"` attribute in dashboard.html.

- [ ] **Step 3: Add finance group to localStorage collapse key**

In `src/frontend/main.js`, find where `sb_planning`, `sb_cabinet`, `sb_admin` localStorage keys are used for collapse state. Add `sb_finance` handling.

Run: `grep -n 'sb_planning\|sb_cabinet\|sb_admin\|toggleSbSection\|collapsed' src/frontend/main.js`

If the toggle logic is generic (reads `data-group` attribute), no change needed — `data-group="finance"` will automatically use `sb_finance` as its localStorage key. If it's hardcoded, add the `finance` case.

- [ ] **Step 4: Commit (if changes were needed)**

```bash
git add src/frontend/main.js src/frontend/state.js
git commit -m "feat: ensure gift-cards and finance group work with RBAC and sidebar collapse"
```

---

### Task 7: Initialize user avatar in sidebar footer

The new footer shows a user avatar with initials. Update main.js to populate it.

**Files:**
- Modify: `src/frontend/main.js`

- [ ] **Step 1: Find where userName is set**

Run: `grep -n 'userName\|userRole\|sb-foot' src/frontend/main.js`

Find the code that sets `document.getElementById('userName').textContent` and add avatar initialization nearby.

- [ ] **Step 2: Add avatar initialization**

After the line that sets userName, add:

```javascript
// Initialize sidebar avatar
const avatarEl = document.getElementById('userAvatar');
if (avatarEl && user) {
  const name = user.display_name || user.email || '';
  const initials = name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);
  avatarEl.textContent = initials;
}
```

- [ ] **Step 3: Commit**

```bash
git add src/frontend/main.js
git commit -m "feat: populate user avatar initials in sidebar footer"
```

---

### Task 8: Build and verify

**Files:** None (verification only)

- [ ] **Step 1: Run Vite build**

Run: `cd /Users/Hakim/Desktop/bookt && npm run build`
Expected: Build succeeds with no errors.

- [ ] **Step 2: Force-add dist**

Run: `git add -f dist/`

- [ ] **Step 3: Final commit**

```bash
git commit -m "build: rebuild dist after sidebar restructure and CSS additions"
```

- [ ] **Step 4: Verify sidebar structure in browser**

Open the dashboard locally and verify:
- 4 sidebar groups visible (Planning, Salon, Finance, Admin)
- Cartes cadeau appears in Finance group
- Prestations appears in Salon group
- Mon site appears in Admin group
- Profile link is gone from Admin, avatar+name in footer works
- Clicking avatar loads profile view
- Collapsing/expanding groups works and persists
- Practitioner role sees only: Dashboard, Agenda, Clients + footer avatar
