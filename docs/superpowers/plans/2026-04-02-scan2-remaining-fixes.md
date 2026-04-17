# Scan 2 Remaining Fixes — 8 Bugs

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix 8 bugs from scan 2 — 5 chirurgicaux (validation/cleanup) + 3 enrichissements (promo/pricing logic).

**Architecture:** Surgical edits in existing files. No new files. Each task is independent. Follow existing code patterns.

**Tech Stack:** Node.js/Express, PostgreSQL (pg)

**CRITICAL:** After EACH task, read surrounding code to verify the fix integrates correctly. Do NOT commit without verification.

---

### Task 1: #5 — Staff waitlist add: duplicate email check

**Files:**
- Modify: `src/routes/staff/waitlist.js:85-148`

- [ ] **Step 1: Add duplicate check before INSERT**

After line 114 (`if (svcCheck.rows.length === 0)` block), add:

```javascript
    // Duplicate check: same email already waiting for this practitioner+service
    const dupCheck = await queryWithRLS(bid,
      `SELECT 1 FROM waitlist_entries
       WHERE business_id = $1 AND practitioner_id = $2 AND service_id = $3
         AND client_email = $4 AND status = 'waiting'
       LIMIT 1`,
      [bid, finalPracId, service_id, client_email.toLowerCase().trim()]
    );
    if (dupCheck.rows.length > 0) {
      return res.status(409).json({ error: 'Ce client est déjà en liste d\'attente pour cette prestation' });
    }
```

- [ ] **Step 2: Verify** — confirm `client_email` is available in scope (line 88 destructuring). Confirm the query pattern matches `public/waitlist.js:94-108`.

- [ ] **Step 3: Commit**

```bash
git add src/routes/staff/waitlist.js
git commit -m "fix(#5): add duplicate email check for staff waitlist add"
```

---

### Task 2: #4 — Staff waitlist offer: validate slot availability

**Files:**
- Modify: `src/routes/staff/waitlist.js:220-257`

- [ ] **Step 1: Add validation after entry fetch (line 241)**

After the `entry` fetch and before the token generation (line 243), add:

```javascript
    // Validate dates
    const offerStart = new Date(start_at);
    const offerEnd = new Date(end_at);
    if (isNaN(offerStart.getTime()) || isNaN(offerEnd.getTime())) {
      return res.status(400).json({ error: 'Dates invalides' });
    }
    if (offerStart >= offerEnd) {
      return res.status(400).json({ error: 'La date de début doit être avant la date de fin' });
    }
    if (offerStart.getTime() < Date.now() + 3600000) {
      return res.status(400).json({ error: 'Le créneau doit être au moins 1h dans le futur' });
    }

    // Check slot availability (non-blocking warning — staff can override)
    const wEntry = entry.rows[0];
    const { checkBookingConflicts } = require('./bookings-helpers');
    const conflicts = await checkBookingConflicts(null, {
      bid, pracId: wEntry.practitioner_id,
      newStart: start_at, newEnd: end_at, excludeIds: []
    });
    if (conflicts.length > 0) {
      return res.status(409).json({ error: 'Conflit : un rendez-vous existe déjà sur ce créneau', conflicts: conflicts.length });
    }
```

- [ ] **Step 2: Remove the duplicate `const wEntry = entry.rows[0]`** that exists at the old line 260 (now after our insertion). The variable is already declared above.

Find:
```javascript
    const offerUrl = `${process.env.APP_BASE_URL || process.env.BASE_URL || 'https://genda.be'}/waitlist/${token}`;
    const wEntry = entry.rows[0];
```
Replace with:
```javascript
    const offerUrl = `${process.env.APP_BASE_URL || process.env.BASE_URL || 'https://genda.be'}/waitlist/${token}`;
```

- [ ] **Step 3: Verify** — `checkBookingConflicts` is imported from `./bookings-helpers`. Read the file top to check if it's already imported. If not, add the require at the top of the handler (inside the try block is fine since it's a one-off use).

- [ ] **Step 4: Commit**

```bash
git add src/routes/staff/waitlist.js
git commit -m "fix(#4): validate slot availability and dates for staff waitlist offer"
```

---

