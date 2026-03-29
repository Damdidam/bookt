# Promos Backend Integration — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist promo discounts in bookings so the calendar, invoices, and deposits all reflect the real price paid.

**Architecture:** Add 4 columns to `bookings` table (promotion_id, promotion_label, promotion_discount_pct, promotion_discount_cents). The public booking endpoint validates the promo server-side, calculates the discount, and saves it. The deposit logic uses the reduced price. The calendar modal shows a promo banner. Invoice auto-build adds a discount line.

**Tech Stack:** PostgreSQL (migration), Express.js (backend), vanilla JS (frontend)

---

### Task 1: Database Migration

**Files:**
- Create: `schema-v54-booking-promotions.sql`

- [ ] **Step 1: Create migration file**

```sql
-- schema-v54-booking-promotions.sql
-- Add promotion tracking columns to bookings table

ALTER TABLE bookings
  ADD COLUMN IF NOT EXISTS promotion_id UUID REFERENCES promotions(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS promotion_label VARCHAR(200),
  ADD COLUMN IF NOT EXISTS promotion_discount_pct INTEGER,
  ADD COLUMN IF NOT EXISTS promotion_discount_cents INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_bookings_promotion ON bookings(promotion_id) WHERE promotion_id IS NOT NULL;
```

- [ ] **Step 2: Run migration on Render DB**

```bash
psql "$DATABASE_URL" -f schema-v54-booking-promotions.sql
```

Expected: `ALTER TABLE` + `CREATE INDEX` — no errors.

- [ ] **Step 3: Verify columns exist**

```bash
psql "$DATABASE_URL" -c "\d bookings" | grep promotion
```

Expected:
```
promotion_id             | uuid                     |           |          |
promotion_label          | character varying(200)    |           |          |
promotion_discount_pct   | integer                  |           |          |
promotion_discount_cents | integer                  |           | not null | 0
```

- [ ] **Step 4: Commit**

```bash
git add schema-v54-booking-promotions.sql
git commit -m "feat: add promotion columns to bookings table (schema-v54)"
```

---

### Task 2: Promo Validation Helper

**Files:**
- Modify: `src/routes/public/helpers.js`

- [ ] **Step 1: Add `validateAndCalcPromo` function to helpers.js**

Add before the `module.exports` block (before line 144):

