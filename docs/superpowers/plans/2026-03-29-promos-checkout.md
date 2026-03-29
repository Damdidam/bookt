# Promos Checkout — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a promotional upsell system to the booking flow — commercants create promos with conditions/rewards, clients see them as badges + dedicated step between service selection and practitioner choice.

**Architecture:** New `promotions` table + CRUD API (`src/routes/staff/promotions.js`) + frontend dashboard view (`src/frontend/views/promotions.js`) + booking flow modifications in `book.html` (step 1.5 + inline badges) + minisite API enrichment.

**Tech Stack:** PostgreSQL, Express routes, vanilla JS frontend (existing Genda patterns), no new dependencies.

**Spec:** `docs/superpowers/specs/2026-03-29-promos-checkout-design.md`

---

### Task 1: Database — Create promotions table

**Files:**
- Create: `schema-v53-promotions.sql`

- [ ] **Step 1: Create migration file**

```sql
-- schema-v53-promotions.sql
CREATE TABLE IF NOT EXISTS promotions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  title VARCHAR(200) NOT NULL,
  description TEXT,
  image_url VARCHAR(500),
  condition_type VARCHAR(20) NOT NULL DEFAULT 'none'
    CHECK (condition_type IN ('min_amount', 'specific_service', 'first_visit', 'date_range', 'none')),
  condition_min_cents INT,
  condition_service_id UUID REFERENCES services(id) ON DELETE SET NULL,
  condition_start_date DATE,
  condition_end_date DATE,
  reward_type VARCHAR(20) NOT NULL
    CHECK (reward_type IN ('free_service', 'discount_pct', 'discount_fixed', 'info_only')),
  reward_service_id UUID REFERENCES services(id) ON DELETE SET NULL,
  reward_value INT,
  display_style VARCHAR(10) NOT NULL DEFAULT 'cards'
    CHECK (display_style IN ('cards', 'banner')),
  sort_order INT DEFAULT 0,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_promotions_business ON promotions(business_id) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_promotions_condition_svc ON promotions(condition_service_id) WHERE condition_service_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_promotions_reward_svc ON promotions(reward_service_id) WHERE reward_service_id IS NOT NULL;
```

- [ ] **Step 2: Run migration on Render DB**

```bash
PGPASSWORD=iermg01ZdfxZxK241DCPldZDde7Wo4Az psql -h dpg-d6shagvafjfc73evlo1g-a.oregon-postgres.render.com -U gendadb_user -d gendadb -f schema-v53-promotions.sql
```

Expected: `CREATE TABLE`, `CREATE INDEX` x3

- [ ] **Step 3: Commit**

```bash
git add schema-v53-promotions.sql
git commit -m "db: create promotions table (schema v53)"
```

---

### Task 2: Backend — Staff CRUD API

**Files:**
- Create: `src/routes/staff/promotions.js`
- Modify: `src/server.js` (mount route)

- [ ] **Step 1: Create promotions route file**

Create `src/routes/staff/promotions.js` with:
- `GET /` — list promos for business (ordered by sort_order)
- `POST /` — create promo (validate: max 5 active, reward_service belongs to same business, condition_type/reward_type valid)
- `PATCH /:id` — update promo (same validations)
- `DELETE /:id` — delete promo
- `PATCH /reorder` — accept `ordered_ids[]`, update sort_order

Use `queryWithRLS` from `../../services/db`. Require `requireOwner` middleware from existing auth pattern.

Key validations:
- `title` required, max 200 chars
- `condition_type` must be in enum
- `reward_type` must be in enum
- If `reward_type = 'free_service'`, `reward_service_id` required and must belong to same business
- If `condition_type = 'specific_service'`, `condition_service_id` required and must belong to same business
- If `condition_type = 'min_amount'`, `condition_min_cents` required and > 0
- If `reward_type = 'discount_pct'`, `reward_value` required, 1-100
- If `reward_type = 'discount_fixed'`, `reward_value` required, > 0
- Max 5 active promos per business (check on POST and on PATCH when setting is_active=true)

- [ ] **Step 2: Mount in server.js**

Find the staff routes section in `src/server.js`. Add:
```javascript
const promotions = require('./routes/staff/promotions');
app.use('/api/promotions', authenticate, promotions);
```