### Task 3: #11 — Un-cancel: reset waitlist offers to 'waiting'

**Files:**
- Modify: `src/routes/staff/bookings-status.js` (post-transaction section, after line 565)

- [ ] **Step 1: Add waitlist invalidation when restoring a cancelled booking**

After the waitlist trigger on cancel block (around line 570), add a NEW block for the reverse case:

```javascript
    // Reset active waitlist offers when un-cancelling (cancelled → confirmed)
    // Offers that were sent for the freed slot are no longer valid — reset to 'waiting' so they can be re-offered later
    if (txResult.oldStatus === 'cancelled' && (status === 'confirmed' || status === 'pending_deposit')) {
      try {
        const bkTime = await queryWithRLS(bid,
          `SELECT start_at, end_at, practitioner_id FROM bookings WHERE id = $1 AND business_id = $2`,
          [id, bid]
        );
        if (bkTime.rows.length > 0) {
          const { start_at, end_at, practitioner_id } = bkTime.rows[0];
          await queryWithRLS(bid,
            `UPDATE waitlist_entries SET status = 'waiting', offer_token = NULL,
              offer_booking_start = NULL, offer_booking_end = NULL,
              offer_sent_at = NULL, offer_expires_at = NULL, updated_at = NOW()
             WHERE business_id = $1 AND practitioner_id = $2 AND status = 'offered'
               AND offer_booking_start < $4 AND offer_booking_end > $3`,
            [bid, practitioner_id, start_at, end_at]
          );
        }
      } catch (e) { console.warn('[WAITLIST] Reset offers on un-cancel error:', e.message); }
    }
```

- [ ] **Step 2: Verify** — confirm `txResult.oldStatus` is available (line 557 returns it). Confirm `status` variable is the target status. The time overlap check `start < end AND end > start` catches any slot that overlaps with the restored booking.

- [ ] **Step 3: Commit**

```bash
git add src/routes/staff/bookings-status.js
git commit -m "fix(#11): reset waitlist offers to waiting when un-cancelling a booking"
```

---

### Task 4: #13 — Featured slots cleanup cron

**Files:**
- Modify: `src/server.js` (after the last setInterval block, around line 606)

- [ ] **Step 1: Add daily cleanup cron**

After the notification processor cron block, add:

```javascript
  // ===== FEATURED SLOTS CLEANUP — purge old featured slots daily =====
  setInterval(async () => {
    try {
      const result = await pool.query(
        `DELETE FROM featured_slots WHERE date < CURRENT_DATE - INTERVAL '7 days' RETURNING id`
      );
      if (result.rows.length > 0) {
        console.log(`[FEATURED CLEANUP] Purged ${result.rows.length} old featured slots`);
      }
    } catch (e) {
      console.error('[FEATURED CLEANUP] Error:', e.message);
    }
  }, 24 * 60 * 60 * 1000); // 24h
```

- [ ] **Step 2: Verify** — `pool` is already available in server.js scope. The 7-day retention gives enough history for debugging. The DELETE is safe because `featured_slots` has no FK dependencies.

- [ ] **Step 3: Commit**

```bash
git add src/server.js
git commit -m "fix(#13): add daily cleanup cron for past featured slots"
```

---

### Task 5: #14 — Dashboard clients actifs: unify logic

**Files:**
- Modify: `src/routes/staff/dashboard.js:85-89`

- [ ] **Step 1: Replace the divergent queries with unified logic**

Change:
```javascript
    const clientCount = await queryWithRLS(bid,
      pracFilter
        ? `SELECT COUNT(DISTINCT b.client_id) AS total FROM bookings b WHERE b.business_id = $1 AND b.practitioner_id = $2`
        : `SELECT COUNT(*) AS total FROM clients WHERE business_id = $1`,
      pracFilter ? [bid, pracFilter] : [bid]
    );
```

To:
```javascript
    const clientCount = await queryWithRLS(bid,
      pracFilter
        ? `SELECT COUNT(DISTINCT b.client_id) AS total FROM bookings b WHERE b.business_id = $1 AND b.practitioner_id = $2 AND b.status IN ('confirmed', 'completed')`
        : `SELECT COUNT(DISTINCT b.client_id) AS total FROM bookings b WHERE b.business_id = $1 AND b.status IN ('confirmed', 'completed')`,
      pracFilter ? [bid, pracFilter] : [bid]
    );
```

