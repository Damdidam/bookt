# Plan Gating (Free vs Pro) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Gate Pro-only features so Free plan users see them locked with upgrade CTAs, while Pro users get full access.

**Architecture:** A centralized `requirePro` backend middleware returns 403 `upgrade_required`. A shared frontend `plan-gate.js` utility renders lock overlays and Pro badges. Sidebar nav items show "Pro" badges. Each gated view checks plan on load.

**Tech Stack:** Express middleware, vanilla JS frontend, existing `req.businessPlan` from auth middleware, `window._businessPlan` from state.js.

---

### Task 1: Backend — `requirePro` middleware

**Files:**
- Modify: `src/middleware/auth.js`

- [ ] **Step 1: Add requirePro function**

After the existing `requireSuperadmin` function (around line 117), add:

```js
/**
 * Require Pro plan (gated features)
 */
function requirePro(req, res, next) {
  if (req.businessPlan === 'free') {
    return res.status(403).json({
      error: 'upgrade_required',
      message: 'Cette fonctionnalité est disponible avec le plan Pro.'
    });
  }
  next();
}
```

- [ ] **Step 2: Export it**

Update the `module.exports` line to include `requirePro`:

```js
module.exports = { requireAuth, requireOwner, requireRole, resolvePractitionerScope, requireSuperadmin, requirePro };
```

- [ ] **Step 3: Verify syntax**

Run: `node -e "const m = require('./src/middleware/auth.js'); console.log('requirePro:', typeof m.requirePro)"`
Expected: `requirePro: function`

- [ ] **Step 4: Commit**

```bash
git add src/middleware/auth.js
git commit -m "feat(gating): add requirePro middleware"
```

---

### Task 2: Backend — Apply guards to fully-gated routers

**Files:**
- Modify: `src/routes/staff/invoices.js`
- Modify: `src/routes/staff/waitlist.js`
- Modify: `src/routes/staff/calendar.js`

These routers are entirely Pro-only. Add `requirePro` at the top of each.

- [ ] **Step 1: Guard invoices.js**

At the top of `src/routes/staff/invoices.js`, after the existing requires and before the first route, add:

```js
const { requirePro } = require('../../middleware/auth');
router.use(requirePro);
```

- [ ] **Step 2: Guard waitlist.js (staff)**

At the top of `src/routes/staff/waitlist.js`, after existing requires, add:

```js
const { requirePro } = require('../../middleware/auth');
router.use(requirePro);
```

- [ ] **Step 3: Guard calendar.js**

At the top of `src/routes/staff/calendar.js`, after existing requires, add:

```js
const { requirePro } = require('../../middleware/auth');
router.use(requirePro);
```

- [ ] **Step 4: Verify all three load**

Run: `node -e "require('./src/routes/staff/invoices.js'); require('./src/routes/staff/waitlist.js'); require('./src/routes/staff/calendar.js'); console.log('OK')"`
Expected: `OK`

- [ ] **Step 5: Commit**

```bash
git add src/routes/staff/invoices.js src/routes/staff/waitlist.js src/routes/staff/calendar.js
git commit -m "feat(gating): guard invoices, waitlist, calendar routes as Pro-only"
```

---

### Task 3: Backend — Apply guards to partially-gated routers

**Files:**
- Modify: `src/routes/staff/deposits.js`
- Modify: `src/routes/staff/promotions.js`
- Modify: `src/routes/staff/settings.js`
- Modify: `src/routes/staff/site.js`
- Modify: `src/routes/public/gift-cards-passes.js`
- Modify: `src/routes/public/deposit.js`
- Modify: `src/routes/public/waitlist.js`

- [ ] **Step 1: Guard deposits.js**

Add at top: `const { requirePro } = require('../../middleware/auth');`

Then add `requirePro` middleware to the deposit management routes. Find the router definition and add `router.use(requirePro);` — the entire deposits management is Pro-only.