- [ ] **Step 3: Test endpoints manually**

```bash
# Start server locally or test on Render after deploy
curl -X GET /api/promotions -H "Authorization: Bearer $TOKEN"
curl -X POST /api/promotions -H "Content-Type: application/json" -d '{"title":"Test","condition_type":"none","reward_type":"info_only"}'
```

- [ ] **Step 4: Commit**

```bash
git add src/routes/staff/promotions.js src/server.js
git commit -m "feat: add promotions CRUD API (staff)"
```

---

### Task 3: Backend — Add promotions to minisite API

**Files:**
- Modify: `src/routes/public/minisite.js`

- [ ] **Step 1: Add promotions query to minisite endpoint**

In `src/routes/public/minisite.js`, find the `GET /:slug` handler. After the existing data queries (practitioners, services, etc.), add a query to fetch active promotions:

```javascript
const promoRes = await query(
  `SELECT p.id, p.title, p.description, p.image_url,
          p.condition_type, p.condition_min_cents, p.condition_service_id,
          p.condition_start_date, p.condition_end_date,
          p.reward_type, p.reward_service_id, p.reward_value, p.display_style,
          rs.name AS reward_service_name,
          rs.duration_min AS reward_service_duration_min,
          rs.price_cents AS reward_service_price_cents
   FROM promotions p
   LEFT JOIN services rs ON rs.id = p.reward_service_id
   WHERE p.business_id = $1 AND p.is_active = true
     AND (p.condition_end_date IS NULL OR p.condition_end_date >= CURRENT_DATE)
     AND (p.condition_start_date IS NULL OR p.condition_start_date <= CURRENT_DATE)
   ORDER BY p.sort_order, p.created_at`,
  [businessId]
);
```

Add `promotions: promoRes.rows` to the response object.

- [ ] **Step 2: Commit**

```bash
git add src/routes/public/minisite.js
git commit -m "feat: include active promotions in minisite API response"
```

---

### Task 4: Frontend — Dashboard promotions view

**Files:**
- Create: `src/frontend/views/promotions.js`
- Modify: `src/frontend/views/agenda/index.js` or `src/frontend/state.js` (sidebar nav)
- Modify: `public/dashboard.html` (add nav item)

- [ ] **Step 1: Add sidebar nav item**

In `public/dashboard.html`, find the sidebar nav items. Add a "Promotions" item between "Services" and "Clients" with the gift icon from IC registry.

- [ ] **Step 2: Create promotions.js view**

Create `src/frontend/views/promotions.js` with:

**loadPromotions():**
- Fetch `GET /api/promotions`
- Render list view: table with title, condition summary, reward summary, toggle active, sort_order
- "+" button to create (disabled if 5 active)
- Each row clickable to edit

**openPromoModal(id):**
- If id: fetch existing, pre-fill form
- If no id: empty form
- Dynamic fields based on condition_type and reward_type dropdowns
- Services dropdown populated from `api.getServices()` or fetch
- Aperçu live section at bottom (renders a mini preview of how the promo looks to client)
- Save button → POST or PATCH

**deletePromo(id):**
- Confirm dialog → DELETE

**reorderPromos():**
- Drag & drop (or up/down arrows like existing patterns) → PATCH /reorder

Follow existing view patterns: `bridge()` for window exposure, `GendaUI.toast()` for feedback, `guardModal()` for modal protection, `IC.*` for icons.

- [ ] **Step 3: Wire up navigation**

In the dashboard JS that handles section navigation, add case for 'promotions' that calls `loadPromotions()`.

- [ ] **Step 4: Build and test**

```bash
npm run build
```

Navigate to Promotions section in dashboard, create/edit/delete promos.

- [ ] **Step 5: Commit**

```bash
git add src/frontend/views/promotions.js public/dashboard.html
git commit -m "feat: promotions management view in dashboard"
```

---

### Task 5: Frontend — Promo badges inline in book.html (Step 1)

**Files:**
- Modify: `public/book.html`

- [ ] **Step 1: Store promotions data from API**

In `book.html`, the minisite data is loaded early. Find where `siteData` is populated and store `siteData.promotions` (already returned by minisite API from Task 3).

- [ ] **Step 2: Add badge rendering in service list**

Find the service rendering loop in step 1. For each service, check if any promo has `condition_type = 'specific_service'` AND `condition_service_id` matches. If so, append a badge:

```html
<span class="promo-badge">🎁 {promo.title}</span>
```

Also check `condition_type = 'min_amount'` promos and show badge on services whose price_cents could push the cart over the threshold.

Add CSS for `.promo-badge`:
```css
.promo-badge{font-size:11px;background:#fef3c7;color:#92400e;padding:2px 8px;border-radius:10px;margin-left:6px;font-weight:600}
```

- [ ] **Step 3: Commit**

```bash
git add public/book.html
git commit -m "feat: promo badges on eligible services in booking step 1"
```

---

### Task 6: Frontend — Step 1.5 Promos in book.html

**Files:**
- Modify: `public/book.html`

- [ ] **Step 1: Add step 1.5 HTML structure**

After step 1 div, add:
```html
<div class="step" id="stepPromos" data-step="promos" style="display:none">
  <h2 class="step-title">Offres spéciales</h2>
  <div id="promoContainer"></div>
  <div class="step-nav">
    <button class="btn-back" onclick="goPrev()">← Retour</button>
    <button class="btn-next" id="btnStepPromos" onclick="goNext()">Continuer →</button>
  </div>
</div>
```

- [ ] **Step 2: Update step order logic**

Find `computeStepOrder()`. Modify to insert 'promos' step after step 1 IF there are eligible promos. The step order becomes `[1, 'promos', 2, 3, 4, 5]` or `[1, 2, 3, 4, 5]` if no promos.

Eligibility check function:
```javascript
function getEligiblePromos() {
  const promos = siteData.promotions || [];
  const cart = multiServiceMode ? selectedServices : (selectedService ? [selectedService] : []);
  const cartTotal = cart.reduce((s, svc) => {
    const v = selectedVariants[svc.id];
    return s + (v ? v.price_cents : (svc.price_cents || 0));
  }, 0);
  const cartServiceIds = cart.map(s => s.id);

  return promos.filter(p => {
    if (p.condition_type === 'none') return true;
    if (p.condition_type === 'min_amount') return cartTotal >= p.condition_min_cents;
    if (p.condition_type === 'specific_service') return cartServiceIds.includes(p.condition_service_id);
    if (p.condition_type === 'date_range') {
      const today = new Date().toISOString().slice(0, 10);
      return (!p.condition_start_date || today >= p.condition_start_date) &&
             (!p.condition_end_date || today <= p.condition_end_date);
    }
    if (p.condition_type === 'first_visit') return true; // show to all, verify at submit
    return false;
  }).slice(0, 3);
}
```

- [ ] **Step 3: Render promos in step 1.5**

When navigating to step 'promos', call `renderPromoStep()`:

```javascript
function renderPromoStep() {
  const eligible = getEligiblePromos();
  if (eligible.length === 0) { goNext(); return; } // skip step

  const container = document.getElementById('promoContainer');
  // Check display_style of first promo (all promos share same business setting)
  const style = eligible[0].display_style || 'cards';

  if (style === 'banner') {
    renderPromoBanner(container, eligible);
  } else {
    renderPromoCards(container, eligible);
  }
}
```

**renderPromoCards():** Vertical list of promo cards with image, title, description, "Ajouter" button.

**renderPromoBanner():** Carousel with swipe support, dots navigation, single promo visible at a time.

- [ ] **Step 4: Handle "Ajouter" action**

When client clicks "Ajouter" on a promo:

- `free_service`: Add `reward_service` to `selectedServices[]` with `price_cents = 0` and flag `is_promo = true`. Update cart display.
- `discount_pct`: Store `appliedPromo = { type: 'discount_pct', value: p.reward_value, promo_id: p.id }` for use in buildSummary().
- `discount_fixed`: Store `appliedPromo = { type: 'discount_fixed', value: p.reward_value, promo_id: p.id }`.
- `info_only`: Just visual, no cart action. Button says "Noté ✓" after click.

Mark the promo card as "Ajouté ✓" and disable the button.

- [ ] **Step 5: Update buildSummary() for promo discounts**

In `buildSummary()`, if `appliedPromo` exists:
- `discount_pct`: show original price crossed out + discounted price
- `discount_fixed`: show "- X€" line in the summary

- [ ] **Step 6: Add promo CSS**

