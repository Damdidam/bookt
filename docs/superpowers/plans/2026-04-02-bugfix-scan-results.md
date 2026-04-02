# Bugfix Scan Results — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix all Critical + Elevated + Medium bugs found during the full-app scan, in priority order.

**Architecture:** Each task is a surgical fix to one specific bug, with minimal blast radius. No refactoring, no structural changes. Each fix touches 1-3 files max. Tasks are ordered by severity: Critical > Elevated > Medium.

**Tech Stack:** Node.js/Express backend, vanilla JS frontend, PostgreSQL, Stripe API.

**CRITICAL RULE FOR AGENTS:** After each fix, verify you haven't broken anything by re-reading the surrounding code. Never change logic that wasn't part of the bug. Keep the exact same code style (indentation, quotes, spacing).

---

### Task 1: [C1] Staff cancel — always refund deposit

**Files:**
- Modify: `src/routes/staff/bookings-status.js:426-436`

**Bug:** When staff cancels a booking, same deadline logic as client applies. Deposit is retained if after deadline. Should ALWAYS refund when staff cancels.

- [ ] **Step 1: Fix the deposit refund logic for staff cancel**

At `src/routes/staff/bookings-status.js`, replace lines 426-436:

```javascript
          let newDepStatus;
          if (dep.deposit_status === 'paid') {
            const hoursUntilRdv = (new Date(dep.start_at) - new Date()) / 3600000;
            const minSinceCreated = (new Date() - new Date(dep.created_at)) / 60000;
            if (minSinceCreated <= graceMin) {
              newDepStatus = 'refunded';
            } else if (hoursUntilRdv >= cancelDeadlineH) {
              newDepStatus = 'refunded';
            } else {
              newDepStatus = 'cancelled';
            }
```

With:

```javascript
          let newDepStatus;
          if (dep.deposit_status === 'paid') {
            // Staff cancel = ALWAYS refund the deposit to the client
            newDepStatus = 'refunded';
```

- [ ] **Step 2: Verify the fix doesn't break Stripe refund flow below**

Read lines 440-486 of the same file. Confirm `if (newDepStatus === 'refunded' && dep.deposit_payment_intent_id)` still triggers the Stripe refund. It does — no change needed downstream.

- [ ] **Step 3: Verify sibling group handling**

Read lines 497-520 of the same file. Confirm group siblings also get `deposit_status = 'refunded'` via the separate query there. Check: does the group sibling update use the same deadline logic?

If yes, apply the same fix there: force `newDepStatus = 'refunded'` for siblings too.

- [ ] **Step 4: Commit**

```bash
git add src/routes/staff/bookings-status.js
git commit -m "fix: always refund deposit when staff cancels booking

Staff cancel was using client deadline logic, retaining deposit after
deadline. Business rule: staff cancel = always refund to client."
```

---

### Task 2: [C2] GC not refunded when deposit is retained after deadline

**Files:**
- Modify: `src/routes/public/booking-actions.js:96-109`

**Bug:** `refundGiftCardForBooking` is called unconditionally on cancel. When client cancels after deadline, Stripe deposit is retained BUT gift card is re-credited. Business loses the GC portion.

**Rule:** GC should only be re-credited when `deposit_status === 'refunded'` OR when there was no deposit at all.

- [ ] **Step 1: Read the cancel result to understand available data**

`cancelResult.rows[0]` (line 97) contains the updated booking after the atomic UPDATE. It has `deposit_status` which is now either `'refunded'`, `'cancelled'`, or unchanged.

- [ ] **Step 2: Conditionally refund GC based on deposit_status**

At `src/routes/public/booking-actions.js`, replace lines 96-109:

```javascript
      // Refund gift card debits inside transaction
      const postCancelBk = cancelResult.rows[0];
      const { refundGiftCardForBooking } = require('../../services/gift-card-refund');
      try { await refundGiftCardForBooking(postCancelBk.id, txClient); } catch (e) { console.error('[GC REFUND] cancel error:', e.message); }
      // Refund pass sessions inside transaction
      await refundPassForBooking(postCancelBk.id, txClient).catch(e => console.warn('[PASS REFUND]', e.message));
      // Refund GC debits + pass sessions for group siblings inside transaction
      if (bk.group_id) {
        try {
          const sibs = await txClient.query(`SELECT id FROM bookings WHERE group_id = $1 AND business_id = $2 AND id != $3`, [bk.group_id, bk.business_id, bk.id]);
          for (const sib of sibs.rows) { await refundGiftCardForBooking(sib.id, txClient); }
          for (const sib of sibs.rows) { await refundPassForBooking(sib.id, txClient).catch(e => console.warn('[PASS REFUND]', e.message)); }
        } catch (e) { console.error('[GC REFUND] sibling cancel error:', e.message); }
      }
```

With:

```javascript
      // Refund gift card debits + pass sessions inside transaction
      // Only refund GC if deposit was refunded or no deposit was involved
      const postCancelBk = cancelResult.rows[0];
      const shouldRefundGc = !postCancelBk.deposit_required || postCancelBk.deposit_status === 'refunded';
      const { refundGiftCardForBooking } = require('../../services/gift-card-refund');
      if (shouldRefundGc) {
        try { await refundGiftCardForBooking(postCancelBk.id, txClient); } catch (e) { console.error('[GC REFUND] cancel error:', e.message); }
      }
      // Pass sessions: always refund (pass is a prepaid entitlement, not money)
      await refundPassForBooking(postCancelBk.id, txClient).catch(e => console.warn('[PASS REFUND]', e.message));
      // Group siblings
      if (bk.group_id) {
        try {
          const sibs = await txClient.query(`SELECT id FROM bookings WHERE group_id = $1 AND business_id = $2 AND id != $3`, [bk.group_id, bk.business_id, bk.id]);
          if (shouldRefundGc) {
            for (const sib of sibs.rows) { await refundGiftCardForBooking(sib.id, txClient); }
          }
          for (const sib of sibs.rows) { await refundPassForBooking(sib.id, txClient).catch(e => console.warn('[PASS REFUND]', e.message)); }
        } catch (e) { console.error('[GC REFUND] sibling cancel error:', e.message); }
      }
```

- [ ] **Step 3: Apply the same fix to the second cancel route (POST cancel via email link)**

There is a SECOND cancel route further in the same file (around line 1090-1100). Search for the second occurrence of `refundGiftCardForBooking` in `booking-actions.js`. Apply the exact same conditional logic.

Read the `cancelResult` variable name in that section (it may differ — e.g. `cancelResult` at the first route, different variable at the second). Use the correct variable.

- [ ] **Step 4: Check the "reject modified booking" route too**

Around lines 496-504, there's a `refundGiftCardForBooking` call for the `reject` flow. A rejection should ALWAYS refund GC (the client didn't choose to cancel). Leave this one UNCONDITIONAL.

- [ ] **Step 5: Commit**

```bash
git add src/routes/public/booking-actions.js
git commit -m "fix: only refund gift card when deposit is also refunded

When client cancels after deadline, deposit is retained but GC was
re-credited — business lost the GC portion. Now GC refund is conditional
on deposit being refunded or no deposit involved."
```

---

### Task 3: [E1] Add missing staff_notes column to waitlist schema

**Files:**
- Modify: `schema-v7-waitlist.sql` (add column)

- [ ] **Step 1: Add the column to the schema file**

At the end of `schema-v7-waitlist.sql`, before the `ALTER TABLE waitlist_entries ENABLE ROW LEVEL SECURITY;` line, add:

```sql
-- Staff notes (added v7.1)
ALTER TABLE waitlist_entries ADD COLUMN IF NOT EXISTS staff_notes text;
```

- [ ] **Step 2: Commit**

```bash
git add schema-v7-waitlist.sql
git commit -m "fix: add missing staff_notes column to waitlist schema

The column was used in staff/waitlist.js but never created in the
schema, causing a PostgreSQL error when saving staff notes."
```

---

### Task 4: [E2] Fix client comment invisible in pro email

**Files:**
- Modify: `src/services/notification-processor.js:208`

**Bug:** Template uses `bk.client_notes` but DB column is `comment_client`.

- [ ] **Step 1: Fix the property name**

At `src/services/notification-processor.js` line 208, replace:

