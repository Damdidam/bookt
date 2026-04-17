# Audit Bugfixes — 2 avril 2026

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix 20 bugs found during the deep audit — 4 critiques, 3 high, 6 medium, 7 low.

**Architecture:** Minimal surgical fixes — each bug is a self-contained edit. No refactoring. No new files. Verify that each fix doesn't break surrounding logic by reading the full function context.

**Tech Stack:** Node.js/Express backend, vanilla JS frontend, PostgreSQL

**CRITICAL RULE:** After EACH task, verify the fix doesn't break anything. Read the surrounding code. Trace the data flow. If unsure, DO NOT COMMIT.

---

### Task 1: C1 — Staff cancel: refund pass/GC even without deposit

**Files:**
- Modify: `src/routes/staff/bookings-status.js:412-513`

**Problem:** `refundPassForBooking` and `refundGiftCardForBooking` are only called inside `if (dep?.deposit_required)`. Bookings with pass but no deposit never get refunded.

**Fix strategy:** Add a SEPARATE refund block AFTER the deposit block for when `deposit_required` is false. Model it on the public cancel flow (`booking-actions.js:96-115`).

- [ ] **Step 1: Read context to confirm no other refund path exists**

Read `bookings-status.js` lines 412-515 fully. Confirm that `refundPassForBooking` is ONLY called inside the `if (dep?.deposit_required)` block. Also check lines 515-630 (post-transaction) for any secondary refund call. There should be none.

- [ ] **Step 2: Add refund block for non-deposit bookings**

After the closing `}` of the `if (dep?.deposit_required)` block (line 512) and before line 515 (audit log), add:

```javascript
        // ===== PASS/GC REFUND: for bookings WITHOUT deposit (e.g. pass-covered) =====
        if (!dep?.deposit_required) {
          await refundGiftCardForBooking(id, client);
          await refundPassForBooking(id, client).catch(e => console.warn('[PASS REFUND]', e.message));
          // Group siblings
          if (old.rows[0].group_id) {
            const sibIds = await client.query(
              `SELECT id FROM bookings WHERE group_id = $1 AND business_id = $2 AND id != $3`,
              [old.rows[0].group_id, bid, id]
            );
            for (const sib of sibIds.rows) { await refundGiftCardForBooking(sib.id, client); }
            for (const sib of sibIds.rows) { await refundPassForBooking(sib.id, client).catch(e => console.warn('[PASS REFUND]', e.message)); }
          }
        }
```

- [ ] **Step 3: Verify the fix**

1. Confirm `refundGiftCardForBooking` and `refundPassForBooking` are imported at top of file (line 8-9) — they are.
2. Confirm the `client` variable (transaction client) is available in scope — it is (inside `transactionWithRLS` callback).
3. Confirm `old.rows[0].group_id` is available — it is (fetched at line 109).
4. Confirm this block only runs when `status === 'cancelled'` — it does (inside the `if (status === 'cancelled')` block at line 415).
5. Confirm the deposit block (line 423-512) handles the `dep?.deposit_required = true` case, and this new block handles `false`. No overlap.

- [ ] **Step 4: Commit**

```bash
git add src/routes/staff/bookings-status.js
git commit -m "fix(C1): refund pass/GC on staff cancel even without deposit"
```

---

### Task 2: C2 — booking-confirmation.js: add GC refund on auto-cancel

**Files:**
- Modify: `src/services/booking-confirmation.js:1-12` (imports) and `:61-69` (refund block)

**Problem:** `refundGiftCardForBooking` is not imported or called. Pass is refunded but not GC.

- [ ] **Step 1: Add import**

At line 10, change:

```javascript
const { getGcPaidCents } = require('./gift-card-refund');
```

to:

```javascript
const { refundGiftCardForBooking, getGcPaidCents } = require('./gift-card-refund');
```

- [ ] **Step 2: Add GC refund calls after pass refund**

After line 69 (`for (const sib of sibPass.rows) { await refundPassForBooking(sib.id, client)...`), add:

```javascript

      // Refund gift card debits
      await refundGiftCardForBooking(bk.id, client).catch(e => console.warn('[GC REFUND]', e.message));
      if (bk.group_id) {
        const sibGc = await client.query(
          `SELECT id FROM bookings WHERE group_id = $1 AND id != $2 AND status = 'cancelled'`,
          [bk.group_id, bk.id]
        );
        for (const sib of sibGc.rows) { await refundGiftCardForBooking(sib.id, client).catch(e => console.warn('[GC REFUND]', e.message)); }
      }
```

- [ ] **Step 3: Verify**

1. Pattern matches `deposit-expiry.js:70-77` which does the exact same thing.
2. The `client` variable is the transaction client — correct scope.
3. `refundGiftCardForBooking` is idempotent (checks for existing refund transactions) — safe even if called twice.

- [ ] **Step 4: Commit**

```bash
git add src/services/booking-confirmation.js
git commit -m "fix(C2): refund gift card on auto-cancel of expired pending bookings"
```

---

### Task 3: C3 — Fix double LM discount on manage-booking.html and booking.html

**Files:**
- Modify: `src/routes/public/booking-lookup.js:96-122` (both endpoints)

**Problem:** The API returns `service.price_cents` with LM already applied (for multi-service groups) AND returns `discount_pct` separately. The frontend applies LM again on the already-reduced price.

**Fix strategy:** The cleanest fix is in the API: return the RAW price (before LM) in `service.price_cents`, so the frontend's LM calculation is correct. The individual `members[].price_cents` already have LM applied (for per-member display) — that's fine. Only the TOTAL should be raw.

- [ ] **Step 1: Fix first endpoint (GET /booking/:token)**

In `booking-lookup.js`, the `serviceInfo` for group bookings at line 97-98:

Change:
```javascript
    const serviceInfo = groupServices
      ? { name: groupServices.map(s => s.name).join(' + '), duration_min: groupServices.reduce((sum, s) => sum + (s.duration_min || 0), 0), price_cents: groupServices.reduce((sum, s) => sum + (s.price_cents || 0), 0), color: bk.service_color, members: groupServices }
      : { name: (bk.service_category ? bk.service_category + ' - ' : '') + (bk.service_name || ''), duration_min: bk.duration_min, price_cents: bk.price_cents, color: bk.service_color };
```

To (use raw price for group total, keep adjusted per-member):
```javascript
    // For group total: use RAW prices (before LM) so frontend can apply discount_pct once.
    // Individual members[].price_cents stay LM-adjusted for per-line display.
    const groupRawTotal = bk.group_id && grpRows ? grpRows.reduce((sum, r) => sum + (r.price_cents || 0), 0) : 0;
    const serviceInfo = groupServices
      ? { name: groupServices.map(s => s.name).join(' + '), duration_min: groupServices.reduce((sum, s) => sum + (s.duration_min || 0), 0), price_cents: groupRawTotal, color: bk.service_color, members: groupServices }
      : { name: (bk.service_category ? bk.service_category + ' - ' : '') + (bk.service_name || ''), duration_min: bk.duration_min, price_cents: bk.price_cents, color: bk.service_color };
```

- [ ] **Step 2: Fix second endpoint (GET /manage/:token)**

Same fix in the second endpoint. Find the equivalent `serviceInfo` construction (around line 280-282) and apply the same change:

Change:
```javascript
    const serviceInfo = groupServices
      ? { name: groupServices.map(s => s.name).join(' + '), duration_min: groupServices.reduce((sum, s) => sum + (s.duration_min || 0), 0), price_cents: groupServices.reduce((sum, s) => sum + (s.price_cents || 0), 0), color: bk.service_color, members: groupServices }
      : { name: (bk.service_category ? bk.service_category + ' - ' : '') + (bk.service_name || ''), duration_min: bk.duration_min, price_cents: bk.price_cents, color: bk.service_color };
```