- [ ] **Step 2: Guard promotions.js — count-based**

Add at top: `const { requirePro } = require('../../middleware/auth');`

In the POST route (create promo), BEFORE the existing validation, add:

```js
// Plan guard: free plan limited to 1 active promotion
if (req.businessPlan === 'free') {
  const countRes = await queryWithRLS(req.businessId,
    `SELECT COUNT(*)::int AS cnt FROM promotions WHERE business_id = $1 AND is_active = true`,
    [req.businessId]
  );
  if (countRes.rows[0].cnt >= 1) {
    return res.status(403).json({
      error: 'upgrade_required',
      message: 'Le plan gratuit est limité à 1 promotion active. Passez au Pro pour des promotions illimitées.'
    });
  }
}
```

- [ ] **Step 3: Guard settings.js — LM + deposit toggles**

In the PATCH settings route, find where `last_minute_enabled` is saved. Add before the UPDATE:

```js
// Plan guard: LM auto-discount is Pro-only
if (req.businessPlan === 'free' && req.body.last_minute_enabled === true) {
  return res.status(403).json({ error: 'upgrade_required', message: 'Les promotions last-minute sont disponibles avec le plan Pro.' });
}
// Plan guard: deposit settings are Pro-only
if (req.businessPlan === 'free' && (req.body.deposit_enabled === true || req.body.deposit_pct !== undefined)) {
  return res.status(403).json({ error: 'upgrade_required', message: 'Les acomptes sont disponibles avec le plan Pro.' });
}
```

- [ ] **Step 4: Guard site.js — custom domain**

Find the custom domain save endpoint. Add:

```js
if (req.businessPlan === 'free' && req.body.custom_domain) {
  return res.status(403).json({ error: 'upgrade_required', message: 'Le domaine personnalisé est disponible avec le plan Pro.' });
}
```

- [ ] **Step 5: Guard gift-cards-passes.js (public)**

The GC and pass checkout endpoints need to check the business plan. In both the GC checkout POST and the pass checkout POST, after fetching the business, add:

```js
if (biz.plan === 'free') {
  return res.status(403).json({ error: 'upgrade_required', message: 'Les cartes cadeau sont disponibles avec le plan Pro.' });
}
```

Same for pass checkout:

```js
if (biz.plan === 'free') {
  return res.status(403).json({ error: 'upgrade_required', message: 'Les abonnements sont disponibles avec le plan Pro.' });
}
```

- [ ] **Step 6: Guard deposit.js (public)**

In the deposit payment page endpoint (GET), after fetching the booking+business, add:

```js
if (bk.business_plan === 'free') {
  return res.status(403).json({ error: 'upgrade_required' });
}
```

Note: Check the exact variable name — the business plan might be on `biz.plan` or joined from the query.

- [ ] **Step 7: Guard waitlist.js (public)**

In the public waitlist signup POST, after fetching the business, add:

```js
if (biz.plan === 'free') {
  return res.status(403).json({ error: 'upgrade_required', message: 'La liste d\'attente est disponible avec le plan Pro.' });
}
```

- [ ] **Step 8: Guard public/index.js — deposit skip for free**

In `src/routes/public/index.js`, in the `shouldRequireDeposit` call or the deposit check section (around line 147+), add plan check so free businesses never trigger deposit:

Find the deposit check sections (there are two — multi-service around line 549 and single around line 1144). In both, wrap the deposit logic with:

```js
if (businessPlan !== 'free') {
  // ... existing deposit logic ...
}
```

- [ ] **Step 9: Verify all files load**

Run:
```bash
node -e "
['src/routes/staff/deposits.js','src/routes/staff/promotions.js','src/routes/staff/settings.js','src/routes/staff/site.js','src/routes/public/gift-cards-passes.js','src/routes/public/deposit.js','src/routes/public/waitlist.js','src/routes/public/index.js'].forEach(f => { require('./'+f); console.log('OK:', f); });
"
```