- [ ] **Step 2: Verify** — both paths now use the same definition: distinct client_ids from confirmed/completed bookings. Excludes imports-sans-booking AND cancelled/no_show.

- [ ] **Step 3: Commit**

```bash
git add src/routes/staff/dashboard.js
git commit -m "fix(#14): unify active clients count — distinct clients from confirmed/completed bookings"
```

---

### Task 6: #3 — Waitlist booking: add LM discount + booked_price_cents

**Files:**
- Modify: `src/routes/public/waitlist.js:300-309`

- [ ] **Step 1: Add LM check + UPDATE after the INSERT**

After the INSERT at line 302-309 and BEFORE the deposit check at line 311, add:

```javascript
      // Apply last-minute discount if within LM window
      const { isWithinLastMinuteWindow } = require('./helpers');
      const wlSvcData = await client.query(
        `SELECT COALESCE(price_cents, 0) AS price_cents, promo_eligible FROM services WHERE id = $1`, [e.service_id]
      );
      const wlSvcPrice = parseInt(wlSvcData.rows[0]?.price_cents) || 0;
      const wlBizForLm = await client.query(`SELECT settings FROM businesses WHERE id = $1`, [e.business_id]);
      const wlSettingsLm = wlBizForLm.rows[0]?.settings || {};
      const lmCheck = isWithinLastMinuteWindow(wlSettingsLm, new Date(e.offer_booking_start));
      let wlDiscountPct = 0;
      let wlBookedPrice = wlSvcPrice;
      if (lmCheck.isLastMinute && wlSvcData.rows[0]?.promo_eligible !== false) {
        wlDiscountPct = lmCheck.discountPct || 0;
        wlBookedPrice = wlDiscountPct > 0 ? Math.round(wlSvcPrice * (100 - wlDiscountPct) / 100) : wlSvcPrice;
      }
      if (wlDiscountPct > 0 || wlBookedPrice > 0) {
        await client.query(
          `UPDATE bookings SET discount_pct = $1, booked_price_cents = $2 WHERE id = $3`,
          [wlDiscountPct || null, wlBookedPrice, bk.rows[0].id]
        );
      }
```

- [ ] **Step 2: Update the `wlPrice` variable** used in the deposit check below (line 318) to use the LM-adjusted price.

Find:
```javascript
      const wlPrice = parseInt(svcPriceWl.rows[0]?.price) || 0;
```
Replace with:
```javascript
      const wlPrice = wlBookedPrice || parseInt(svcPriceWl.rows[0]?.price) || 0;
```

Wait — `svcPriceWl` is fetched AFTER our new code. And `wlBookedPrice` is already computed. We should reuse it. Actually, let me re-read the flow.

Lines 311-319 fetch `svcPriceWl` separately. Since we already fetched the price in our new code, we can reuse `wlBookedPrice` for the deposit calculation. Change line 318:

Find:
```javascript
      const wlPrice = parseInt(svcPriceWl.rows[0]?.price) || 0;
```
Replace with:
```javascript
      const wlPrice = wlBookedPrice || parseInt(svcPriceWl.rows[0]?.price) || 0;
```

- [ ] **Step 3: Verify** — `isWithinLastMinuteWindow` is already used in `src/routes/public/helpers.js` and `src/routes/public/index.js`. Check its signature returns `{ isLastMinute, discountPct }`. The deposit calculation now uses the LM-adjusted price (correct — deposit should be on the discounted price).

- [ ] **Step 4: Commit**

```bash
git add src/routes/public/waitlist.js
git commit -m "fix(#3): apply last-minute discount + booked_price_cents on waitlist bookings"
```

---

### Task 7: #6 — group-remove: re-validate promo condition

**Files:**
- Modify: `src/routes/staff/bookings-ungroup.js:398-448`

- [ ] **Step 1: Add condition validation before recalculating discount**

The existing code (line 398-448) recalculates the promo discount amount but never checks if the condition is still met. Add the condition check BEFORE the recalculation.