```javascript
/**
 * Validate a promotion and calculate the discount.
 * Returns { valid: false } if promo is invalid/inapplicable.
 * Returns { valid: true, label, discount_pct, discount_cents, reward_type, reward_service_id } if OK.
 *
 * @param {object} txClient - DB transaction client
 * @param {string} businessId - business UUID
 * @param {string} promotionId - promotion UUID from frontend
 * @param {Array} serviceIds - array of service UUIDs in the cart
 * @param {number} totalPriceCents - total cart price in cents (before discount)
 * @param {string|null} clientId - client UUID (null = new client)
 */
async function validateAndCalcPromo(txClient, businessId, promotionId, serviceIds, totalPriceCents, clientId) {
  if (!promotionId) return { valid: false };

  // Fetch promo
  const promoRes = await txClient.query(
    `SELECT * FROM promotions WHERE id = $1 AND business_id = $2 AND is_active = true`,
    [promotionId, businessId]
  );
  if (promoRes.rows.length === 0) return { valid: false };
  const promo = promoRes.rows[0];

  // Validate condition
  switch (promo.condition_type) {
    case 'specific_service':
      if (!serviceIds.includes(promo.condition_service_id)) return { valid: false };
      break;
    case 'min_amount':
      if (totalPriceCents < promo.condition_min_cents) return { valid: false };
      break;
    case 'first_visit':
      if (clientId) {
        // Client already exists in clients table for this business → not first visit
        const existsRes = await txClient.query(
          `SELECT 1 FROM clients WHERE id = $1 AND business_id = $2`,
          [clientId, businessId]
        );
        if (existsRes.rows.length > 0) return { valid: false };
      }
      // clientId is null → new client → first visit OK
      break;
    case 'date_range':
      const now = new Date();
      if (promo.condition_start_date && now < new Date(promo.condition_start_date)) return { valid: false };
      if (promo.condition_end_date && now > new Date(promo.condition_end_date + 'T23:59:59')) return { valid: false };
      break;
    case 'none':
      break;
    default:
      return { valid: false };
  }

  // Calculate discount
  let discount_cents = 0;
  let discount_pct = null;

  if (promo.reward_type === 'discount_pct') {
    discount_pct = promo.reward_value;
    if (promo.condition_type === 'specific_service') {
      // Discount on the specific service only — need its price
      const svcRes = await txClient.query(
        `SELECT price_cents FROM services WHERE id = $1`, [promo.condition_service_id]
      );
      const svcPrice = svcRes.rows[0]?.price_cents || 0;
      discount_cents = Math.round(svcPrice * promo.reward_value / 100);
    } else {
      discount_cents = Math.round(totalPriceCents * promo.reward_value / 100);
    }
  } else if (promo.reward_type === 'discount_fixed') {
    if (promo.condition_type === 'specific_service') {
      const svcRes = await txClient.query(
        `SELECT price_cents FROM services WHERE id = $1`, [promo.condition_service_id]
      );
      const svcPrice = svcRes.rows[0]?.price_cents || 0;
      discount_cents = Math.min(promo.reward_value, svcPrice);
    } else {
      discount_cents = Math.min(promo.reward_value, totalPriceCents);
    }
  } else if (promo.reward_type === 'free_service') {
    // The free service is added to the cart by the frontend.
    // The discount = price of the free service
    if (promo.reward_service_id) {
      const freeRes = await txClient.query(
        `SELECT price_cents FROM services WHERE id = $1`, [promo.reward_service_id]
      );
      discount_cents = freeRes.rows[0]?.price_cents || 0;
    }
  } else if (promo.reward_type === 'info_only') {
    // No discount, just informational
    return { valid: true, label: promo.title, discount_pct: null, discount_cents: 0, reward_type: 'info_only', reward_service_id: null };
  }

  if (discount_cents <= 0 && promo.reward_type !== 'info_only') return { valid: false };

  return {
    valid: true,
    label: promo.title,
    discount_pct,
    discount_cents,
    reward_type: promo.reward_type,
    reward_service_id: promo.reward_service_id || null
  };
}
```

- [ ] **Step 2: Export the new function**

In `module.exports` (line 144-148), add `validateAndCalcPromo`:

```javascript
module.exports = {
  UUID_RE, escHtml, stripeRefundDeposit, shouldRequireDeposit,
  computeDepositDeadline, isWithinLastMinuteWindow, SECTOR_PRACTITIONER,
  _nextSlotCache, _minisiteCache, BASE_URL, validateAndCalcPromo
};
```

- [ ] **Step 3: Commit**

```bash
git add src/routes/public/helpers.js
git commit -m "feat: add validateAndCalcPromo helper for server-side promo validation"
```

---

### Task 3: Multi-Service Booking — Accept & Save Promo

**Files:**
- Modify: `src/routes/public/index.js` (multi-service path, lines ~29-780)

- [ ] **Step 1: Destructure `promotion_id` from request body**

At line 32-42 of `index.js`, add `promotion_id` to the destructured fields:

```javascript
    const {
      service_id, service_ids, practitioner_id, practitioners: splitPractitioners,
      start_at, end_at, appointment_mode,
      variant_id, variant_ids,
      client_name, client_phone, client_email, client_bce,
      client_comment, client_language, consent_sms, consent_email, consent_marketing,
      flexible, is_last_minute,
      oauth_provider, oauth_provider_id,
      gift_card_code,
      pass_code,
      promotion_id
    } = req.body;
```

- [ ] **Step 2: Import `validateAndCalcPromo` from helpers**

At line 9, update the require to include the new function:

```javascript
const { UUID_RE, escHtml, stripeRefundDeposit, shouldRequireDeposit, computeDepositDeadline, isWithinLastMinuteWindow, BASE_URL, validateAndCalcPromo } = require('./helpers');
```

