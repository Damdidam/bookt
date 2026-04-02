# Two-Tier Plans Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the 3-tier plan system (free/pro/premium) with 2 tiers (free/pro at 60€/mois), add backend enforcement for free tier limits, and simplify all plan-related code.

**Architecture:** Backend-first approach. Start by simplifying the plan constants and removing premium references, then add new enforcement gates (practitioner limit, booking quota, analytics gate), then update Stripe flow, then update all frontend UI. Each task is independently deployable.

**Tech Stack:** Node.js/Express backend, vanilla JS frontend (Vite-built), PostgreSQL, Stripe Billing API.

---

### Task 1: Purge all 'premium' references from backend

**Files:**
- Modify: `src/routes/staff/stripe.js:23-38` (PLAN_PRICES, getPriceToPlan)
- Modify: `src/routes/staff/stripe.js:42-131` (checkout route)
- Modify: `src/routes/staff/stripe.js:646-672` (webhook subscription handler)
- Modify: `src/routes/staff/calls.js:397-401` (PLAN_QUOTAS)
- Modify: `src/services/reminders.js:18` (PLANS_WITH_SMS)
- Modify: `src/routes/public/booking-notifications.js:132,198` (inline plan checks)
- Modify: `src/routes/public/booking-actions.js` (inline plan checks)
- Modify: `src/routes/staff/bookings-status.js` (inline plan checks)
- Modify: `src/routes/staff/planning.js` (inline plan check)
- Modify: `src/routes/admin/index.js:150` (plan validation)
- Modify: `src/routes/staff/settings.js` (plan check if any)
- Modify: `src/routes/staff/signup.js` (comment only)

- [ ] **Step 1: Simplify stripe.js — PLAN_PRICES & getPriceToPlan**

Replace lines 1-38 header/constants:

```js
/**
 * Stripe Subscription Management
 * Handles: checkout, webhooks, customer portal, plan sync
 *
 * ENV vars needed:
 *   STRIPE_SECRET_KEY        — sk_live_... or sk_test_...
 *   STRIPE_WEBHOOK_SECRET    — whsec_...
 *   STRIPE_PRICE_PRO         — price_... (60€/month)
 *   APP_BASE_URL             — https://genda.be
 */

const router = require('express').Router();
const { query, pool } = require('../../services/db');
const { requireAuth, requireOwner } = require('../../middleware/auth');

function getStripe() {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return null;
  return require('stripe')(key);
}

const PLAN_PRICES = {
  pro: () => process.env.STRIPE_PRICE_PRO
};

function getPriceToPlan() {
  const pro = process.env.STRIPE_PRICE_PRO;
  const map = {};
  if (pro) map[pro] = 'pro';
  return map;
}
```

- [ ] **Step 2: Simplify checkout route — remove premium upgrade logic & trial**

In `stripe.js` checkout route, replace the error message and remove the pro→premium trial exception:

```js
// Line 53: change error message
return res.status(400).json({ error: 'Plan invalide.' });

// Lines 106-108: remove trial (free tier IS the trial)
subscription_data: {
  metadata: { business_id: bid, plan }
},

// Lines 119-122: delete the pro→premium block entirely
```

- [ ] **Step 3: Simplify calls.js PLAN_QUOTAS**

Replace the PLAN_QUOTAS at `calls.js:397-401`:

```js
const PLAN_QUOTAS = {
  free: { units: 0, extra_price_cents: 0, voicemail: false },
  pro: { units: 200, extra_price_cents: 15, voicemail: true }
};
```

- [ ] **Step 4: Simplify PLANS_WITH_SMS in reminders.js**

Replace line 18:

```js
const PLANS_WITH_SMS = ['pro'];
```

- [ ] **Step 5: Replace all inline `['pro', 'premium'].includes(plan)` with `plan !== 'free'`**