To:
```javascript
    const groupRawTotal2 = bk.group_id && grpRows2 ? grpRows2.reduce((sum, r) => sum + (r.price_cents || 0), 0) : 0;
    const serviceInfo = groupServices
      ? { name: groupServices.map(s => s.name).join(' + '), duration_min: groupServices.reduce((sum, s) => sum + (s.duration_min || 0), 0), price_cents: groupRawTotal2, color: bk.service_color, members: groupServices }
      : { name: (bk.service_category ? bk.service_category + ' - ' : '') + (bk.service_name || ''), duration_min: bk.duration_min, price_cents: bk.price_cents, color: bk.service_color };
```

- [ ] **Step 3: Verify no breakage**

1. `manage-booking.html:155` calculates `lmDiscount = price_cents * discount_pct / 100`. With raw price this is correct.
2. `manage-booking.html:159` shows `orig = price_cents`, `disc = price_cents - totalDiscount`. With raw price: correct.
3. `booking.html:362` same logic. With raw price: correct.
4. `manage-booking.html:235` "reste a payer" uses `totalCents = bk.service.price_cents`. With raw price + single LM subtraction: correct.
5. Individual `members[].price_cents` are STILL LM-adjusted (line 78 adjPrice) — per-member display stays correct.
6. `deposit.html:199` uses `bk.promotion.discount_cents` not `service.price_cents` — not affected.
7. For SINGLE-service bookings (no groupServices), `bk.price_cents` is the raw catalog price — unchanged, no regression.

- [ ] **Step 4: Commit**

```bash
git add src/routes/public/booking-lookup.js
git commit -m "fix(C3): return raw price in group total to prevent double LM discount"
```

---

### Task 4: C4 — Always refund GC on cancellation (regardless of deposit status)

**Files:**
- Modify: `src/routes/public/booking-actions.js:99,502,1105`

**Problem:** `shouldRefundGc = !deposit_required || deposit_status === 'refunded'` — when deposit is retained (`cancelled`), GC is not refunded. Client loses both.

**Fix strategy:** GC should ALWAYS be refunded on cancellation. The GC debit is a payment toward the deposit — if the deposit is retained (business keeps it), the Stripe portion is retained but the GC portion should be restored. This matches deposit-expiry.js which always refunds GC.

- [ ] **Step 1: Fix first cancel endpoint (line 99)**

Change:
```javascript
      const shouldRefundGc = !postCancelBk.deposit_required || postCancelBk.deposit_status === 'refunded';
```
To:
```javascript
      // Always refund GC debits on cancellation — GC is a client asset, not deposit retention
      const shouldRefundGc = true;
```

- [ ] **Step 2: Fix reject endpoint (line 502)**

Change:
```javascript
      const shouldRefundGcReject = !rejBkTx.deposit_required || rejBkTx.deposit_status === 'refunded';
```
To:
```javascript
      // Always refund GC debits on rejection — GC is a client asset, not deposit retention
      const shouldRefundGcReject = true;
```

- [ ] **Step 3: Fix second cancel endpoint (line 1105)**

Change:
```javascript
      const shouldRefundGc2 = !postCancelBk2.deposit_required || postCancelBk2.deposit_status === 'refunded';
```
To:
```javascript
      // Always refund GC debits on cancellation — GC is a client asset, not deposit retention
      const shouldRefundGc2 = true;
```

- [ ] **Step 4: Verify**

1. `refundGiftCardForBooking` is idempotent (checks for existing refund txns) — safe.
2. This matches `deposit-expiry.js:70` which always refunds GC.
3. The Stripe deposit is still retained/refunded per deadline logic — unaffected.
4. The sibling refund loops (lines 110-111, 513-514, 1116-1117) also use `shouldRefundGc` — they will now also always refund. Correct.

- [ ] **Step 5: Commit**

```bash
git add src/routes/public/booking-actions.js
git commit -m "fix(C4): always refund gift card on cancel — GC is client asset not deposit retention"
```

---

### Task 5: H1 — Fix broadcast() SSE signature

**Files:**
- Modify: `src/routes/public/gift-cards-passes.js:165`

- [ ] **Step 1: Fix the broadcast call**