```javascript
    ${bk.client_notes ? `<div style="background:#FFFBEB;border-radius:8px;padding:10px 14px;margin:12px 0;border-left:3px solid #F59E0B"><div style="font-size:13px;color:#92700C"><strong>Note du client :</strong> ${escHtml(bk.client_notes)}</div></div>` : ''}`;
```

With:

```javascript
    ${bk.comment_client ? `<div style="background:#FFFBEB;border-radius:8px;padding:10px 14px;margin:12px 0;border-left:3px solid #F59E0B"><div style="font-size:13px;color:#92700C"><strong>Note du client :</strong> ${escHtml(bk.comment_client)}</div></div>` : ''}`;
```

- [ ] **Step 2: Check if `client_notes` is used anywhere else in this file**

Run: `grep -n 'client_notes' src/services/notification-processor.js`

If other occurrences exist, replace them with `comment_client` too.

- [ ] **Step 3: Commit**

```bash
git add src/services/notification-processor.js
git commit -m "fix: show client comment in pro booking notification email

Was using 'client_notes' but DB column is 'comment_client'. Comment
was never visible in the merchant's notification email."
```

---

### Task 5: [M1/M2] Fix GC and pass refund on expired cards/passes

**Files:**
- Modify: `src/services/gift-card-refund.js:44`
- Modify: `src/services/pass-refund.js:21`

**Bug:** When GC/pass has expired between booking and cancellation, balance is re-credited but status stays `expired`. Client can't use the refunded amount.

- [ ] **Step 1: Fix gift-card-refund.js**

At `src/services/gift-card-refund.js` line 44, replace:

```javascript
      `UPDATE gift_cards SET balance_cents = balance_cents + $1, status = CASE WHEN status = 'used' THEN 'active' ELSE status END, updated_at = NOW()
       WHERE id = $2`,
```

With:

```javascript
      `UPDATE gift_cards SET balance_cents = balance_cents + $1, status = CASE WHEN status IN ('used', 'expired') THEN 'active' ELSE status END, updated_at = NOW()
       WHERE id = $2`,
```

- [ ] **Step 2: Fix pass-refund.js**

At `src/services/pass-refund.js` line 21, replace:

```javascript
      `UPDATE passes SET sessions_remaining = sessions_remaining + ABS($1), status = CASE WHEN status = 'used' THEN 'active' ELSE status END, updated_at = NOW() WHERE id = $2`,
```

With:

```javascript
      `UPDATE passes SET sessions_remaining = sessions_remaining + ABS($1), status = CASE WHEN status IN ('used', 'expired') THEN 'active' ELSE status END, updated_at = NOW() WHERE id = $2`,
```

- [ ] **Step 3: Commit**

```bash
git add src/services/gift-card-refund.js src/services/pass-refund.js
git commit -m "fix: reactivate expired gift cards and passes on refund

When a GC or pass expired between booking and cancellation, the balance
was re-credited but status stayed 'expired', making the refund unusable."
```

---

### Task 6: [M3] Fix waitlist manual offer — send email

**Files:**
- Modify: `src/routes/staff/waitlist.js` (around line 258)

- [ ] **Step 1: Read the manual offer route**

Read `src/routes/staff/waitlist.js` from the `POST /:id/offer` handler. Find the TODO comment about sending email.

- [ ] **Step 2: Add email notification**

After the waitlist entry is updated with `offer_token`, `offer_expires_at`, etc., insert a notification into the `notifications` table (same pattern as the auto-offer in `src/services/waitlist.js`):

```javascript
      // Send offer email to client
      const { query: dbQuery } = require('../../services/db');
      await dbQuery(
        `INSERT INTO notifications (id, business_id, type, payload, created_at)
         VALUES (gen_random_uuid(), $1, 'email_waitlist_offer', $2, NOW())`,
        [bid, JSON.stringify({
          booking_id: null,
          waitlist_entry_id: id,
          client_name: entry.client_name,
          client_email: entry.client_email,
          offer_token: token,
          offer_expires_at: expiresAt.toISOString()
        })]
      );
```

Verify the notification type `email_waitlist_offer` exists in the notification processor. If not, check what type the auto-offer uses and use the same one.

- [ ] **Step 3: Commit**