Files to grep and replace:
- `src/routes/public/booking-notifications.js:132` and `:198`
- `src/routes/public/booking-actions.js` (grep for `'premium'`)
- `src/routes/staff/bookings-status.js` (grep for `'premium'`)
- `src/routes/staff/planning.js` (grep for `'premium'`)
- `src/routes/staff/settings.js` (grep for `'premium'`)

Pattern: `['pro', 'premium'].includes(X)` → `X !== 'free'`

- [ ] **Step 6: Update admin plan validation**

In `src/routes/admin/index.js:150`, replace:

```js
if (plan && ['free', 'pro'].includes(plan)) {
```

- [ ] **Step 7: Verify — grep for remaining 'premium' in src/**

Run: `grep -rn "premium" src/` — should return 0 results (excluding node_modules, dist).

- [ ] **Step 8: Commit**

```bash
git add src/
git commit -m "refactor: remove premium tier, simplify to free/pro"
```

---

### Task 2: Add practitioner limit (free = 1)

**Files:**
- Modify: `src/routes/staff/practitioners.js:611` (POST handler)

- [ ] **Step 1: Read the POST handler to find exact insertion point**

Read `src/routes/staff/practitioners.js` around line 611 to understand the handler structure.

- [ ] **Step 2: Add practitioner limit guard**

At the top of the POST `/` handler, after auth validation, add:

```js
// Plan guard: free tier limited to 1 practitioner
const bizPlan = await queryWithRLS(bid,
  `SELECT b.plan, (SELECT COUNT(*) FROM practitioners WHERE business_id = b.id AND is_active = true) AS prac_count
   FROM businesses b WHERE b.id = $1`, [bid]);
if (bizPlan.rows[0]?.plan === 'free' && bizPlan.rows[0]?.prac_count >= 1) {
  return res.status(403).json({ error: 'Le plan gratuit est limité à 1 praticien. Passez au Pro pour en ajouter.' });
}
```

Note: use the existing `queryWithRLS` or `query` pattern from the file.

- [ ] **Step 3: Verify syntax**

Run: `node -c src/routes/staff/practitioners.js`

- [ ] **Step 4: Commit**

```bash
git add src/routes/staff/practitioners.js
git commit -m "feat: limit free tier to 1 practitioner"
```

---

### Task 3: Add weekly booking quota (free = 25, online only)

**Files:**
- Modify: `src/routes/public/index.js` (POST /:slug/bookings)

- [ ] **Step 1: Read the booking creation route to find insertion point**

Read `src/routes/public/index.js` around lines 50-100 to find where the business is fetched and where to add the guard (after business lookup, before booking creation).

- [ ] **Step 2: Add booking quota guard**

After the business is fetched and validated, before the booking INSERT, add:

```js
// Plan guard: free tier limited to 25 confirmed bookings per week (online only)
if (business.plan === 'free') {
  const weekCount = await client.query(
    `SELECT COUNT(*)::int AS cnt FROM bookings
     WHERE business_id = $1
       AND status IN ('confirmed', 'pending', 'pending_deposit', 'modified_pending')
       AND start_at >= date_trunc('week', NOW() AT TIME ZONE 'Europe/Brussels')
       AND start_at < date_trunc('week', NOW() AT TIME ZONE 'Europe/Brussels') + INTERVAL '1 week'`,
    [businessId]
  );
  if (weekCount.rows[0].cnt >= 25) {
    return res.status(403).json({
      error: 'Ce professionnel est complet pour cette semaine. Réessayez la semaine prochaine ou contactez directement le salon.'
    });
  }
}
```

Important: this must use the transaction `client` (not `query`) since it's inside the booking transaction. Read the exact context to confirm.

- [ ] **Step 3: Verify syntax**

Run: `node -c src/routes/public/index.js`

- [ ] **Step 4: Commit**

```bash
git add src/routes/public/index.js
git commit -m "feat: limit free tier to 25 online bookings per week"
```

---

### Task 4: Gate analytics for free tier

**Files:**
- Modify: `src/routes/staff/dashboard.js:278` (analytics route)

- [ ] **Step 1: Add plan guard to analytics route**

At the top of the `GET /analytics` handler, add:

```js
// Plan guard: analytics restricted to paid plans
const bizPlan = await queryWithRLS(bid,
  `SELECT plan FROM businesses WHERE id = $1`, [bid]);
if (bizPlan.rows[0]?.plan === 'free') {
  return res.status(403).json({ error: 'upgrade_required', message: 'Les statistiques avancées sont disponibles avec le plan Pro.' });
}
```

- [ ] **Step 2: Verify syntax**

Run: `node -c src/routes/staff/dashboard.js`

- [ ] **Step 3: Commit**

```bash
git add src/routes/staff/dashboard.js
git commit -m "feat: gate analytics for free tier"
```

---

### Task 5: SMS usage tracking (monthly counter)

**Files:**
- Modify: `src/services/sms.js` (add counter after successful send)

- [ ] **Step 1: Add SMS counter increment in sendSMS**

After a successful Twilio send (where `result.success = true` is set), add:

```js
// Track SMS usage for billing
try {
  await query(
    `UPDATE businesses SET
       sms_count_month = CASE
         WHEN sms_month_reset_at IS NULL OR sms_month_reset_at < date_trunc('month', NOW())
         THEN 1
         ELSE COALESCE(sms_count_month, 0) + 1
       END,
       sms_month_reset_at = CASE
         WHEN sms_month_reset_at IS NULL OR sms_month_reset_at < date_trunc('month', NOW())
         THEN date_trunc('month', NOW())
         ELSE sms_month_reset_at
       END
     WHERE id = $1`,
    [businessId]
  );
} catch (e) { console.warn('[SMS] Usage tracking error:', e.message); }
```

This auto-resets when the month changes. No separate cron needed.

- [ ] **Step 2: Create DB migration for the new columns**

Create `schema-v63-sms-usage.sql`:

```sql
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS sms_count_month integer DEFAULT 0;
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS sms_month_reset_at timestamptz;
```

- [ ] **Step 3: Run the migration**

Run it against the database (or note for manual execution).

- [ ] **Step 4: Verify syntax**

Run: `node -c src/services/sms.js`

- [ ] **Step 5: Commit**

```bash
git add src/services/sms.js schema-v63-sms-usage.sql
git commit -m "feat: track monthly SMS usage per business"
```

---

### Task 6: Frontend — settings page subscription cards (2 plans)

**Files:**
- Modify: `src/frontend/views/settings.js:549-572` (plan cards)

- [ ] **Step 1: Read the current plan cards section**

Read `src/frontend/views/settings.js` lines 549-578 to understand the full structure.

- [ ] **Step 2: Replace the 3-column plan cards with 2 columns**

Replace the plan cards block (from `<div class="plan-card">` to the closing `</div>` after the third plan-box) with:

```js
h+=`<div class="plan-card" style="display:grid;grid-template-columns:1fr 1fr;gap:16px;max-width:640px">
    <div class="plan-box${plan==='free'?' current':''}">
      ${plan==='free'?'<span class="current-badge">Actuel</span>':''}
      <div class="plan-name">Gratuit</div>
      <div class="plan-price">0 \u20ac<span>/mois</span></div>
      <ul><li>1 praticien</li><li>25 RDV/semaine en ligne</li><li>Mini-site public</li><li>1 thème (Classique)</li><li>Clients illimités</li><li>Rappels email</li></ul>
    </div>
    <div class="plan-box${plan==='pro'?' current':''}" style="border-color:var(--primary)">
      ${plan==='pro'?'<span class="current-badge">Actuel</span>':'<span style="position:absolute;top:-10px;right:12px;background:var(--primary);color:#fff;font-size:.68rem;padding:2px 8px;border-radius:10px;font-weight:700">RECOMMANDÉ</span>'}
      <div class="plan-name">Pro</div>
      <div class="plan-price">60 \u20ac<span>/mois</span></div>
      <ul><li>Praticiens illimités</li><li>RDV illimités</li><li>Tous les thèmes + couleur</li><li>Rappels email + SMS (200/mois)</li><li>Filtre d'appels (200 unités)</li><li>Messagerie vocale</li><li>Statistiques avancées</li><li>Support prioritaire</li></ul>
      ${plan==='free'?'<button class="btn-primary" style="width:100%;margin-top:8px" onclick="startCheckout(\'pro\')">Passer au Pro \u2192</button>':''}
      ${plan==='pro'&&subStatus.has_subscription?'<button class="btn-outline" style="width:100%;margin-top:8px" onclick="openStripePortal()">Gérer l\'abonnement</button>':''}
    </div>
  </div>`;
```

- [ ] **Step 3: Remove any reference to 'premium' in startCheckout or openStripePortal**

Grep `settings.js` for `premium` and remove/replace all occurrences.

- [ ] **Step 4: Commit**

```bash
git add src/frontend/views/settings.js
git commit -m "feat: redesign subscription page — 2 plans (Gratuit + Pro 60€)"
```

---

### Task 7: Frontend — analytics upgrade screen + team guard + home bandeau

**Files:**
- Modify: `src/frontend/views/analytics.js` (upgrade screen for free)
- Modify: `src/frontend/views/team.js:115,153` (disable add button for free)
- Modify: `src/frontend/views/home.js:24-26` (upgrade bandeau + RDV counter)

- [ ] **Step 1: Add upgrade screen in analytics.js**

Read `src/frontend/views/analytics.js` — find the main `loadAnalytics` function. At the top, before the API call, add a plan check:

```js
// Check plan — show upgrade screen for free tier
const planCheck = await api.get('/api/stripe/status');
if (planCheck.plan === 'free') {
  const c = document.getElementById('contentArea');
  c.innerHTML = `<div style="text-align:center;padding:60px 20px">
    <svg style="width:64px;height:64px;color:var(--text-4);margin-bottom:16px" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M3 3v18h18"/><path d="M7 16l4-8 4 4 4-6"/></svg>
    <h2 style="margin-bottom:8px;color:var(--text-1)">Statistiques avancées</h2>
    <p style="color:var(--text-3);margin-bottom:20px;max-width:400px;margin-left:auto;margin-right:auto">Analysez vos performances, revenus et tendances avec les statistiques détaillées du plan Pro.</p>
    <button class="btn-primary" onclick="window.location.hash='settings'">Passer au Pro — 60 €/mois</button>
  </div>`;
  return;
}
```

- [ ] **Step 2: Add practitioner guard in team.js**

Read `src/frontend/views/team.js` around lines 110-120 and 150-155. Modify the add button rendering to check the plan:

Before the `<button class="btn-primary" onclick="openPractModal()">+ Ajouter</button>`, wrap with plan check:

```js
const addBtnHtml = window._businessPlan === 'free' && practCount >= 1
  ? '<button class="btn-outline" disabled style="opacity:.5;cursor:not-allowed">+ Ajouter <span style="font-size:.72rem;margin-left:4px;color:var(--primary)">Pro</span></button>'
  : '<button class="btn-primary" onclick="openPractModal()">+ Ajouter</button>';
```

And similarly for the `tm-add` card.

Also, in `openPractModal()`, add an early guard:

```js
if (window._businessPlan === 'free') {
  const pracCount = document.querySelectorAll('.tm-card:not(.tm-add)').length;
  if (pracCount >= 1) { gToast('Passez au Pro pour ajouter des praticiens', 'error'); return; }
}
```

- [ ] **Step 3: Add upgrade bandeau + RDV counter in home.js**

Read `src/frontend/views/home.js` around lines 24-30. After the plan is determined, add a fetch for the weekly booking count and render a bandeau:

```js
// Weekly booking count for free tier bandeau
let weeklyBanner = '';
if (plan === 'free') {
  try {
    const wk = await api.get('/api/dashboard/summary');
    const weekCount = wk.weekly_booking_count || 0;
    if (weekCount >= 20) {
      weeklyBanner = `<div style="background:#FEF3C7;border:1px solid #F59E0B;border-radius:10px;padding:12px 16px;margin-bottom:16px;display:flex;align-items:center;gap:12px;font-size:.85rem;color:#92400E">
        <strong>${weekCount}/25</strong> RDV cette semaine
        <a href="#settings" style="margin-left:auto;color:#92400E;font-weight:600;text-decoration:underline">Passer au Pro →</a>
      </div>`;
    }
  } catch (e) { /* non-critical */ }
}
```

Then inject `weeklyBanner` at the top of the dashboard HTML.

Note: this requires the backend `/api/dashboard/summary` to return `weekly_booking_count`. Add this field to the summary route in `dashboard.js`:

```js
// In GET /summary, add:
const weekCountRes = await queryWithRLS(bid,
  `SELECT COUNT(*)::int AS cnt FROM bookings
   WHERE business_id = $1
     AND status IN ('confirmed', 'pending', 'pending_deposit', 'modified_pending')
     AND start_at >= date_trunc('week', NOW() AT TIME ZONE 'Europe/Brussels')
     AND start_at < date_trunc('week', NOW() AT TIME ZONE 'Europe/Brussels') + INTERVAL '1 week'`,
  [bid]);