Change:
```javascript
      try { const { broadcast } = require('../../services/sse'); if (broadcast) broadcast(bk.business_id, { type: 'booking', action: 'updated', booking_id: bk.id }); } catch (e) {}
```
To:
```javascript
      try { const { broadcast } = require('../../services/sse'); if (broadcast) broadcast(bk.business_id, 'booking_update', { action: 'deposit_paid', booking_id: bk.id }); } catch (e) {}
```

- [ ] **Step 2: Verify**

Matches the pattern in `stripe.js:294`: `broadcast(businessId, 'booking_update', { action: 'deposit_paid', booking_id: bookingId })`.

- [ ] **Step 3: Commit**

```bash
git add src/routes/public/gift-cards-passes.js
git commit -m "fix(H1): correct broadcast() SSE signature for GC deposit payment"
```

---

### Task 6: H2 — Fix book.html confirmation fallback promo ignoring LM

**Files:**
- Modify: `public/book.html:2816`

- [ ] **Step 1: Apply LM discount before promo in fallback**

Change lines 2816:
```javascript
        var confirmNewTotal2=confirmCartTotal-confirmDiscAmt;
```
To:
```javascript
        var confirmBaseForFallback=(data.booking&&data.booking.discount_pct)?Math.round(confirmCartTotal*(100-data.booking.discount_pct)/100):confirmCartTotal;
        var confirmNewTotal2=confirmBaseForFallback-confirmDiscAmt;
```

- [ ] **Step 2: Verify**

1. This matches the pattern at line 2807: `confirmFallbackBase` already applies LM before promo for the server promo path.
2. The `confirmCartTotal` is the raw total — applying LM first then promo is correct.
3. The `confirmDiscAmt` is already computed by `calcPromoDiscAmount` on the raw cart — this is cosmetic-only (server recomputes anyway). The visual is now correct.

- [ ] **Step 3: Commit**

```bash
git add public/book.html
git commit -m "fix(H2): apply LM discount before promo in confirmation fallback"
```

---

### Task 7: H3 — Fix pass-expiry greeting using pass name instead of buyer name

**Files:**
- Modify: `src/services/pass-expiry.js:23`

- [ ] **Step 1: Fix client_name**

Change:
```javascript
      const client_name = pass.name || 'Client';
```
To:
```javascript
      const client_name = pass.buyer_name || 'Client';
```

- [ ] **Step 2: Verify `buyer_name` is in the query**

Read the SELECT query above line 23. Check it includes `buyer_name`. If not, add it.

- [ ] **Step 3: Commit**

```bash
git add src/services/pass-expiry.js
git commit -m "fix(H3): use buyer_name not pass template name in expiry email greeting"
```

---

### Task 8: M1 — Allow reschedule POST for modified_pending status

**Files:**
- Modify: `src/routes/public/booking-reschedule.js:173`

- [ ] **Step 1: Add modified_pending to allowed statuses**

Change:
```javascript
    if (!['confirmed', 'pending_deposit'].includes(bk.status)) { await client.query('ROLLBACK'); return res.status(403).json({ error: 'Ce rendez-vous ne peut pas être modifié.' }); }
```
To:
```javascript
    if (!['confirmed', 'pending_deposit', 'modified_pending'].includes(bk.status)) { await client.query('ROLLBACK'); return res.status(403).json({ error: 'Ce rendez-vous ne peut pas être modifié.' }); }
```

- [ ] **Step 2: Verify**

1. GET slots at line 72 already allows `modified_pending`. Now consistent.
2. The rest of the reschedule logic doesn't depend on the original status being `confirmed` — safe.

- [ ] **Step 3: Commit**

```bash
git add src/routes/public/booking-reschedule.js
git commit -m "fix(M1): allow reschedule POST for modified_pending status"
```

---

### Task 9: M2 — Fix double HTML-escape in email footers

**Files:**
- Modify: `src/services/email-cancel.js:148`
- Modify: `src/services/email-deposit.js:129,278,423,571`

**Fix:** Remove `escHtml()` from footerText — `buildEmailHTML` already escapes it.

- [ ] **Step 1: Fix email-cancel.js:148**

Change:
```javascript
    footerText: `${safeBizName}${business.address ? ' · ' + escHtml(business.address) : ''} · Via Genda.be`
```
To:
```javascript
    footerText: `${business.name}${business.address ? ' · ' + business.address : ''} · Via Genda.be`
```