After line 405 (`if (promoRes.rows.length > 0) {`), before line 406 (`const promo = promoRes.rows[0];`), insert:

```javascript
            const promo = promoRes.rows[0];

            // Re-validate promo condition before recalculating
            let conditionStillMet = true;
            if (promo.condition_type === 'min_amount' && promo.condition_min_cents) {
              conditionStillMet = newGroupTotal >= promo.condition_min_cents;
            } else if (promo.condition_type === 'specific_service' && promo.condition_service_id) {
              conditionStillMet = remaining.some(m => m.service_id === promo.condition_service_id);
            }

            if (!conditionStillMet) {
              // Condition no longer met — invalidate promo on all remaining members
              for (const m of remaining) {
                await client.query(
                  `UPDATE bookings SET promotion_id = NULL, promotion_label = NULL,
                    promotion_discount_pct = NULL, promotion_discount_cents = NULL, updated_at = NOW()
                   WHERE id = $1 AND business_id = $2`,
                  [m.id, bid]
                );
              }
            } else {
```

Then the existing recalculation code (lines 407-447) becomes the `else` branch. Close it with `}` after line 446 (before the existing closing `}`).

Wait — this is getting complex with the nesting. Let me write it differently. Replace the entire block from line 405 to line 447:

Find (the section starting after `if (promoRes.rows.length > 0) {`):
```javascript
          if (promoRes.rows.length > 0) {
            const promo = promoRes.rows[0];
            if (promo.reward_type === 'discount_pct') {
```

The simplest approach: add the condition check right after `const promo = promoRes.rows[0];` and if not met, set `newPromoCents = 0` (which triggers the invalidation at line 438-445). No need to restructure.

- [ ] **Step 1 (revised): Insert condition check after promo fetch**

After the existing `const promo = promoRes.rows[0];` (line 406), add:

```javascript
            // Re-validate promo condition — if no longer met, force invalidation
            if (promo.condition_type === 'min_amount' && promo.condition_min_cents && newGroupTotal < promo.condition_min_cents) {
              newPromoCents = -1; // sentinel: force invalidation below
            } else if (promo.condition_type === 'specific_service' && promo.condition_service_id && !remaining.some(m => m.service_id === promo.condition_service_id)) {
              newPromoCents = -1; // sentinel: force invalidation below
            } else if (promo.reward_type === 'discount_pct') {
```

Then at the invalidation check (line 438), change `if (newPromoCents > 0)` to `if (newPromoCents > 0)` (no change needed — `-1` is not `> 0`, so it falls into the else which clears the promo). The existing logic already handles it.

Wait — the `else if` at line 407 needs to be handled. Let me re-read more carefully.

Actually, the cleanest fix: just add the condition check right after `const promo = promoRes.rows[0];` and SKIP the reward calculation entirely if condition fails:

After line 406 (`const promo = promoRes.rows[0];`), add:
```javascript
            // Re-validate promo condition before recalculating amount
            if (
              (promo.condition_type === 'min_amount' && promo.condition_min_cents && newGroupTotal < promo.condition_min_cents) ||
              (promo.condition_type === 'specific_service' && promo.condition_service_id && !remaining.some(m => m.service_id === promo.condition_service_id))
            ) {
              // Condition no longer met — skip recalculation, newPromoCents stays 0 → invalidation below
            } else if (promo.reward_type === 'discount_pct') {
```

And remove the existing `if (promo.reward_type === 'discount_pct') {` at line 407 since it's now the `else if`.

- [ ] **Step 2: Verify** — when condition fails, `newPromoCents` stays 0 (initialized at line 400). The code at line 432-446 already handles `newPromoCents === 0` by clearing all promo fields. Existing logic works as-is.

- [ ] **Step 3: Commit**

```bash
git add src/routes/staff/bookings-ungroup.js
git commit -m "fix(#6): re-validate promo condition (min_amount, specific_service) on group-remove"
```

---

### Task 8: #12 — group-add: recalculate promo/deposit

**Files:**
- Modify: `src/routes/staff/bookings-ungroup.js` (group-add handler, after the INSERT + audit log)

- [ ] **Step 1: Add promo recalculation after INSERT**