- [ ] **Step 3: Validate promo after client upsert (multi-service path)**

After the client upsert block (around line 510, after `clientId` is set) and before the booking INSERT loop (line 527), add promo validation:

```javascript
        // ── Promo validation (multi-service) ──
        let promoResult = { valid: false };
        if (promotion_id && UUID_RE.test(promotion_id)) {
          const cartServiceIds = multiServices.map(s => s.id);
          const cartTotal = multiServices.reduce((sum, s) => sum + (s.price_cents || 0), 0);
          promoResult = await validateAndCalcPromo(client, businessId, promotion_id, cartServiceIds, cartTotal, clientId);
        }
```

- [ ] **Step 4: Add promo columns to the booking INSERT (multi-service path)**

At lines 545-556, modify the INSERT to include promo columns. The promo is stored on the **first** booking in the group (group_order = 0):

```javascript
          const bk = await client.query(
            `INSERT INTO bookings (business_id, practitioner_id, service_id, service_variant_id, client_id,
              channel, appointment_mode, start_at, end_at, status, comment_client,
              group_id, group_order, confirmation_expires_at, processing_time, processing_start, locked, discount_pct,
              promotion_id, promotion_label, promotion_discount_pct, promotion_discount_cents)
             VALUES ($1,$2,$3,$4,$5,'web',$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)
             RETURNING id, public_token, start_at, end_at, status, group_id, group_order, discount_pct,
                       promotion_id, promotion_label, promotion_discount_pct, promotion_discount_cents`,
            [businessId, slotPracId, slot.service_id, slot.service_variant_id, clientId,
             appointment_mode||'cabinet', slot.start_at, slot.end_at, bookingStatus,
             client_comment||null, groupId, slot.group_order,
             needsConfirmation ? new Date(Date.now() + confirmTimeoutMin * 60000).toISOString() : null,
             slot.processing_time || 0, slot.processing_start || 0, bookingStatus === 'confirmed' ? true : multiLocked,
             slotDiscount,
             slot.group_order === 0 && promoResult.valid ? promotion_id : null,
             slot.group_order === 0 && promoResult.valid ? promoResult.label : null,
             slot.group_order === 0 && promoResult.valid ? promoResult.discount_pct : null,
             slot.group_order === 0 && promoResult.valid ? promoResult.discount_cents : 0]
          );
```

- [ ] **Step 5: Use reduced price for deposit calculation (multi-service path)**

At line 581, after `totalPrice` is calculated and before `shouldRequireDeposit` is called (line 593), add the reduced price calculation:

```javascript
            const totalPrice = parseInt(svcPriceResult.rows[0]?.total_price) || 0;
            const totalDuration = parseInt(svcPriceResult.rows[0]?.total_duration) || 0;
            // Promo: deposit threshold uses original price, deposit amount uses reduced price
            const promoDiscountCents = promoResult.valid ? promoResult.discount_cents : 0;
            const reducedPrice = totalPrice - promoDiscountCents;
```

Then at line 593, keep `shouldRequireDeposit` using `totalPrice` for the threshold check (this is correct — we want the original price for threshold). But for the deposit **amount** calculation, we need to patch the result. After `depResult` is computed (line 593):

```javascript
            const depResult = shouldRequireDeposit(bizSettings, totalPrice, totalDuration, noShowCount, clientIsVip);
            // Recalculate deposit amount on reduced price if promo applied
            if (depResult.required && promoDiscountCents > 0 && bizSettings.deposit_type !== 'fixed') {
              depResult.depCents = Math.round(reducedPrice * (bizSettings.deposit_percent || 50) / 100);
              if (depResult.depCents <= 0) depResult.required = false;
            }
```

- [ ] **Step 6: Commit**

```bash
git add src/routes/public/index.js
git commit -m "feat: persist promo in multi-service bookings + deposit on reduced price"
```

---

### Task 4: Single-Service Booking — Accept & Save Promo