- [ ] **Step 2: Fix email-deposit.js — 4 occurrences (lines 129, 278, 423, 571)**

Apply the same change to all 4 occurrences. Each one:

Change `${safeBizName}${business.address ? ' · ' + escHtml(business.address) : ''} · Via Genda.be`
To: `${business.name}${business.address ? ' · ' + business.address : ''} · Via Genda.be`

- [ ] **Step 3: Verify**

1. `buildEmailHTML` at `email-utils.js:224` calls `escHtml(footerText)` — single escape. Correct.
2. `email-booking.js:156,318` already use raw `business.name` + `business.address` — consistent.
3. `email-modification.js:139` already uses raw values — consistent.

- [ ] **Step 4: Commit**

```bash
git add src/services/email-cancel.js src/services/email-deposit.js
git commit -m "fix(M2): remove double HTML-escape in email footers"
```

---

### Task 10: M3 — Fix review URL missing APP_BASE_URL

**Files:**
- Modify: `src/services/email-misc.js:101`

- [ ] **Step 1: Fix the URL**

Change:
```javascript
  const reviewUrl = `${process.env.BASE_URL || 'https://genda.be'}/review/${booking.review_token}`;
```
To:
```javascript
  const reviewUrl = `${process.env.APP_BASE_URL || process.env.BASE_URL || 'https://genda.be'}/review/${booking.review_token}`;
```

- [ ] **Step 2: Verify**

Matches every other URL construction in the codebase (e.g., `email-modification.js:30`).

- [ ] **Step 3: Commit**

```bash
git add src/services/email-misc.js
git commit -m "fix(M3): add APP_BASE_URL fallback to review email URL"
```

---

### Task 11: M5 + M6 + L1-L7 — Remaining medium/low fixes

**Files:**
- Modify: `src/frontend/views/planning.js:463,701,702`
- Modify: `src/frontend/views/site.js:664`
- Modify: `public/manage-booking.html:345,348`
- Modify: `src/routes/public/booking-actions.js:1188` (comment fix)
- Modify: `src/services/pass-expiry.js` (buyer_email null check)

- [ ] **Step 1: Fix toLocaleDateString without timeZone — planning.js**

Line 463: `new Date().toLocaleDateString('en-CA')` → `new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Brussels' })`
Line 701: same fix
Line 702: same fix for tomorrow

- [ ] **Step 2: Fix toLocaleDateString without timeZone — site.js**

Line 664: `new Date().toLocaleDateString('en-CA')` → `new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Brussels' })`

- [ ] **Step 3: Fix toLocaleDateString without timeZone — manage-booking.html**

Line 345: `d.toLocaleDateString('en-CA')` → `d.toLocaleDateString('en-CA', { timeZone: 'Europe/Brussels' })`
Line 348: same fix

- [ ] **Step 4: Fix misleading comment — booking-actions.js:1188**

Change: `// Send cancellation email + SMS + waitlist (non-blocking)`
To: `// Send cancellation email + waitlist (non-blocking — no SMS for cancellations)`

- [ ] **Step 5: Add buyer_email null check — pass-expiry.js**

After line 22 (`const client_email = pass.buyer_email;`), add:
```javascript
      if (!client_email) { console.warn(`[PASS EXPIRY] No buyer_email for pass ${pass.id}`); continue; }
```

- [ ] **Step 6: Commit**

```bash
git add src/frontend/views/planning.js src/frontend/views/site.js public/manage-booking.html src/routes/public/booking-actions.js src/services/pass-expiry.js
git commit -m "fix(L1-L7): timezone fixes, comment fix, pass-expiry null check"
```

---

### Task 12: Build + verify

- [ ] **Step 1: Run build**

```bash
cd /Users/Hakim/Desktop/bookt && npm run build
```

Expected: build succeeds with no errors.

- [ ] **Step 2: Verify dist is updated**

```bash
git add -f dist/
```

- [ ] **Step 3: Final commit**

```bash
git commit -m "build: update dist after audit bugfixes"
```