After the audit log block (around line 820), add:

```javascript
        // Recalculate promo if group has one
        const promoCarrier = await client.query(
          `SELECT id, promotion_id, promotion_label FROM bookings
           WHERE group_id = $1 AND business_id = $2 AND promotion_id IS NOT NULL LIMIT 1`,
          [booking.group_id, bid]
        );
        if (promoCarrier.rows.length > 0) {
          const promoId = promoCarrier.rows[0].promotion_id;
          const promoRes = await client.query(`SELECT * FROM promotions WHERE id = $1`, [promoId]);
          if (promoRes.rows.length > 0) {
            const promo = promoRes.rows[0];
            // Fetch updated group total
            const grpTotal = await client.query(
              `SELECT COALESCE(SUM(COALESCE(b.booked_price_cents, sv.price_cents, s.price_cents, 0)), 0) AS total
               FROM bookings b LEFT JOIN services s ON s.id = b.service_id
               LEFT JOIN service_variants sv ON sv.id = b.service_variant_id
               WHERE b.group_id = $1 AND b.business_id = $2 AND b.status NOT IN ('cancelled')`,
              [booking.group_id, bid]
            );
            const newTotal = parseInt(grpTotal.rows[0].total) || 0;
            let newDisc = 0;
            if (promo.reward_type === 'discount_pct') {
              newDisc = Math.round(newTotal * promo.reward_value / 100);
            } else if (promo.reward_type === 'discount_fixed') {
              newDisc = Math.min(promo.reward_value, newTotal);
            }
            if (newDisc > 0) {
              await client.query(
                `UPDATE bookings SET promotion_discount_cents = $1, updated_at = NOW()
                 WHERE id = $2 AND business_id = $3`,
                [newDisc, promoCarrier.rows[0].id, bid]
              );
            }
          }
        }

        // Recalculate deposit if applicable
        if (booking.deposit_required && booking.deposit_status === 'pending') {
          const grpTotalDep = await client.query(
            `SELECT COALESCE(SUM(COALESCE(b.booked_price_cents, sv.price_cents, s.price_cents, 0)), 0) AS total
             FROM bookings b LEFT JOIN services s ON s.id = b.service_id
             LEFT JOIN service_variants sv ON sv.id = b.service_variant_id
             WHERE b.group_id = $1 AND b.business_id = $2 AND b.status NOT IN ('cancelled')`,
            [booking.group_id, bid]
          );
          const newTotalDep = parseInt(grpTotalDep.rows[0].total) || 0;
          const bizForDep = await client.query(`SELECT settings FROM businesses WHERE id = $1`, [bid]);
          const depSettings = bizForDep.rows[0]?.settings || {};
          let newDepCents;
          if (depSettings.deposit_type === 'fixed') {
            newDepCents = Math.min(depSettings.deposit_fixed_cents || 2500, newTotalDep);
          } else {
            newDepCents = Math.round(newTotalDep * (depSettings.deposit_percent || 50) / 100);
            newDepCents = Math.min(newDepCents, newTotalDep);
          }
          if (newDepCents > 0) {
            await client.query(
              `UPDATE bookings SET deposit_amount_cents = $1, updated_at = NOW()
               WHERE group_id = $2 AND business_id = $3 AND deposit_required = true`,
              [newDepCents, booking.group_id, bid]
            );
          }
        }
```

- [ ] **Step 2: Verify** — `booking.deposit_required` and `booking.deposit_status` are available from the initial booking fetch. The promo recalculation follows the same pattern as `group-remove`. The deposit recalculation mirrors `shouldRequireDeposit` in helpers.js. Only recalculates if deposit is still pending (not already paid).

- [ ] **Step 3: Commit**

```bash
git add src/routes/staff/bookings-ungroup.js
git commit -m "fix(#12): recalculate promo discount + deposit amount on group-add"
```

---

### Task 9: Build + verify + push

- [ ] **Step 1: Build**

```bash
cd /Users/Hakim/Desktop/bookt && npm run build
```

- [ ] **Step 2: Stage + commit + push**

```bash
git add -f dist/
git commit -m "build: update dist after scan 2 remaining fixes"
git push origin main
```