- [ ] **Step 10: Commit**

```bash
git add src/routes/staff/deposits.js src/routes/staff/promotions.js src/routes/staff/settings.js src/routes/staff/site.js src/routes/public/gift-cards-passes.js src/routes/public/deposit.js src/routes/public/waitlist.js src/routes/public/index.js
git commit -m "feat(gating): add Pro guards to deposits, promos, GC, passes, waitlist, calendar sync, domain"
```

---

### Task 4: Frontend — Plan gate utility

**Files:**
- Create: `src/frontend/utils/plan-gate.js`

- [ ] **Step 1: Create the utility**

```js
/**
 * Plan Gating Utility — shows Pro badges and lock overlays for Free users.
 */

const PRO_FEATURES = ['invoices', 'deposits', 'waitlist', 'cal-sync', 'gift-cards', 'passes', 'analytics'];

export function isPro() {
  return window._businessPlan && window._businessPlan !== 'free';
}

export function isProFeature(section) {
  return PRO_FEATURES.includes(section);
}

/**
 * Returns a small "Pro" badge HTML for sidebar nav items.
 */
export function proBadge() {
  return '<span style="font-size:.55rem;font-weight:700;background:var(--primary);color:#fff;padding:1px 5px;border-radius:8px;margin-left:6px;vertical-align:1px">PRO</span>';
}

/**
 * Renders a full-page lock overlay inside a container.
 * @param {HTMLElement} container — the contentArea element
 * @param {string} featureName — human-readable feature name
 */
export function showProGate(container, featureName) {
  container.innerHTML = `
    <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;padding:80px 24px;text-align:center">
      <div style="width:64px;height:64px;border-radius:50%;background:var(--surface);display:flex;align-items:center;justify-content:center;margin-bottom:20px">
        <svg style="width:28px;height:28px;color:var(--text-4)" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
      </div>
      <h3 style="font-size:1.1rem;font-weight:600;margin-bottom:8px">${featureName}</h3>
      <p style="font-size:.88rem;color:var(--text-3);max-width:360px;margin-bottom:20px">Cette fonctionnalité est disponible avec le plan Pro. Débloquez l'accès pour faire passer votre salon au niveau supérieur.</p>
      <button class="btn-primary" onclick="window.location.hash='settings'" style="padding:10px 24px;font-size:.88rem">Passer au Pro</button>
    </div>`;
}

/**
 * Renders an inline lock message for disabled toggles/fields.
 */
export function proInlineHint() {
  return '<span style="font-size:.72rem;color:var(--primary);font-weight:500;margin-left:8px">Plan Pro requis</span>';
}
```

- [ ] **Step 2: Commit**

```bash
git add src/frontend/utils/plan-gate.js
git commit -m "feat(gating): add frontend plan-gate utility"
```

---

### Task 5: Frontend — Pro badges on sidebar nav items

**Files:**
- Modify: `public/dashboard.html`
- Modify: `src/frontend/main.js`

- [ ] **Step 1: Add Pro badges to nav items in main.js**

In `src/frontend/main.js`, after the existing plan badge setup (around line 92+), add sidebar Pro badges:

```js
// ── Pro badges on sidebar nav items ──
if (!biz?.plan || biz.plan === 'free') {
  const proSections = ['invoices', 'deposits', 'waitlist', 'cal-sync', 'gift-cards', 'passes', 'analytics'];
  proSections.forEach(sec => {
    const el = document.querySelector(`.ni[data-section="${sec}"] span:last-child`);
    if (el && !el.querySelector('.pro-tag')) {
      el.insertAdjacentHTML('beforeend', '<span class="pro-tag" style="font-size:.55rem;font-weight:700;background:var(--primary);color:#fff;padding:1px 5px;border-radius:8px;margin-left:6px;vertical-align:1px">PRO</span>');
    }
  });
}
```

- [ ] **Step 2: Commit**