**Files:**
- Modify: `src/routes/public/index.js` (single-service path, lines ~1100-1400)

- [ ] **Step 1: Add promo validation before single-service booking INSERT**

Before the booking INSERT (around line 1172, after the last-minute discount logic), add:

```javascript
      // ── Promo validation (single-service) ──
      let promoResult = { valid: false };
      if (promotion_id && UUID_RE.test(promotion_id)) {
        const svcPrice = resolvedVariantId
          ? (await client.query(`SELECT price_cents FROM service_variants WHERE id = $1`, [resolvedVariantId])).rows[0]?.price_cents || svcInfo.price_cents
          : svcInfo.price_cents || 0;
        promoResult = await validateAndCalcPromo(client, businessId, promotion_id, [effectiveServiceId], svcPrice, clientId);
      }
```

Note: `svcInfo` may not exist at this point. We need to check. The single-service price is fetched later (line 1198-1210). Instead, let's compute inline:

```javascript
      // ── Promo validation (single-service) ──
      let promoResult = { valid: false };
      if (promotion_id && UUID_RE.test(promotion_id)) {
        // Get service price for promo validation
        let promoSvcPrice = 0;
        const _promoSvcRes = await client.query(`SELECT price_cents FROM services WHERE id = $1`, [effectiveServiceId]);
        promoSvcPrice = _promoSvcRes.rows[0]?.price_cents || 0;
        if (resolvedVariantId) {
          const _promoVarRes = await client.query(`SELECT price_cents FROM service_variants WHERE id = $1`, [resolvedVariantId]);
          if (_promoVarRes.rows[0]?.price_cents != null) promoSvcPrice = _promoVarRes.rows[0].price_cents;
        }
        promoResult = await validateAndCalcPromo(client, businessId, promotion_id, [effectiveServiceId], promoSvcPrice, clientId);
      }
```

- [ ] **Step 2: Add promo columns to single-service booking INSERT**

At lines 1174-1184, modify the INSERT:

```javascript
      const booking = await client.query(
        `INSERT INTO bookings (business_id, practitioner_id, service_id, service_variant_id, client_id,
          channel, appointment_mode, start_at, end_at, status, comment_client, confirmation_expires_at,
          processing_time, processing_start, locked, discount_pct,
          promotion_id, promotion_label, promotion_discount_pct, promotion_discount_cents)
         VALUES ($1,$2,$3,$4,$5,'web',$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)
         RETURNING id, public_token, start_at, end_at, status, discount_pct,
                   promotion_id, promotion_label, promotion_discount_pct, promotion_discount_cents`,
        [businessId, practitioner_id, effectiveServiceId, resolvedVariantId, clientId,
         appointment_mode||'cabinet', startDate.toISOString(), endDate.toISOString(), bookingStatus, client_comment||null,
         needsConfirmation ? new Date(Date.now() + confirmTimeoutMin * 60000).toISOString() : null,
         resolvedProcessingTime, resolvedProcessingStart, bookingStatus === 'confirmed' ? true : singleLocked, resolvedDiscountPct,
         promoResult.valid ? promotion_id : null,
         promoResult.valid ? promoResult.label : null,
         promoResult.valid ? promoResult.discount_pct : null,
         promoResult.valid ? promoResult.discount_cents : 0]
      );
```

- [ ] **Step 3: Use reduced price for deposit (single-service path)**

After `svcPrice` is calculated (line 1204-1210) and before `shouldRequireDeposit` (line 1221):

```javascript
          const promoDiscountCents = promoResult.valid ? promoResult.discount_cents : 0;
          const reducedSvcPrice = svcPrice - promoDiscountCents;
```

Then after `depResult` (line 1221):

```javascript
          const depResult = shouldRequireDeposit(bizSettings, svcPrice, svcDuration, noShowCount, clientIsVip);
          // Recalculate deposit amount on reduced price if promo applied
          if (depResult.required && promoDiscountCents > 0 && bizSettings.deposit_type !== 'fixed') {
            depResult.depCents = Math.round(reducedSvcPrice * (bizSettings.deposit_percent || 50) / 100);
            if (depResult.depCents <= 0) depResult.required = false;
          }
```