```bash
git add src/routes/staff/waitlist.js
git commit -m "fix: send email on manual waitlist offer

Manual offers had a TODO instead of sending the email. Now queues
the same notification as auto-offers."
```

---

### Task 7: [M4] Fix webhook email — missing LM discount on group services

**Files:**
- Modify: `src/routes/staff/stripe.js:350-366` and `369-386`

**Bug:** The two SQL queries fetching group services for the deposit-paid email don't select `b.discount_pct`. Prices in the email are pre-LM.

- [ ] **Step 1: Add discount_pct to both queries and apply it**

In `src/routes/staff/stripe.js`, for BOTH group service queries (around lines 350-366 and 369-386), add `b.discount_pct` to the SELECT:

Change the SELECT from:
```sql
COALESCE(sv.price_cents, s.price_cents) AS price_cents, b.end_at,
```
To:
```sql
COALESCE(sv.price_cents, s.price_cents) AS price_cents, b.discount_pct, b.end_at,
```

- [ ] **Step 2: Apply the discount after fetching**

After each `groupServices = grp.rows;` assignment (lines 366 and 385), add the discount application:

```javascript
                    groupServices.forEach(r => { if (r.discount_pct && r.price_cents) r.price_cents = Math.round(r.price_cents * (100 - r.discount_pct) / 100); });
```

This matches the pattern used in `deposit.js` line 417.

- [ ] **Step 3: Commit**

```bash
git add src/routes/staff/stripe.js
git commit -m "fix: apply LM discount to group service prices in webhook email

The deposit-paid email via Stripe webhook was showing original prices
instead of LM-discounted prices for multi-service bookings."
```

---

### Task 8: [M5] Add cancel_reason to pro cancellation email

**Files:**
- Modify: `src/services/notification-processor.js:257-270`

- [ ] **Step 1: Add cancel_reason to the email body**

At `src/services/notification-processor.js`, in the `sendCancellationProEmail` function, after the deposit HTML block (line 269, before the closing paragraph), add:

```javascript
    ${bk.cancel_reason ? `<div style="background:#F5F4F1;border-radius:8px;padding:10px 14px;margin:12px 0"><div style="font-size:13px;color:#6B6560"><strong>Raison :</strong> ${escHtml(bk.cancel_reason)}</div></div>` : ''}
```

Insert this between `${depositHTML}` (line 269) and the `<p>Ce créneau est à nouveau disponible` paragraph (line 270). The result should be:

```javascript
    ${depositHTML}
    ${bk.cancel_reason ? `<div style="background:#F5F4F1;border-radius:8px;padding:10px 14px;margin:12px 0"><div style="font-size:13px;color:#6B6560"><strong>Raison :</strong> ${escHtml(bk.cancel_reason)}</div></div>` : ''}
    <p style="font-size:14px;color:#3D3832">Ce cr\u00e9neau est \u00e0 nouveau disponible pour d'autres clients.</p>`;
```

- [ ] **Step 2: Verify `cancel_reason` is available in `bk`**

The notification processor uses `SELECT b.*` which includes `cancel_reason`. Verify by reading `fetchBookingData` in the same file.

- [ ] **Step 3: Commit**

```bash
git add src/services/notification-processor.js
git commit -m "fix: show cancel reason in pro cancellation email

Merchant couldn't see why the client cancelled. Now displays the
cancel_reason if one was provided."
```

---

### Task 9: [M8] Fix deposit-refund manual — handle cs_ session IDs

**Files:**
- Modify: `src/routes/staff/bookings-status.js:985-998`

**Bug:** Manual deposit-refund only handles `pi_` payment intent IDs. But `deposit_payment_intent_id` can be a `cs_` checkout session ID if webhook hasn't resolved it yet.

- [ ] **Step 1: Add cs_ resolution before refund**

At `src/routes/staff/bookings-status.js`, replace lines 985-998:

```javascript
      const piId = bk.rows[0].deposit_payment_intent_id;
      if (piId && piId.startsWith('pi_')) {
        const key = process.env.STRIPE_SECRET_KEY;
        if (!key) return { error: 500, message: 'Stripe non configuré — remboursement impossible' };
        const stripe = require('stripe')(key);
        try {
          await stripe.refunds.create({ payment_intent: piId });
        } catch (stripeErr) {
          // If already refunded on Stripe, continue (idempotent)
          if (stripeErr.code !== 'charge_already_refunded') {
            console.error('[DEPOSIT REFUND] Stripe refund failed:', stripeErr.message);
            return { error: 500, message: 'Erreur Stripe lors du remboursement' };
          }
        }
      }