```bash
git add src/frontend/main.js
git commit -m "feat(gating): add Pro badges to sidebar nav items for Free users"
```

---

### Task 6: Frontend — Gate overlays on Pro-only views

**Files:**
- Modify: `src/frontend/views/invoices.js`
- Modify: `src/frontend/views/waitlist.js`
- Modify: `src/frontend/views/gift-cards.js`
- Modify: `src/frontend/views/passes.js`
- Modify: `src/frontend/views/deposits.js`
- Modify: `src/frontend/views/cal-sync.js`

Each of these views has a `loadXxx()` function that populates `contentArea`. Add a plan check at the very top of each load function.

- [ ] **Step 1: Gate invoices.js**

At the top of `loadInvoices()`, before the API call, add:

```js
import { isPro, showProGate } from '../utils/plan-gate.js';
```

(Add to existing imports at top of file)

Then at start of `loadInvoices()`:

```js
if (!isPro()) { showProGate(document.getElementById('contentArea'), 'Facturation'); return; }
```

- [ ] **Step 2: Gate waitlist.js**

Same pattern — import `isPro, showProGate`, add at top of `loadWaitlist()`:

```js
if (!isPro()) { showProGate(document.getElementById('contentArea'), "Liste d'attente"); return; }
```

- [ ] **Step 3: Gate gift-cards.js**

At top of `loadGiftCards()`:

```js
if (!isPro()) { showProGate(document.getElementById('contentArea'), 'Cartes cadeau'); return; }
```

- [ ] **Step 4: Gate passes.js**

At top of `loadPasses()`:

```js
if (!isPro()) { showProGate(document.getElementById('contentArea'), 'Abonnements'); return; }
```

- [ ] **Step 5: Gate deposits.js**

At top of `loadDeposits()`:

```js
if (!isPro()) { showProGate(document.getElementById('contentArea'), 'Acomptes'); return; }
```

- [ ] **Step 6: Gate cal-sync.js**

At top of `loadCalSync()` (or whatever the main load function is called):

```js
if (!isPro()) { showProGate(document.getElementById('contentArea'), 'Calendrier externe'); return; }
```

- [ ] **Step 7: Commit**

```bash
git add src/frontend/views/invoices.js src/frontend/views/waitlist.js src/frontend/views/gift-cards.js src/frontend/views/passes.js src/frontend/views/deposits.js src/frontend/views/cal-sync.js
git commit -m "feat(gating): add Pro gate overlays to invoices, waitlist, GC, passes, deposits, cal-sync"
```

---

### Task 7: Frontend — Gate gap analyzer + smart optimizer

**Files:**
- Modify: `src/frontend/views/agenda/gap-analyzer.js`
- Modify: `src/frontend/views/agenda/smart-optimizer.js`

These are calendar tools launched from buttons. Gate the button click handlers.

- [ ] **Step 1: Gate gap-analyzer.js**

Find the main entry function (likely `openGapAnalyzer` or similar). At the top, add:

```js
import { isPro } from '../../utils/plan-gate.js';
```

Then at the start of the function:

```js
if (!isPro()) {
  GendaUI.toast('Le gap analyzer est disponible avec le plan Pro', 'error');
  return;
}
```

- [ ] **Step 2: Gate smart-optimizer.js**

Same pattern for the main entry function:

```js
if (!isPro()) {
  GendaUI.toast('Le smart optimizer est disponible avec le plan Pro', 'error');
  return;
}
```

- [ ] **Step 3: Commit**

```bash
git add src/frontend/views/agenda/gap-analyzer.js src/frontend/views/agenda/smart-optimizer.js
git commit -m "feat(gating): gate gap analyzer and smart optimizer for Pro only"
```

---

### Task 8: Frontend — Gate promotions (count + LM)

**Files:**
- Modify: `src/frontend/views/promotions.js`
- Modify: `src/frontend/views/settings.js`

- [ ] **Step 1: Gate promotions.js — limit to 1**