- [ ] **Step 4: Commit**

```bash
git add src/routes/public/index.js
git commit -m "feat: persist promo in single-service bookings + deposit on reduced price"
```

---

### Task 5: Frontend — Send `promotion_id` in Booking POST

**Files:**
- Modify: `public/book.html`

- [ ] **Step 1: Find the booking POST request in book.html**

Search for the fetch/XMLHttpRequest that POSTs to the booking endpoint. Look for `service_id` or `service_ids` in the request body to find the right location.

- [ ] **Step 2: Add `promotion_id` to the POST body**

The frontend already tracks which promo is applied (from the promo step). Add the promo ID to the request body. Find the variable that stores the applied promo (likely something like `appliedPromo` or `selectedPromo`) and add it:

```javascript
// In the booking POST body, add:
promotion_id: window._appliedPromoId || null
```

The exact variable name depends on how the promo step stores the selected promo. Check the promo step logic in book.html for the variable name.

- [ ] **Step 3: Commit**

```bash
git add public/book.html
git commit -m "feat: send promotion_id in booking POST request"
```

---

### Task 6: Calendar Modal — Show Promo Banner

**Files:**
- Modify: `src/frontend/views/agenda/booking-detail.js`

- [ ] **Step 1: Add promo banner after the service card section**

After the service card rendering (around line 392, after `svcCard.innerHTML = ...`), add the promo banner:

```javascript
    // -- Promo banner --
    const promoBanner = document.getElementById('mPromoBanner');
    if (promoBanner) {
      if (b.promotion_discount_cents > 0 && b.promotion_label) {
        const origPrice = b.variant_price_cents ?? b.price_cents ?? 0;
        const discCents = b.promotion_discount_cents;
        const reducedPrice = origPrice - discCents;
        promoBanner.style.display = '';
        promoBanner.innerHTML = `
          <div style="display:flex;align-items:center;gap:8px;padding:10px 14px;border-radius:8px;border:1.5px solid var(--green);background:var(--green-bg);margin-top:8px">
            <svg class="gi" viewBox="0 0 24 24" fill="none" stroke="var(--green)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:16px;height:16px;flex-shrink:0">
              <path d="m21.44 11.05-9.19 9.19a2 2 0 0 1-2.83 0l-6.36-6.36a2 2 0 0 1 0-2.83l9.19-9.19a2 2 0 0 1 1.42-.59H19a2 2 0 0 1 2 2v5.31a2 2 0 0 1-.59 1.42z"/>
              <line x1="7" y1="17" x2="7.01" y2="17"/>
            </svg>
            <div style="flex:1;min-width:0">
              <div style="font-size:.78rem;font-weight:600;color:var(--green)">${esc(b.promotion_label)}</div>
              <div style="font-size:.72rem;color:var(--text-3)">
                ${b.promotion_discount_pct ? '-' + b.promotion_discount_pct + '%' : ''} \u2014
                <s style="opacity:.5">${(origPrice / 100).toFixed(2)}\u20ac</s>
                <span style="font-weight:600;color:var(--green)">${(reducedPrice / 100).toFixed(2)}\u20ac</span>
                <span style="opacity:.6">(-${(discCents / 100).toFixed(2)}\u20ac)</span>
              </div>
            </div>
          </div>`;
      } else {
        promoBanner.style.display = 'none';
        promoBanner.innerHTML = '';
      }
    }
```

- [ ] **Step 2: Add the `mPromoBanner` div in the modal HTML**

Find where the `mServiceCard` element is defined in the modal HTML template. Add a new div right after it:

```html
<div id="mPromoBanner" style="display:none"></div>
```

- [ ] **Step 3: Handle grouped bookings (multi-service) promo display**

In the grouped-bookings section (around line 355 where `totalPrice` is computed for siblings), update to show the promo:

```javascript
      // For grouped bookings, check if any sibling has a promo (stored on first booking, group_order=0)
      const promoSibling = siblings.find(s => s.promotion_discount_cents > 0);
```