// Add to response: weekly_booking_count: weekCountRes.rows[0].cnt
```

- [ ] **Step 4: Set window._businessPlan globally**

In `src/frontend/state.js` or `main.js`, ensure `window._businessPlan` is set from the business data fetched at login. Check how `plan` is currently available in the frontend (likely via the settings/profile API). Set it once at app init.

- [ ] **Step 5: Commit**

```bash
git add src/frontend/views/analytics.js src/frontend/views/team.js src/frontend/views/home.js src/routes/staff/dashboard.js src/frontend/state.js
git commit -m "feat: analytics upgrade screen, team guard, home booking counter"
```

---

### Task 8: Frontend — purge premium from frontend + public pages

**Files:**
- Modify: `src/frontend/views/site.js` (remove premium ref)
- Modify: `public/book.html` (remove premium refs)
- Modify: `public/admin.html` (remove premium refs)
- Modify: `src/frontend/styles/components.css` (remove premium ref if any)

- [ ] **Step 1: Grep and fix all remaining 'premium' in frontend**

Run: `grep -rn "premium" src/frontend/ public/`

For each occurrence:
- `['pro', 'premium'].includes(x)` → `x !== 'free'`
- `plan === 'premium'` → remove or merge with `plan === 'pro'`
- Marketing text mentioning "Premium" → remove

- [ ] **Step 2: Verify zero 'premium' remaining**

Run: `grep -rn "premium" src/ public/ --include="*.js" --include="*.html" --include="*.css"` — should return 0.

- [ ] **Step 3: Build and verify**

Run: `npm run build` — must succeed with 0 errors.

- [ ] **Step 4: Commit**

```bash
git add src/ public/
git commit -m "chore: purge all premium references from frontend"
```

---

### Task 9: Build, verify, push

- [ ] **Step 1: Full build**

```bash
npm run build
```

- [ ] **Step 2: Syntax check all modified backend files**

```bash
node -c src/routes/staff/stripe.js
node -c src/routes/staff/practitioners.js
node -c src/routes/public/index.js
node -c src/routes/staff/dashboard.js
node -c src/services/sms.js
node -c src/services/reminders.js
node -c src/routes/staff/calls.js
node -c src/routes/admin/index.js
```

- [ ] **Step 3: Final grep for premium**

```bash
grep -rn "premium" src/ public/ --include="*.js" --include="*.html" --include="*.css"
```

Expected: 0 results.

- [ ] **Step 4: Force-add dist and commit**

```bash
git add -f dist/
git commit -m "chore: rebuild dist"
```

- [ ] **Step 5: Push**

```bash
git push origin main
```

- [ ] **Step 6: Deploy to Render**

```bash
render deploys create srv-d6et4a3h46gs73df0kp0 --confirm
```