Add styles for `.promo-card`, `.promo-banner`, `.promo-dot`, `.promo-added` matching the existing book.html design tokens.

- [ ] **Step 7: Commit**

```bash
git add public/book.html
git commit -m "feat: step 1.5 promos in booking flow (cards + banner)"
```

---

### Task 7: Frontend — Service modal promo shortcut

**Files:**
- Modify: `src/frontend/views/services.js`

- [ ] **Step 1: Add promo section in service edit modal**

Find the service edit modal rendering. After the existing fields, add a "Promotion liée" section:

```javascript
// Promo shortcut section
m += `<div class="m-sec"><div class="m-sec-head"><span class="m-sec-title">${IC.gift} Promotion liée</span><span class="m-sec-line"></span></div>`;
m += `<label style="display:flex;align-items:center;gap:8px;cursor:pointer;margin-bottom:8px">`;
m += `<input type="checkbox" id="svc_promo_enabled" ${existingPromo ? 'checked' : ''}>`;
m += `<span style="font-size:.85rem">Offrir un service si cette prestation est réservée</span></label>`;
m += `<div id="svcPromoFields" style="display:${existingPromo ? '' : 'none'}">`;
m += `<div class="m-row m-row-2">`;
m += `<div><label class="m-field-label">Service cadeau</label><select class="m-input" id="svc_promo_reward">${serviceOptions}</select></div>`;
m += `<div><label class="m-field-label">Titre promo</label><input class="m-input" id="svc_promo_title" value="${existingPromo?.title || ''}" placeholder="Ex: Massage crânien offert"></div>`;
m += `</div>`;
m += `<div><label class="m-field-label">Description</label><textarea class="m-input" id="svc_promo_desc">${existingPromo?.description || ''}</textarea></div>`;
m += `</div></div>`;
```

- [ ] **Step 2: Load existing promo for this service**

When opening the service modal, fetch promos and check if one has `condition_type = 'specific_service'` AND `condition_service_id = thisServiceId`.

- [ ] **Step 3: Save promo on service save**

When saving the service, if promo checkbox is checked:
- If promo exists → PATCH it
- If no promo → POST new one with `condition_type = 'specific_service'`, `condition_service_id = serviceId`, `reward_type = 'free_service'`

If checkbox unchecked and promo existed → DELETE it.

- [ ] **Step 4: Commit**

```bash
git add src/frontend/views/services.js
git commit -m "feat: promo shortcut in service edit modal"
```

---

### Task 8: Build, deploy and test end-to-end

**Files:**
- Modify: `dist/` (build output)

- [ ] **Step 1: Build frontend**

```bash
npm run build
```

- [ ] **Step 2: Add dist and commit**

```bash
git add -f dist/
git commit -m "build: frontend dist for promos checkout feature"
```

- [ ] **Step 3: Push and deploy**

```bash
git push origin main
curl -s -X POST -H "Authorization: Bearer rnd_djrDyY4NxhUlXlqbiKN6TUMk18Hl" \
  -H "Accept: application/json" -H "Content-Type: application/json" \
  -d '{"clearCache":"do_not_clear"}' \
  "https://api.render.com/v1/services/srv-d6et4a3h46gs73df0kp0/deploys"
```

- [ ] **Step 4: End-to-end testing checklist**

Test on production:
- [ ] Dashboard: create a promo with condition `min_amount = 5000`, reward `free_service` → verify it appears in list
- [ ] Dashboard: toggle promo active/inactive → verify toggle works
- [ ] Dashboard: try to create 6th active promo → verify error
- [ ] Dashboard: edit service → add promo shortcut → verify promo created
- [ ] Minisite API: `GET /api/public/:slug` → verify `promotions[]` in response
- [ ] Booking flow: select service → verify badge appears on eligible services
- [ ] Booking flow: proceed to step 1.5 → verify promo cards/banner display
- [ ] Booking flow: add free service promo → verify it appears in cart at 0€
- [ ] Booking flow: add discount promo → verify discount shown in summary
- [ ] Booking flow: skip promos → verify booking completes normally
- [ ] Booking flow: verify créneau recalculated after adding promo service

- [ ] **Step 5: Commit any fixes**

```bash
git add -A
git commit -m "fix: promos checkout adjustments from e2e testing"
```