Then use `promoSibling` in the promo banner logic above (replace `b.promotion_*` with the appropriate source depending on whether it's a group or single booking).

- [ ] **Step 4: Commit**

```bash
git add src/frontend/views/agenda/booking-detail.js
git commit -m "feat: show promo banner in calendar booking detail modal"
```

---

### Task 7: Invoice Auto-Build — Add Discount Line

**Files:**
- Modify: `src/routes/staff/invoices.js` (lines 170-196)

- [ ] **Step 1: Add promo discount line when auto-building invoice from booking**

After the existing auto-build block (lines 188-195 where `invoiceItems` is set from booking), add the discount line:

```javascript
      if (bkResult.rows.length > 0) {
        const bk = bkResult.rows[0];
        if (!client) {
          client = { id: bk.c_id, full_name: bk.full_name, email: bk.email,
                     phone: bk.phone, bce_number: bk.bce_number };
        }
        const svcLabel = bk.service_category ? `${bk.service_category} - ${bk.service_name}${bk.variant_name ? ' \u2014 ' + bk.variant_name : ''}` : (bk.variant_name ? `${bk.service_name} \u2014 ${bk.variant_name}` : bk.service_name);
        invoiceItems = [{
          description: `${svcLabel} — ${new Date(bk.start_at).toLocaleDateString('fr-BE')}`,
          quantity: 1,
          unit_price_cents: bk.variant_price_cents ?? bk.price_cents ?? 0,
          vat_rate: vat_rate || 21
        }];

        // Add promo discount line if applicable
        if (bk.promotion_discount_cents > 0 && bk.promotion_label) {
          invoiceItems.push({
            description: `Réduction : ${bk.promotion_label}${bk.promotion_discount_pct ? ' (-' + bk.promotion_discount_pct + '%)' : ''}`,
            quantity: 1,
            unit_price_cents: -bk.promotion_discount_cents,
            vat_rate: vat_rate || 21
          });
        }
      }
```

- [ ] **Step 2: Ensure the booking query fetches promo columns**

At lines 172-180, add `promotion_label`, `promotion_discount_pct`, `promotion_discount_cents` to the SELECT:

```sql
SELECT b.*, s.name AS service_name, s.category AS service_category, s.price_cents, s.duration_min,
       sv.name AS variant_name, sv.price_cents AS variant_price_cents,
       c.full_name, c.email, c.phone, c.bce_number, c.id AS c_id,
       b.promotion_label, b.promotion_discount_pct, b.promotion_discount_cents
FROM bookings b
JOIN services s ON s.id = b.service_id
LEFT JOIN service_variants sv ON sv.id = b.service_variant_id
JOIN clients c ON c.id = b.client_id
WHERE b.id = $1 AND b.business_id = $2
```

Note: `b.*` already includes these columns, but listing them explicitly makes the intent clear. Actually since `b.*` already includes them, just keep `b.*` and the promo columns will be available.

- [ ] **Step 3: Commit**

```bash
git add src/routes/staff/invoices.js
git commit -m "feat: add promo discount line in auto-built invoices"
```

---

### Task 8: Build & Verify

**Files:**
- Modify: `dist/` (build output)

- [ ] **Step 1: Run the frontend build**

```bash
cd /Users/Hakim/Desktop/bookt && npm run build
```

Expected: Build succeeds with no errors.

- [ ] **Step 2: Force-add dist and commit**

```bash
git add -f dist/
git commit -m "build: compile frontend with promo backend integration"
```

- [ ] **Step 3: Push to remote**

```bash
git push
```

- [ ] **Step 4: Trigger Render deploy**

Manual deploy on Render dashboard.

- [ ] **Step 5: Test end-to-end**

1. Create a promo in the dashboard (e.g., -20% on a specific service)
2. Book via the minisite with the promo applied
3. Check the booking in the calendar — promo banner should show
4. Create an invoice from the booking — discount line should appear
5. Verify the deposit amount is based on the reduced price