```

With:

```javascript
      let piId = bk.rows[0].deposit_payment_intent_id;
      if (piId && (piId.startsWith('pi_') || piId.startsWith('cs_'))) {
        const key = process.env.STRIPE_SECRET_KEY;
        if (!key) return { error: 500, message: 'Stripe non configuré — remboursement impossible' };
        const stripe = require('stripe')(key);
        try {
          // Resolve cs_ checkout session to pi_ payment intent
          if (piId.startsWith('cs_')) {
            const session = await stripe.checkout.sessions.retrieve(piId);
            piId = session.payment_intent;
          }
          if (piId && piId.startsWith('pi_')) {
            await stripe.refunds.create({ payment_intent: piId });
          }
        } catch (stripeErr) {
          if (stripeErr.code !== 'charge_already_refunded') {
            console.error('[DEPOSIT REFUND] Stripe refund failed:', stripeErr.message);
            return { error: 500, message: 'Erreur Stripe lors du remboursement' };
          }
        }
      }
```

This matches the pattern already used at lines 447-451 of the same file.

- [ ] **Step 2: Commit**

```bash
git add src/routes/staff/bookings-status.js
git commit -m "fix: handle cs_ checkout session IDs in manual deposit refund

Manual deposit-refund only handled pi_ payment intents. Now resolves
cs_ checkout sessions to pi_ before refunding, matching the pattern
already used in the auto-refund flow."
```

---

### Task 10: Final verification

**Files:** All modified files from Tasks 1-9

- [ ] **Step 1: Run npm run build**

```bash
npm run build
```

Expected: Build succeeds with no errors.

- [ ] **Step 2: Verify no syntax errors in modified backend files**

```bash
node -e "require('./src/routes/staff/bookings-status.js')" 2>&1 | head -5
node -e "require('./src/routes/public/booking-actions.js')" 2>&1 | head -5
node -e "require('./src/services/gift-card-refund.js')" 2>&1 | head -5
node -e "require('./src/services/pass-refund.js')" 2>&1 | head -5
node -e "require('./src/services/notification-processor.js')" 2>&1 | head -5
node -e "require('./src/routes/staff/stripe.js')" 2>&1 | head -5
```

Expected: No syntax errors. Some may fail due to missing env/dependencies — that's OK as long as it's not a SyntaxError.

- [ ] **Step 3: Grep verification — confirm all fixes landed**

```bash
# C1: Staff cancel should NOT have deadline logic
grep -n 'hoursUntilRdv >= cancelDeadlineH' src/routes/staff/bookings-status.js
# Expected: 0 results (removed)

# C2: GC refund should be conditional
grep -n 'shouldRefundGc' src/routes/public/booking-actions.js
# Expected: 2+ results (conditional check)

# E2: comment_client used instead of client_notes
grep -n 'client_notes' src/services/notification-processor.js
# Expected: 0 results (replaced with comment_client)

# M1: expired status handled in GC refund
grep -n "'expired'" src/services/gift-card-refund.js
# Expected: 1 result

# M2: expired status handled in pass refund
grep -n "'expired'" src/services/pass-refund.js
# Expected: 1 result

# M4: discount_pct in stripe webhook
grep -n 'discount_pct' src/routes/staff/stripe.js | head -5
# Expected: results in the group service queries

# M5: cancel_reason in pro email
grep -n 'cancel_reason' src/services/notification-processor.js
# Expected: 1+ result

# M8: cs_ handling in deposit-refund
grep -n "cs_" src/routes/staff/bookings-status.js | grep -i refund
# Expected: 1+ result
```

- [ ] **Step 4: Build + stage dist**

```bash
npm run build && git add -f dist/
```

- [ ] **Step 5: Final commit + push**

```bash
git add -f dist/
git commit -m "chore: rebuild dist after bugfixes"
git push
```