Import plan-gate at top of file:

```js
import { isPro, proInlineHint } from '../utils/plan-gate.js';
```

In `renderPromotions()`, find the "Nouvelle promotion" button. Wrap it with a plan check:

```js
const canCreate = isPro() || activeCount < 1;
// In the button HTML:
// If !canCreate, disable the button and add tooltip
```

Replace the button HTML to:

```js
h += canCreate
  ? `<button onclick="openPromoModal()" class="btn-primary btn-sm">...</button>`
  : `<button class="btn-primary btn-sm" disabled style="opacity:.5;cursor:not-allowed" title="Le plan gratuit est limité à 1 promotion active">...</button>`;
```

- [ ] **Step 2: Gate settings.js — LM toggle**

In `src/frontend/views/settings.js`, find where the LM toggle is rendered. If `plan === 'free'`, disable the toggle and show "Plan Pro requis":

Find the `last_minute_enabled` toggle rendering. Add condition:

```js
const lmDisabled = plan === 'free';
```

Then in the toggle HTML, if `lmDisabled`, add `disabled` attribute and append `proInlineHint()`.

- [ ] **Step 3: Gate settings.js — deposit toggle**

Same pattern for `deposit_enabled` toggle — disable if `plan === 'free'`.

- [ ] **Step 4: Gate site.js — custom domain field**

In `src/frontend/views/site.js`, find the custom domain input field. If `plan === 'free'`, set it to disabled with a Pro hint.

- [ ] **Step 5: Commit**

```bash
git add src/frontend/views/promotions.js src/frontend/views/settings.js src/frontend/views/site.js
git commit -m "feat(gating): gate promo count, LM toggle, deposit toggle, custom domain for Free users"
```

---

### Task 9: Public-facing — Hide gated options from Free business booking flow

**Files:**
- Modify: `public/book.html`
- Modify: `public/site.html`

- [ ] **Step 1: book.html — hide GC/pass payment options if free**

The minisite data includes `plan`. In the booking flow JS, find where GC code input and pass selection are shown. Add:

```js
if (data.plan === 'free') {
  // Hide gift card code input
  // Hide pass selection
}
```

Search for the GC and pass UI elements and wrap them in a plan check.

- [ ] **Step 2: site.html — hide waitlist signup if free**

In the minisite JS where the waitlist button/form is rendered, add:

```js
if (d.plan === 'free') {
  // Don't show waitlist signup section
}
```

- [ ] **Step 3: Commit**

```bash
git add public/book.html public/site.html
git commit -m "feat(gating): hide GC, pass, waitlist options on Free business public pages"
```

---

### Task 10: Build + verify + push

- [ ] **Step 1: Syntax check all modified backend files**

```bash
node -e "
['src/middleware/auth.js','src/routes/staff/invoices.js','src/routes/staff/waitlist.js','src/routes/staff/calendar.js','src/routes/staff/deposits.js','src/routes/staff/promotions.js','src/routes/staff/settings.js','src/routes/staff/site.js','src/routes/public/gift-cards-passes.js','src/routes/public/deposit.js','src/routes/public/waitlist.js','src/routes/public/index.js'].forEach(f=>{require('./'+f);console.log('OK',f)})
"
```

- [ ] **Step 2: Build frontend**

```bash
npm run build
```

Expected: `built in ~2s` with no errors.

- [ ] **Step 3: Smoke test — verify Pro user unaffected**

If logged in as a Pro salon, all features should work normally. No Pro badges, no overlays, no 403s.

- [ ] **Step 4: Smoke test — verify Free user gated**

If logged in as a Free salon:
- Sidebar shows Pro badges on gated items
- Clicking gated items shows lock overlay with "Passer au Pro" CTA
- API calls to gated routes return 403 `upgrade_required`
- Creating a 2nd promo returns 403
- LM toggle disabled in settings

- [ ] **Step 5: Final commit + push**

```bash
git add -f dist/
git push
```
