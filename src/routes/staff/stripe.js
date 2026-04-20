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
const { requireAuth, requireOwner, blockIfImpersonated } = require('../../middleware/auth');

function getStripe() {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return null;
  return require('stripe')(key);
}

const PLAN_PRICES = {
  pro: () => process.env.STRIPE_PRICE_PRO
};

const PRICE_TO_PLAN = {};
// Built dynamically on first call
function getPriceToPlan() {
  if (Object.keys(PRICE_TO_PLAN).length === 0) {
    const pro = process.env.STRIPE_PRICE_PRO;
    if (pro) PRICE_TO_PLAN[pro] = 'pro';
  }
  return PRICE_TO_PLAN;
}

// ============================================================
// POST /api/stripe/checkout — Create Stripe Checkout Session
// Body: { plan: 'pro' }
// ============================================================
router.post('/checkout', requireAuth, requireOwner, blockIfImpersonated, async (req, res, next) => {
  try {
    const stripe = getStripe();
    if (!stripe) return res.status(503).json({ error: 'Stripe non configuré. Contactez le support.' });

    const bid = req.businessId;
    const { plan } = req.body;

    if (!plan || !PLAN_PRICES[plan]) {
      return res.status(400).json({ error: 'Plan invalide.' });
    }

    const priceId = PLAN_PRICES[plan]();
    if (!priceId) {
      return res.status(500).json({ error: `Prix Stripe non configuré pour le plan ${plan}.` });
    }

    // Get business + user info
    const bizResult = await query(
      `SELECT b.id, b.name, b.email, b.stripe_customer_id, b.plan AS current_plan,
              u.email AS owner_email
       FROM businesses b
       JOIN users u ON u.business_id = b.id AND u.role = 'owner'
       WHERE b.id = $1
       LIMIT 1`,
      [bid]
    );
    const biz = bizResult.rows[0];
    if (!biz) return res.status(404).json({ error: 'Business non trouvé.' });

    // Already subscribed?
    if (biz.current_plan === plan) {
      return res.status(400).json({ error: `Vous êtes déjà sur le plan ${plan}.` });
    }

    // Create or retrieve Stripe customer
    let customerId = biz.stripe_customer_id;
    if (!customerId) {
      const customer = await stripe.customers.create({
        email: biz.owner_email || biz.email,
        name: biz.name,
        metadata: { business_id: bid }
      });
      customerId = customer.id;

      await query(
        `UPDATE businesses SET stripe_customer_id = $1 WHERE id = $2`,
        [customerId, bid]
      );
    }

    // Determine trial eligibility: only if business has NEVER had a subscription before
    const trialDays = parseInt(process.env.TRIAL_DAYS, 10) || 14;
    const hadSubBefore = await query(
      `SELECT stripe_subscription_id, plan_changed_at FROM businesses WHERE id = $1`,
      [bid]
    );
    const isEligibleForTrial = !hadSubBefore.rows[0]?.plan_changed_at && !hadSubBefore.rows[0]?.stripe_subscription_id;

    // Create Checkout Session
    const baseUrl = process.env.APP_BASE_URL || 'https://genda.be';

    const sessionParams = {
      customer: customerId,
      mode: 'subscription',
      payment_method_types: ['card'],
      line_items: [{
        price: priceId,
        quantity: 1
      }],
      subscription_data: {
        metadata: { business_id: bid, plan },
        ...(isEligibleForTrial && trialDays > 0 ? { trial_period_days: trialDays } : {})
      },
      success_url: `${baseUrl}/dashboard?subscription=success&plan=${plan}`,
      cancel_url: `${baseUrl}/dashboard?subscription=cancel`,
      locale: 'fr',
      allow_promotion_codes: true,
      billing_address_collection: 'required',
      tax_id_collection: { enabled: true },
      customer_update: { name: 'auto', address: 'auto' },
      automatic_tax: { enabled: true },
      metadata: { business_id: bid, plan }
    };

    // P1-stripe-idem : bucket 30s par biz + plan — dedupe double-clic
    // "souscrire au plan Pro". Retry légitime après 30s = nouveau bucket,
    // nouvelle session (ex: user reload page dashboard).
    const _idemSub = `sub-checkout-${bid}-${plan}-${Math.floor(Date.now() / 30000)}`;
    const session = await stripe.checkout.sessions.create(sessionParams, { idempotencyKey: _idemSub });

    res.json({ url: session.url, session_id: session.id });
  } catch (err) {
    console.error('[STRIPE] Checkout error:', err);
    next(err);
  }
});

// ============================================================
// POST /api/stripe/portal — Customer Portal (manage billing)
// ============================================================
router.post('/portal', requireAuth, requireOwner, blockIfImpersonated, async (req, res, next) => {
  try {
    const stripe = getStripe();
    if (!stripe) return res.status(503).json({ error: 'Stripe non configuré.' });

    const bid = req.businessId;
    const bizResult = await query(
      `SELECT stripe_customer_id FROM businesses WHERE id = $1`, [bid]
    );
    const customerId = bizResult.rows[0]?.stripe_customer_id;

    if (!customerId) {
      return res.status(400).json({ error: 'Aucun abonnement actif.' });
    }

    const baseUrl = process.env.APP_BASE_URL || 'https://genda.be';
    const session = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: `${baseUrl}/dashboard`
    });

    res.json({ url: session.url });
  } catch (err) {
    console.error('[STRIPE] Portal error:', err);
    next(err);
  }
});

// ============================================================
// GET /api/stripe/status — Current subscription status
// ============================================================
router.get('/status', requireAuth, async (req, res, next) => {
  try {
    const bid = req.businessId;
    const result = await query(
      `SELECT plan, subscription_status, trial_ends_at, stripe_subscription_id,
              stripe_customer_id
       FROM businesses WHERE id = $1`,
      [bid]
    );
    const b = result.rows[0];
    if (!b) return res.status(404).json({ error: 'Business non trouvé.' });

    const isTrialing = b.subscription_status === 'trialing' && b.trial_ends_at && new Date(b.trial_ends_at) > new Date();
    const trialDaysLeft = isTrialing
      ? Math.ceil((new Date(b.trial_ends_at) - new Date()) / (1000 * 60 * 60 * 24))
      : 0;

    res.json({
      plan: b.plan,
      subscription_status: b.subscription_status,
      is_trialing: isTrialing,
      trial_days_left: trialDaysLeft,
      trial_ends_at: b.trial_ends_at,
      has_subscription: !!b.stripe_subscription_id,
      has_customer: !!b.stripe_customer_id
    });
  } catch (err) { next(err); }
});

// ============================================================
// POST /webhooks/stripe — Stripe Webhook Handler
// IMPORTANT: This is mounted BEFORE express.json() in server.js
// ============================================================
async function handleStripeWebhook(req, res) {
  const stripe = getStripe();
  if (!stripe) return res.status(503).send('Stripe not configured');

  const sig = req.headers['stripe-signature'];
  const secret = process.env.STRIPE_WEBHOOK_SECRET;

  // V11-023: Ensure webhook secret is configured before processing
  if (!secret) {
    console.error('[STRIPE WH] STRIPE_WEBHOOK_SECRET not configured');
    return res.status(500).send('Webhook secret not configured');
  }

  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, sig, secret);
  } catch (err) {
    console.error('[STRIPE WH] Signature verification failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  console.log(`[STRIPE WH] ${event.type} (id=${event.id})`);

  // BUG-G fix: idempotence by event.id — prevents double-processing of
  // replayed/retried webhooks (Stripe retries on any non-2xx, and dashboard
  // replay button). Required especially for charge.refunded which currently
  // cascades cancel + emails + refund GC/pass on every delivery.
  let _idemClaimed = false;
  try {
    const idemRes = await query(
      `INSERT INTO stripe_webhook_events (event_id, event_type) VALUES ($1, $2)
       ON CONFLICT (event_id) DO NOTHING RETURNING event_id`,
      [event.id, event.type]
    );
    if (idemRes.rows.length === 0) {
      console.log(`[STRIPE WH] Duplicate event ${event.id} (${event.type}) — already processed, returning 200`);
      return res.json({ received: true, duplicate: true });
    }
    _idemClaimed = true;
  } catch (idemErr) {
    // If the table is missing (pre-v72 deploy) or DB blip, log and proceed —
    // fall back to the per-handler duplicate detection already in place.
    console.warn('[STRIPE WH] Idempotence check failed (proceeding anyway):', idemErr.message);
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object;

        // ===== DEPOSIT PAYMENT =====
        if (session.metadata?.type === 'deposit') {
          const bookingId = session.metadata.booking_id;
          const businessId = session.metadata.business_id;
          const bookingToken = session.metadata.booking_token;
          if (!bookingId || !businessId) break;

          const piId = session.payment_intent || null;
          // ST-6: Log amount mismatch as warning (don't block — payment already captured)
          // Subtract GC amount to avoid false positives when GC partially covers deposit
          const paidAmountCents = session.amount_total || 0;
          const expectedRes = await query(
            `SELECT b.deposit_amount_cents, COALESCE(SUM(gct.amount_cents), 0) AS gc_paid
             FROM bookings b LEFT JOIN gift_card_transactions gct ON gct.booking_id = b.id AND gct.type = 'debit'
             WHERE b.id = $1 GROUP BY b.deposit_amount_cents`, [bookingId]);
          const expectedCents = (expectedRes.rows[0]?.deposit_amount_cents || 0) - (parseInt(expectedRes.rows[0]?.gc_paid) || 0);
          if (paidAmountCents > 0 && expectedCents > 0 && Math.abs(paidAmountCents - expectedCents) > 100) {
            console.warn(`[STRIPE WH] AMOUNT MISMATCH: booking ${bookingId} expected ${expectedCents}c (after GC), paid ${paidAmountCents}c`);
          }
          console.log(`[STRIPE WH] Deposit paid for booking ${bookingId} (PI: ${piId}, amount: ${paidAmountCents}c)`);

          // Update booking + group siblings + detached bookings atomically in a transaction
          const txClient = await pool.connect();
          let upd, linkedIds = [];
          try {
            await txClient.query('BEGIN');

            // Update booking: pending_deposit → confirmed, deposit_status → paid
            upd = await txClient.query(
              `UPDATE bookings SET
                status = 'confirmed',
                locked = true,
                deposit_status = 'paid',
                deposit_paid_at = NOW(),
                deposit_payment_intent_id = COALESCE($1, deposit_payment_intent_id),
                deposit_deadline = NULL
               WHERE id = $2 AND business_id = $3 AND status = 'pending_deposit'
               RETURNING id, business_id, group_id, client_id`,
              [piId, bookingId, businessId]
            );

            if (upd.rows.length > 0) {
              const bk = upd.rows[0];

              // Propagate to group siblings AND ungrouped bookings sharing same deposit
              // (handles case where bookings were ungrouped/reassigned after deposit request)

              // 1. Group siblings (still in same group)
              if (bk.group_id) {
                const grpUpd = await txClient.query(
                  `UPDATE bookings SET status = 'confirmed', locked = true, deposit_status = 'paid',
                    deposit_paid_at = NOW(), deposit_deadline = NULL
                   WHERE group_id = $1 AND business_id = $2 AND id != $3 AND status = 'pending_deposit'
                   RETURNING id`,
                  [bk.group_id, businessId, bookingId]
                );
                grpUpd.rows.forEach(r => linkedIds.push(r.id));
              }

              // 2. Ungrouped bookings sharing same deposit_payment_intent_id (detached after deposit request)
              if (piId) {
                const detachedUpd = await txClient.query(
                  `UPDATE bookings SET status = 'confirmed', locked = true, deposit_status = 'paid',
                    deposit_paid_at = NOW(), deposit_deadline = NULL
                   WHERE deposit_payment_intent_id = $1 AND business_id = $2 AND id != $3
                     AND status = 'pending_deposit' AND group_id IS DISTINCT FROM $4
                   RETURNING id`,
                  [piId, businessId, bookingId, bk.group_id]
                );
                detachedUpd.rows.forEach(r => linkedIds.push(r.id));
              }
            }

            await txClient.query('COMMIT');
          } catch (txErr) {
            await txClient.query('ROLLBACK').catch(() => {});
            console.error('[STRIPE WH] Deposit transaction failed:', txErr);
            break;
          } finally {
            txClient.release();
          }

          if (upd.rows.length > 0) {
            const bk = upd.rows[0];

            // SSE broadcast to update calendar in real-time
            try {
              const { broadcast } = require('../../services/sse');
              broadcast(businessId, 'booking_update', { action: 'deposit_paid', booking_id: bookingId });
              for (const lid of linkedIds) {
                broadcast(businessId, 'booking_update', { action: 'deposit_paid', booking_id: lid });
              }
            } catch (e) { /* SSE optional */ }

            // CalSync push for primary + all linked
            try {
              const { calSyncPush } = require('../staff/bookings-helpers');
              calSyncPush(businessId, bookingId);
              for (const lid of linkedIds) {
                calSyncPush(businessId, lid);
              }
            } catch (_) { /* calSync best-effort */ }

            // Send confirmation email to client
            try {
              const bkData = await query(
                `SELECT b.start_at, b.end_at, b.deposit_amount_cents, b.group_id, b.public_token,
                        b.business_id, b.booked_price_cents, b.discount_pct,
                        b.promotion_label, b.promotion_discount_cents, b.promotion_discount_pct,
                        c.full_name AS client_name, c.email AS client_email, c.phone AS client_phone,
                        CASE WHEN sv.name IS NOT NULL THEN s.name || ' — ' || sv.name ELSE s.name END AS service_name,
                        s.category AS service_category,
                        COALESCE(sv.price_cents, s.price_cents, 0) AS service_price_cents,
                        COALESCE(sv.duration_min, s.duration_min) AS duration_min,
                        p.display_name AS practitioner_name,
                        biz.name AS business_name, biz.email AS business_email,
                        biz.phone AS business_phone,
                        biz.address AS business_address, biz.theme, biz.slug,
                        biz.settings AS business_settings
                 FROM bookings b
                 LEFT JOIN clients c ON c.id = b.client_id
                 LEFT JOIN services s ON s.id = b.service_id
                 LEFT JOIN service_variants sv ON sv.id = b.service_variant_id
                 LEFT JOIN practitioners p ON p.id = b.practitioner_id
                 JOIN businesses biz ON biz.id = b.business_id
                 WHERE b.id = $1`,
                [bookingId]
              );
              if (bkData.rows.length > 0 && bkData.rows[0].client_email) {
                const d = bkData.rows[0];
                // Fetch group services for multi-service bookings
                let groupServices = null;
                // Collect all linked services: group siblings + detached bookings with same deposit
                const allLinkedIds = [bookingId, ...linkedIds];
                if (allLinkedIds.length > 1) {
                  const grp = await query(
                    `SELECT CASE WHEN sv.name IS NOT NULL THEN COALESCE(s.category || ' - ', '') || s.name || ' \u2014 ' || sv.name ELSE COALESCE(s.category || ' - ', '') || s.name END AS name,
                            COALESCE(sv.duration_min, s.duration_min) AS duration_min,
                            COALESCE(sv.price_cents, s.price_cents) AS price_cents, b.discount_pct, b.end_at,
                            b.practitioner_id, p.display_name AS practitioner_name
                     FROM bookings b
                     LEFT JOIN services s ON s.id = b.service_id
                     LEFT JOIN service_variants sv ON sv.id = b.service_variant_id
                     LEFT JOIN practitioners p ON p.id = b.practitioner_id
                     WHERE b.id = ANY($1) AND b.business_id = $2
                     ORDER BY b.start_at`,
                    [allLinkedIds, businessId]
                  );
                  if (grp.rows.length > 1) {
                    const _pIds = new Set(grp.rows.map(r => r.practitioner_id));
                    if (_pIds.size <= 1) grp.rows.forEach(r => { r.practitioner_name = null; });
                    groupServices = grp.rows;
                    groupServices.forEach(r => { if (r.discount_pct && r.price_cents) { r.original_price_cents = r.price_cents; r.price_cents = Math.round(r.price_cents * (100 - r.discount_pct) / 100); } });
                  }
                } else if (d.group_id) {
                  const grp = await query(
                    `SELECT CASE WHEN sv.name IS NOT NULL THEN COALESCE(s.category || ' - ', '') || s.name || ' \u2014 ' || sv.name ELSE COALESCE(s.category || ' - ', '') || s.name END AS name,
                            COALESCE(sv.duration_min, s.duration_min) AS duration_min,
                            COALESCE(sv.price_cents, s.price_cents) AS price_cents, b.discount_pct, b.end_at,
                            b.practitioner_id, p.display_name AS practitioner_name
                     FROM bookings b
                     LEFT JOIN services s ON s.id = b.service_id
                     LEFT JOIN service_variants sv ON sv.id = b.service_variant_id
                     LEFT JOIN practitioners p ON p.id = b.practitioner_id
                     WHERE b.group_id = $1 AND b.business_id = $2
                     ORDER BY b.group_order, b.start_at`,
                    [d.group_id, businessId]
                  );
                  if (grp.rows.length > 1) {
                    const _pIds = new Set(grp.rows.map(r => r.practitioner_id));
                    if (_pIds.size <= 1) grp.rows.forEach(r => { r.practitioner_name = null; });
                    groupServices = grp.rows;
                    groupServices.forEach(r => { if (r.discount_pct && r.price_cents) { r.original_price_cents = r.price_cents; r.price_cents = Math.round(r.price_cents * (100 - r.discount_pct) / 100); } });
                  }
                }
                if (groupServices) d.end_at = groupServices[groupServices.length - 1].end_at;
                const { getGcPaidCents } = require('../../services/gift-card-refund');
                d.gc_paid_cents = await getGcPaidCents(bookingId);
                const { sendDepositPaidEmail, sendDepositPaidProEmail } = require('../../services/email');
                await sendDepositPaidEmail({
                  booking: d,
                  business: { id: d.business_id, name: d.business_name, email: d.business_email, phone: d.business_phone, address: d.business_address, theme: d.theme, slug: d.slug, settings: d.business_settings },
                  groupServices
                });
                sendDepositPaidProEmail({
                  booking: d,
                  business: { id: d.business_id, name: d.business_name, email: d.business_email, theme: d.theme }
                }).catch(e => console.warn('[STRIPE WH] Pro deposit email error:', e.message));
              }
            } catch (emailErr) {
              console.error('[STRIPE WH] Deposit confirmation email failed:', emailErr.message);
            }

            // Log notification
            try {
              await query(
                `INSERT INTO notifications (business_id, booking_id, type, status, sent_at)
                 VALUES ($1, $2, 'deposit_paid_webhook', 'sent', NOW())`,
                [businessId, bookingId]
              );
            } catch (logErr) { /* non-critical */ }
          } else {
            // UPDATE returned 0 rows — either already confirmed (duplicate webhook),
            // parallel payment (GC+Stripe race across 2 tabs), or truly cancelled.
            const currentCheck = await query(`SELECT status, deposit_status, deposit_payment_intent_id FROM bookings WHERE id = $1`, [bookingId]);
            const cur = currentCheck.rows[0];
            if (cur && (cur.status === 'confirmed' || cur.deposit_status === 'paid')) {
              // BUG-G fix: distinguish TRUE duplicate (same PI) from PARALLEL payment
              // (different PI — client paid via GC in tab A and Stripe in tab B).
              // Parallel payment → auto-refund the incoming Stripe PI so the salon
              // doesn't keep money the client paid twice.
              const storedPi = cur.deposit_payment_intent_id;
              const paidByGcOrPass = !!(storedPi && (storedPi.startsWith('gc_') || storedPi.startsWith('pass_')));
              let resolvedStoredPi = storedPi;
              if (storedPi && storedPi.startsWith('cs_')) {
                try {
                  const _sess = await stripe.checkout.sessions.retrieve(storedPi);
                  resolvedStoredPi = _sess.payment_intent || storedPi;
                } catch (_) { /* ignore — can't resolve, fall through */ }
              }
              const differentPi = !paidByGcOrPass && resolvedStoredPi && piId && resolvedStoredPi !== piId;
              if (paidByGcOrPass || differentPi) {
                console.warn(`[STRIPE WH] PARALLEL PAYMENT for booking ${bookingId}: already paid via ${storedPi}, incoming PI ${piId} — auto-refunding the duplicate`);
                try {
                  if (piId && piId.startsWith('pi_')) {
                    const { createRefund: _cr } = require('../../services/stripe-refund');
                    await _cr(stripe, { payment_intent: piId }, `wh-parallel-refund-${piId}`);
                    console.log(`[STRIPE WH] Parallel-payment auto-refund successful for PI ${piId}`);
                  }
                  try {
                    await query(
                      `INSERT INTO notifications (business_id, booking_id, type, status, metadata)
                       VALUES ($1, $2, 'email_deposit_orphan', 'queued', $3)`,
                      [businessId, bookingId, JSON.stringify({ payment_intent: piId, auto_refunded: true, reason: 'parallel_payment', stored_pi: storedPi })]
                    );
                  } catch (_) {}
                } catch (refundErr) {
                  if (refundErr.code !== 'charge_already_refunded') {
                    console.error(`[STRIPE WH] Parallel-payment refund FAILED for PI ${piId}:`, refundErr.message);
                  }
                }
              } else {
                console.log(`[STRIPE WH] Duplicate deposit webhook for booking ${bookingId} (status: ${cur.status}, deposit: ${cur.deposit_status}) — ignoring`);
              }
            } else {
              // Booking was truly cancelled/expired — auto-refund the orphaned payment
              console.warn(`[STRIPE WH] Deposit payment for cancelled booking ${bookingId} — initiating auto-refund`);
              try {
                if (piId && piId.startsWith('pi_')) {
                  const { createRefund: _cr } = require('../../services/stripe-refund');
                  await _cr(stripe, { payment_intent: piId }, `wh-orphan-refund-${piId}`);
                  console.log(`[STRIPE WH] Auto-refund successful for orphaned payment PI ${piId}`);
                }
                try {
                  await query(
                    `INSERT INTO notifications (business_id, booking_id, type, status, metadata)
                     VALUES ($1, $2, 'email_deposit_orphan', 'queued', $3)`,
                    [businessId, bookingId, JSON.stringify({ payment_intent: piId, auto_refunded: true })]
                  );
                } catch (_) {}
              } catch (refundErr) {
                if (refundErr.code !== 'charge_already_refunded') {
                  console.error(`[STRIPE WH] Auto-refund FAILED for orphaned payment:`, refundErr.message);
                }
                try {
                  await query(
                    `INSERT INTO notifications (business_id, booking_id, type, status, metadata)
                     VALUES ($1, $2, 'email_deposit_orphan', 'queued', $3)`,
                    [businessId, bookingId, JSON.stringify({ payment_intent: piId, auto_refunded: refundErr.code === 'charge_already_refunded', error: refundErr.message })]
                  );
                } catch (_) {}
              }
            }
          }
          break;
        }

        // ===== GIFT CARD PAYMENT =====
        if (session.metadata?.type === 'gift_card') {
          const bizId = session.metadata.business_id;
          const amountCents = parseInt(session.metadata.amount_cents);
          if (!bizId || !amountCents) break;

          const piId = session.payment_intent || session.id;
          console.log(`[STRIPE WH] Gift card purchased for business ${bizId} (${amountCents}c, PI: ${piId})`);

          // Idempotency guard — Stripe may deliver the same event multiple times
          const existingGC = await query('SELECT id FROM gift_cards WHERE stripe_payment_intent_id = $1', [piId]);
          if (existingGC.rows.length > 0) {
            console.log(`[STRIPE WH] GC already created for PI ${piId}, skipping duplicate`);
            break;
          }

          try {
            const { generateCode } = require('./gift-cards');
            let code, codeIsUnique = false;
            for (let i = 0; i < 10; i++) {
              code = generateCode();
              const exists = await query('SELECT 1 FROM gift_cards WHERE code = $1', [code]);
              if (exists.rows.length === 0) { codeIsUnique = true; break; }
            }
            if (!codeIsUnique) {
              console.error('[STRIPE WH] Failed to generate unique gift card code after 10 attempts — initiating refund');
              if (piId && piId.startsWith('pi_')) {
                try {
                  const { createRefund: _cr } = require('../../services/stripe-refund');
                  await _cr(stripe, { payment_intent: piId }, `wh-gc-gen-refund-${piId}`);
                  console.log(`[STRIPE WH] Auto-refunded PI ${piId} for failed gift card code generation`);
                } catch (refundErr) {
                  console.error(`[STRIPE WH] Auto-refund failed for PI ${piId}:`, refundErr.message);
                }
              }
              break;
            }

            const bizResult = await query('SELECT id, name, slug, theme, email, settings FROM businesses WHERE id = $1', [bizId]);
            const biz = bizResult.rows[0];
            const days = biz?.settings?.giftcard_expiry_days || 365;
            const expiresAt = new Date(Date.now() + days * 86400000);

            // BUG-IDEMPOTENCE fix: UNIQUE partial index uq_gc_stripe_pi (schema-v73) protects
            // against duplicate INSERT on concurrent webhook deliveries. ON CONFLICT DO NOTHING
            // makes the 2nd call a silent no-op (RETURNING returns 0 rows → we skip).
            const gc = await query(
              `INSERT INTO gift_cards (business_id, code, amount_cents, balance_cents,
               buyer_name, buyer_email, recipient_name, recipient_email, message,
               stripe_payment_intent_id, expires_at)
               VALUES ($1, $2, $3, $3, $4, $5, $6, $7, $8, $9, $10)
               ON CONFLICT (stripe_payment_intent_id) WHERE stripe_payment_intent_id IS NOT NULL DO NOTHING
               RETURNING *`,
              // BUG-GC-EMAIL-LOWER fix: normalize emails to lowercase at INSERT so auto-debit
              // lookups (WHERE LOWER(recipient_email) = LOWER($x)) remain consistent even si
              // Stripe/clients saisissent la casse différemment.
              [bizId, code, amountCents,
               session.metadata.buyer_name || null, session.metadata.buyer_email ? String(session.metadata.buyer_email).toLowerCase() : null,
               session.metadata.recipient_name || null, session.metadata.recipient_email ? String(session.metadata.recipient_email).toLowerCase() : null,
               session.metadata.message || null, piId, expiresAt]
            );
            if (gc.rows.length === 0) {
              console.log(`[STRIPE WH] GC INSERT conflict for PI ${piId} (race with concurrent webhook), skipping.`);
              break;
            }

            await query(
              `INSERT INTO gift_card_transactions (gift_card_id, business_id, amount_cents, type, note)
               VALUES ($1, $2, $3, 'purchase', 'Achat en ligne')`,
              [gc.rows[0].id, bizId, amountCents]
            );

            const giftCard = gc.rows[0];

            // Auto-create recipient as client if not exists
            if (giftCard.recipient_email) {
              try {
                const existingClient = await query(
                  `SELECT id FROM clients WHERE business_id = $1 AND LOWER(email) = LOWER($2)`,
                  [bizId, giftCard.recipient_email]
                );
                if (existingClient.rows.length === 0) {
                  // clients.source column doesn't exist — correct column is `created_from`
                  // with CHECK ('booking' | 'manual' | 'call'). Use 'manual' (gift-card purchase
                  // = merchant-side creation, not a real booking, closest to 'manual').
                  await query(
                    `INSERT INTO clients (id, business_id, full_name, email, created_from, created_at, updated_at)
                     VALUES (gen_random_uuid(), $1, $2, $3, 'manual', NOW(), NOW())`,
                    [bizId, giftCard.recipient_name || giftCard.recipient_email.split('@')[0], giftCard.recipient_email]
                  );
                  console.log(`[GIFT-CARD] Auto-created client for ${giftCard.recipient_email}`);
                }
              } catch (clientErr) {
                console.error('[GIFT-CARD] Auto-create client failed:', clientErr.message);
              }
            }

            // Send emails
            if (biz) {
              const { sendGiftCardEmail, sendGiftCardReceiptEmail, sendGiftCardPurchaseProEmail } = require('../../services/email');

              if (giftCard.recipient_email) {
                await sendGiftCardEmail({ giftCard, business: biz }).catch(e =>
                  console.error('[GIFT-CARD] Recipient email failed:', e.message));
              }
              if (giftCard.buyer_email) {
                await sendGiftCardReceiptEmail({ giftCard, business: biz }).catch(e =>
                  console.error('[GIFT-CARD] Buyer receipt failed:', e.message));
              }
              // M5: Notify merchant of GC purchase
              sendGiftCardPurchaseProEmail({ giftCard, business: biz }).catch(e =>
                console.warn('[GIFT-CARD] Pro notification failed:', e.message));
            }

            // SSE
            try {
              const { broadcast } = require('../../services/sse');
              broadcast(bizId, 'gift_card', { action: 'purchased', gift_card_id: gc.rows[0].id });
            } catch (_) {}

            console.log(`[STRIPE WH] Gift card ${code} created (${amountCents}c) for business ${bizId}`);
          } catch (gcErr) {
            console.error('[STRIPE WH] Gift card creation failed:', gcErr);
          }
          break;
        }

        // ===== PASS PAYMENT =====
        if (session.metadata?.type === 'pass') {
          try {
            const { business_id, pass_template_id, buyer_name, buyer_email } = session.metadata;

            // Idempotency guard — Stripe may deliver the same event multiple times.
            // BUG-IDEMPOTENCE fix: fallback to session.id if payment_intent is null
            // (async Bancontact). Align with the INSERT below which uses the same fallback.
            const passPi = session.payment_intent || session.id;
            if (passPi) {
              const existingPass = await query('SELECT id FROM passes WHERE stripe_payment_intent_id = $1', [passPi]);
              if (existingPass.rows.length > 0) {
                console.log(`[STRIPE WH] Pass already created for PI ${passPi}, skipping duplicate`);
                break;
              }
            }

            // Fetch template
            const tplRes = await query(
              `SELECT pt.*, s.name AS service_name FROM pass_templates pt LEFT JOIN services s ON s.id = pt.service_id WHERE pt.id = $1 AND pt.business_id = $2`,
              [pass_template_id, business_id]
            );
            if (tplRes.rows.length === 0) { console.error('[STRIPE] Pass template not found:', pass_template_id); break; }
            const tpl = tplRes.rows[0];
            // ST-14: Warn if template or service was deactivated since purchase
            if (!tpl.is_active) console.warn(`[STRIPE WH] Pass template ${pass_template_id} is inactive — fulfilling anyway (client already paid)`);
            if (tpl.service_id && !tpl.service_name) console.warn(`[STRIPE WH] Service for pass template ${pass_template_id} may be deleted/inactive`);

            // Generate unique code (PS-XXXX-XXXX)
            const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
            let code, codeIsUnique = false;
            for (let attempt = 0; attempt < 10; attempt++) {
              code = 'PS-';
              for (let i = 0; i < 4; i++) code += chars[require('crypto').randomInt(chars.length)];
              code += '-';
              for (let i = 0; i < 4; i++) code += chars[require('crypto').randomInt(chars.length)];
              const dup = await query(`SELECT id FROM passes WHERE code = $1`, [code]);
              if (dup.rows.length === 0) { codeIsUnique = true; break; }
            }
            if (!codeIsUnique) {
              console.error('[STRIPE WH] Failed to generate unique pass code after 10 attempts — initiating refund');
              const passPiId = session.payment_intent;
              if (passPiId && passPiId.startsWith('pi_')) {
                try {
                  const { createRefund: _cr } = require('../../services/stripe-refund');
                  await _cr(stripe, { payment_intent: passPiId }, `wh-pass-gen-refund-${passPiId}`);
                  console.log(`[STRIPE WH] Auto-refunded PI ${passPiId} for failed pass code generation`);
                } catch (refundErr) {
                  console.error(`[STRIPE WH] Auto-refund failed for PI ${passPiId}:`, refundErr.message);
                }
              }
              break;
            }

            // Calculate expiry
            const expiresAt = new Date(Date.now() + (tpl.validity_days || 365) * 86400000);

            // Create pass
            // BUG-IDEMPOTENCE fix: UNIQUE partial index idx_passes_stripe_pi protects
            // against duplicate INSERT on concurrent Stripe webhook deliveries.
            // PI fallback to session.id so NULL payment_intent (async Bancontact) still
            // benefits from the UNIQUE guard — symmetric with the GC branch above.
            const _passStripeId = session.payment_intent || session.id;
            const passRes = await query(
              `INSERT INTO passes (business_id, pass_template_id, service_id, service_variant_id, code, name, sessions_total, sessions_remaining, price_cents, buyer_name, buyer_email, stripe_payment_intent_id, expires_at)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $7, $8, $9, $10, $11, $12)
               ON CONFLICT (stripe_payment_intent_id) WHERE stripe_payment_intent_id IS NOT NULL DO NOTHING
               RETURNING *`,
              // BUG-PASS-EMAIL-LOWER fix: normalize buyer_email lowercase for consistent matching.
              [business_id, pass_template_id, tpl.service_id, tpl.service_variant_id || null, code, tpl.name, tpl.sessions_count, tpl.price_cents, buyer_name, buyer_email ? String(buyer_email).toLowerCase() : null, _passStripeId, expiresAt.toISOString()]
            );
            if (passRes.rows.length === 0) {
              console.log(`[STRIPE WH] Pass INSERT conflict for PI ${session.payment_intent} (race with concurrent webhook), skipping.`);
              break;
            }
            const pass = passRes.rows[0];

            // Create purchase transaction
            await query(
              `INSERT INTO pass_transactions (pass_id, business_id, sessions, type, note)
               VALUES ($1, $2, $3, 'purchase', $4)`,
              [pass.id, business_id, tpl.sessions_count, `Achat Stripe — ${code}`]
            );

            // Auto-create client if email provided (skip if already exists)
            if (buyer_email) {
              await query(
                `INSERT INTO clients (business_id, full_name, email)
                 SELECT $1, $2, $3::text
                 WHERE NOT EXISTS (
                   SELECT 1 FROM clients WHERE business_id = $1 AND LOWER(email) = LOWER($3::text)
                 )`,
                [business_id, buyer_name || 'Client', buyer_email]
              ).catch(e => { if (e.code !== '23505') console.warn('[STRIPE] Client auto-create failed:', e.message); });
            }

            // Send email
            try {
              const bizRes = await query(`SELECT name, slug, email, theme, phone, address FROM businesses WHERE id = $1`, [business_id]);
              const biz = bizRes.rows[0];
              if (biz && buyer_email) {
                const { sendPassPurchaseEmail, sendPassPurchaseProEmail } = require('../../services/email');
                const passData = { code, name: tpl.name, sessions_total: tpl.sessions_count, price_cents: tpl.price_cents, service_name: tpl.service_name, buyer_name, buyer_email, expires_at: expiresAt };
                await sendPassPurchaseEmail({
                  pass: passData,
                  business: { id: business_id, name: biz.name, slug: biz.slug, email: biz.email, phone: biz.phone, address: biz.address, theme: biz.theme }
                });
                // M6: Notify merchant of pass purchase
                sendPassPurchaseProEmail({ pass: passData, business: { id: business_id, name: biz.name, email: biz.email, theme: biz.theme } }).catch(e =>
                  console.warn('[STRIPE] Pass pro notification failed:', e.message));
              }
            } catch (emailErr) { console.warn('[STRIPE] Pass email error:', emailErr.message); }

            // Broadcast SSE
            try {
              const { broadcast } = require('../../services/sse');
              broadcast(business_id, 'pass_purchased', { code, name: tpl.name });
            } catch (e) {}

            console.log(`[STRIPE] Pass created: ${code} (${tpl.name}, ${tpl.sessions_count} sessions) for ${buyer_email}`);
          } catch (err) {
            console.error('[STRIPE] Pass fulfillment error:', err.message);
          }
          break;
        }

        // ===== SUBSCRIPTION PAYMENT =====
        const businessId = session.metadata?.business_id;
        if (!businessId) break;

        // Get subscription details
        if (session.subscription) {
          const sub = await stripe.subscriptions.retrieve(session.subscription);
          const priceId = sub.items.data[0]?.price?.id;
          const plan = getPriceToPlan()[priceId] || sub.metadata?.plan || 'pro';
          const trialEnd = sub.trial_end ? new Date(sub.trial_end * 1000) : null;

          const periodEnd = sub.current_period_end ? new Date(sub.current_period_end * 1000) : null;
          await query(
            `UPDATE businesses SET
              plan = $1,
              stripe_subscription_id = $2,
              stripe_price_id = $3,
              subscription_status = $4,
              trial_ends_at = $5,
              stripe_customer_id = COALESCE(stripe_customer_id, $6),
              plan_changed_at = COALESCE(plan_changed_at, NOW()),
              subscription_current_period_end = $8,
              updated_at = NOW()
            WHERE id = $7`,
            [plan, sub.id, priceId, sub.status, trialEnd, session.customer, businessId, periodEnd]
          );

          console.log(`[STRIPE WH] Business ${businessId} → plan ${plan} (${sub.status})`);
        }
        break;
      }

      case 'customer.subscription.updated': {
        const sub = event.data.object;
        const businessId = sub.metadata?.business_id;
        if (!businessId) {
          // Find by subscription ID
          const found = await query(
            `SELECT id FROM businesses WHERE stripe_subscription_id = $1`, [sub.id]
          );
          if (found.rows.length === 0) break;
          await syncSubscription(sub, found.rows[0].id);
        } else {
          await syncSubscription(sub, businessId);
        }
        break;
      }

      case 'customer.subscription.deleted': {
        const sub = event.data.object;
        // Downgrade to free
        const found = await query(
          `SELECT id FROM businesses WHERE stripe_subscription_id = $1`, [sub.id]
        );
        if (found.rows.length > 0) {
          await query(
            `UPDATE businesses SET
              plan = 'free',
              subscription_status = 'canceled',
              stripe_subscription_id = NULL,
              stripe_price_id = NULL,
              trial_ends_at = NULL,
              updated_at = NOW()
            WHERE id = $1`,
            [found.rows[0].id]
          );
          console.log(`[STRIPE WH] Business ${found.rows[0].id} → downgraded to free (canceled)`);

          // Downgrade cleanup: deactivate excess promotions (free = max 1 active)
          try {
            const bizId = found.rows[0].id;
            const activePromos = await query(
              `SELECT id FROM promotions WHERE business_id = $1 AND is_active = true ORDER BY sort_order, created_at LIMIT 100`, [bizId]
            );
            if (activePromos.rows.length > 1) {
              const keepId = activePromos.rows[0].id;
              await query(
                `UPDATE promotions SET is_active = false, updated_at = NOW() WHERE business_id = $1 AND is_active = true AND id != $2`,
                [bizId, keepId]
              );
              console.log(`[STRIPE WH] Deactivated ${activePromos.rows.length - 1} excess promotions for business ${bizId}`);
            }
            // Disable Pro-only settings on downgrade
            await query(
              `UPDATE businesses SET settings =
                jsonb_set(
                  jsonb_set(
                    jsonb_set(
                      jsonb_set(COALESCE(settings, '{}'::jsonb), '{last_minute_enabled}', 'false'),
                    '{deposit_enabled}', 'false'),
                  '{giftcard_enabled}', 'false'),
                '{passes_enabled}', 'false')
              WHERE id = $1`,
              [bizId]
            );
          } catch (cleanupErr) {
            console.warn('[STRIPE WH] Downgrade cleanup error:', cleanupErr.message);
          }
        }
        break;
      }

      case 'invoice.payment_failed': {
        const invoice = event.data.object;
        const subId = invoice.subscription;
        if (subId) {
          await query(
            `UPDATE businesses SET subscription_status = 'past_due', updated_at = NOW()
             WHERE stripe_subscription_id = $1`,
            [subId]
          );
          console.log(`[STRIPE WH] Payment failed for subscription ${subId}`);
        }
        break;
      }

      case 'account.updated': {
        // Stripe Connect: sync account verification status
        const acct = event.data.object;
        const connectId = acct.id;
        if (connectId && connectId.startsWith('acct_')) {
          const found = await query(
            `SELECT id FROM businesses WHERE stripe_connect_id = $1`, [connectId]
          );
          if (found.rows.length > 0) {
            const newStatus = deriveConnectStatus(acct);
            await query(
              `UPDATE businesses SET stripe_connect_status = $1, updated_at = NOW() WHERE id = $2`,
              [newStatus, found.rows[0].id]
            );
            console.log(`[STRIPE WH] Connect account ${connectId} → ${newStatus}`);
          }
        }
        break;
      }

      case 'invoice.paid': {
        const invoice = event.data.object;
        const subId = invoice.subscription;
        // P1-10 fix: le filtre `AND subscription_status != 'trialing'` bloquait
        // la transition trialing → active quand la PREMIÈRE vraie facture arrivait
        // (billing_reason='subscription_cycle' à la fin du trial). Résultat :
        // businesses restaient 'trialing' indéfiniment alors que Stripe facturait
        // déjà → UI "en essai" + gates Pro mal appliqués.
        //
        // La guard `billing_reason !== 'subscription_create'` suffit à exclure
        // la $0 trial start invoice (celle-là seule a billing_reason=subscription_create).
        // Toutes les autres (cycle, manual, subscription_update, ...) sont des
        // vrais paiements → active.
        if (subId && invoice.billing_reason !== 'subscription_create') {
          await query(
            `UPDATE businesses SET subscription_status = 'active', updated_at = NOW()
             WHERE stripe_subscription_id = $1`,
            [subId]
          );
          console.log(`[STRIPE WH] Payment received for subscription ${subId}`);
        }
        break;
      }

      // ST-1: Handle external refunds (issued from Stripe dashboard OR echo from our own refund calls)
      // H9 fix: distinguish 2 cases.
      // (a) Echo — status='cancelled' already (our own refund fired this event). Just sync deposit_status.
      // (b) External refund via Stripe Dashboard — status still 'confirmed' → cascade FULL cancel:
      //     UPDATE status + cancel_reason, refund GC/pass, void invoices, audit, broadcast, pro notif, client email.
      case 'charge.refunded': {
        const charge = event.data.object;
        const pi = charge.payment_intent;
        // B-08 fix: détecter partial vs full refund Stripe Dashboard.
        // Partial = pro a choisi de refund qu'une fraction via Dashboard → ne PAS cascader
        // (cancel booking + GC/pass refund) car c'est dépasser son intention. On notifie le pro
        // pour qu'il agisse manuellement côté dashboard Bookt (staff cancel ou deposit-refund partiel).
        const isPartialRefund = charge.amount_refunded < charge.amount;
        if (pi) {
          try {
            const sessions = await stripe.checkout.sessions.list({ payment_intent: pi, limit: 1 });
            const sessionId = sessions.data[0]?.id || null;
            // BUG-CHARGEREF-FOR-UPDATE fix: SELECT FOR UPDATE (dans une tx dédiée au echo/partial path)
            // pour éviter race avec cron pendant le switch (a)/(b)/(c). Chaque bk est traité
            // avec son propre lock row-level.
            const _echoTxClient = await pool.connect();
            let bookings;
            try {
              await _echoTxClient.query('BEGIN');
              bookings = await _echoTxClient.query(
                `SELECT id, business_id, group_id, client_id, status, deposit_status
                 FROM bookings
                 WHERE deposit_payment_intent_id IN ($1, $2)
                   AND deposit_status = 'paid'
                 FOR UPDATE`,
                [pi, sessionId]
              );
              for (const bk of bookings.rows) {
                // (a) Echo: we already cancelled it, just sync deposit_status
                if (bk.status === 'cancelled') {
                  await _echoTxClient.query(
                    `UPDATE bookings SET deposit_status = 'refunded', updated_at = NOW() WHERE id = $1 AND status = 'cancelled'`,
                    [bk.id]
                  );
                  console.log(`[STRIPE WH] Internal refund echo for already-cancelled booking ${bk.id}`);
                }
              }
              await _echoTxClient.query('COMMIT');
            } catch (_echoErr) {
              await _echoTxClient.query('ROLLBACK').catch(() => {});
              throw _echoErr;
            } finally {
              _echoTxClient.release();
            }
            for (const bk of bookings.rows) {
              // (a) already handled above (echo)
              if (bk.status === 'cancelled') continue;

              // (c) PARTIAL refund Dashboard — pas de cascade, juste alerte pro + email client
              if (isPartialRefund) {
                console.warn(`[STRIPE WH] PARTIAL refund detected for booking ${bk.id}: ${charge.amount_refunded}/${charge.amount}c. Booking NOT cancelled — pro must act manually.`);
                try {
                  await query(
                    `INSERT INTO notifications (business_id, booking_id, type, status, metadata)
                     VALUES ($1, $2, 'email_dispute_alert', 'queued', $3)`,
                    [bk.business_id, bk.id, JSON.stringify({
                      kind: 'partial_stripe_refund',
                      charge_amount_cents: charge.amount,
                      amount_refunded_cents: charge.amount_refunded,
                      payment_intent: pi
                    })]
                  );
                } catch (_) { /* audit non-critique */ }
                // BUG-CHARGEREF-PARTIAL-CLIENT fix: notifier aussi le client du remboursement partiel.
                // Sans ça, le client voit juste le virement Stripe sans explication côté Bookt.
                try {
                  const _partialBk = await query(
                    `SELECT b.public_token,
                            CASE WHEN sv.name IS NOT NULL THEN s.name || ' \u2014 ' || sv.name ELSE s.name END AS service_name,
                            b.start_at, c.full_name AS client_name, c.email AS client_email,
                            biz.name AS biz_name, biz.email AS biz_email, biz.phone AS biz_phone, biz.address AS biz_address, biz.theme AS biz_theme, biz.slug AS biz_slug
                       FROM bookings b
                       LEFT JOIN clients c ON c.id = b.client_id
                       LEFT JOIN services s ON s.id = b.service_id
                       LEFT JOIN service_variants sv ON sv.id = b.service_variant_id
                       JOIN businesses biz ON biz.id = b.business_id
                      WHERE b.id = $1`, [bk.id]
                  );
                  if (_partialBk.rows[0]?.client_email) {
                    const pr = _partialBk.rows[0];
                    const { sendPartialRefundEmail } = require('../../services/email');
                    sendPartialRefundEmail({
                      booking: { client_name: pr.client_name, client_email: pr.client_email, service_name: pr.service_name, start_at: pr.start_at, public_token: pr.public_token },
                      business: { id: bk.business_id, name: pr.biz_name, email: pr.biz_email, phone: pr.biz_phone, address: pr.biz_address, theme: pr.biz_theme, slug: pr.biz_slug },
                      refundAmountCents: charge.amount_refunded,
                      totalAmountCents: charge.amount
                    }).catch(e => console.warn('[STRIPE WH] Partial refund email error:', e.message));
                  }
                } catch (e) { console.warn('[STRIPE WH] Partial refund email fetch error:', e.message); }
                continue;
              }

              // (b) External refund via Stripe Dashboard (FULL) — cascade full cancel in a transaction
              const txClient = await pool.connect();
              let _whGcRefunded = 0;
              let _whPassRefunded = false;
              try {
                await txClient.query('BEGIN');
                const cancelReason = 'Remboursé via Stripe Dashboard';
                await txClient.query(
                  `UPDATE bookings SET status = 'cancelled', deposit_status = 'refunded',
                    cancel_reason = $2, updated_at = NOW()
                   WHERE id = $1 AND status != 'cancelled'`,
                  [bk.id, cancelReason]
                );
                if (bk.group_id) {
                  await txClient.query(
                    `UPDATE bookings SET status = 'cancelled', deposit_status = 'refunded',
                      cancel_reason = $2, updated_at = NOW()
                     WHERE group_id = $1 AND id != $3 AND business_id = $4
                       AND deposit_payment_intent_id IN ($5, $6)
                       AND status != 'cancelled'`,
                    [bk.group_id, cancelReason + ' (groupe)', bk.id, bk.business_id, pi, sessionId]
                  );
                }

                // Refund gift card debits (primary + siblings) — capturer le montant pour email
                try {
                  const { refundGiftCardForBooking } = require('../../services/gift-card-refund');
                  const _gcPrimary = await refundGiftCardForBooking(bk.id, txClient).catch(e => { console.warn('[STRIPE WH] GC refund:', e.message); return { refunded: 0 }; });
                  _whGcRefunded = (_gcPrimary?.refunded) || 0;
                  if (bk.group_id) {
                    const sibs = await txClient.query(`SELECT id FROM bookings WHERE group_id = $1 AND id != $2 AND status = 'cancelled'`, [bk.group_id, bk.id]);
                    for (const sib of sibs.rows) await refundGiftCardForBooking(sib.id, txClient).catch(e => console.warn('[STRIPE WH] Sib GC refund:', e.message));
                  }
                } catch (e) { console.warn('[STRIPE WH] GC refund module error:', e.message); }

                // Refund pass sessions (primary + siblings) — capturer le flag pour email
                try {
                  const { refundPassForBooking } = require('../../services/pass-refund');
                  const _passPrimary = await refundPassForBooking(bk.id, txClient).catch(e => { console.warn('[STRIPE WH] Pass refund:', e.message); return { refunded: 0 }; });
                  _whPassRefunded = ((_passPrimary?.refunded) || 0) !== 0;
                  if (bk.group_id) {
                    const sibs = await txClient.query(`SELECT id FROM bookings WHERE group_id = $1 AND id != $2 AND status = 'cancelled'`, [bk.group_id, bk.id]);
                    for (const sib of sibs.rows) await refundPassForBooking(sib.id, txClient).catch(e => console.warn('[STRIPE WH] Sib pass refund:', e.message));
                  }
                } catch (e) { console.warn('[STRIPE WH] Pass refund module error:', e.message); }

                // Decrement promo usage
                try {
                  const { decrementPromoUsage } = require('../public/helpers');
                  await decrementPromoUsage(bk.id, txClient).catch(e => console.warn('[STRIPE WH] Promo dec:', e.message));
                } catch (_) {}

                // Void draft/sent invoices (R4 fix: filtrer voidIds par status='cancelled' pour
                // ne pas void par erreur une invoice draft d'un sibling resté confirmed)
                const voidIds = [bk.id];
                if (bk.group_id) {
                  const sibInv = await txClient.query(
                    `SELECT id FROM bookings WHERE group_id = $1 AND id != $2 AND status = 'cancelled'`,
                    [bk.group_id, bk.id]
                  );
                  for (const s of sibInv.rows) voidIds.push(s.id);
                }
                await txClient.query(
                  `UPDATE invoices SET status = 'cancelled', updated_at = NOW()
                   WHERE booking_id = ANY($1::uuid[]) AND status IN ('draft', 'sent')`,
                  [voidIds]
                ).catch(e => console.warn('[STRIPE WH] Invoice void:', e.message));

                // Audit log
                await txClient.query(
                  `INSERT INTO audit_logs (business_id, entity_type, entity_id, action, old_data, new_data)
                   VALUES ($1, 'booking', $2, 'stripe_external_refund', $3, $4)`,
                  [bk.business_id, bk.id,
                   JSON.stringify({ status: bk.status, deposit_status: bk.deposit_status }),
                   JSON.stringify({ status: 'cancelled', deposit_status: 'refunded', reason: cancelReason, payment_intent: pi })]
                );

                await txClient.query('COMMIT');
                console.log(`[STRIPE WH] External refund cascade complete for booking ${bk.id} (PI: ${pi})`);

                // Post-commit side effects
                try {
                  const { broadcast } = require('../../services/sse');
                  if (broadcast) broadcast(bk.business_id, 'booking_update', { action: 'external_refund_cancelled', booking_id: bk.id });
                } catch (_) {}
                // BUG-CHARGEREF-CACHE fix: parité avec 7 autres cancel paths — invalidate minisite cache
                try {
                  const { invalidateMinisiteCache } = require('../public/helpers');
                  invalidateMinisiteCache(bk.business_id);
                } catch (_) {}
                try {
                  const { calSyncDelete } = require('./bookings-helpers');
                  calSyncDelete(bk.business_id, bk.id);
                  if (bk.group_id) {
                    const sibs = await query(`SELECT id FROM bookings WHERE group_id = $1 AND business_id = $2 AND id != $3`, [bk.group_id, bk.business_id, bk.id]);
                    for (const sib of sibs.rows) calSyncDelete(bk.business_id, sib.id);
                  }
                } catch (_) {}
                // BUG-CHARGEREF-WAITLIST fix: parité avec 7 autres cancel paths — notifier waitlist
                try {
                  const { processWaitlistForCancellation } = require('../../services/waitlist');
                  await processWaitlistForCancellation(bk.id, bk.business_id);
                  if (bk.group_id) {
                    const sibsWl = await query(`SELECT id FROM bookings WHERE group_id = $1 AND business_id = $2 AND id != $3 AND status = 'cancelled'`, [bk.group_id, bk.business_id, bk.id]);
                    for (const sib of sibsWl.rows) {
                      try { await processWaitlistForCancellation(sib.id, bk.business_id); } catch (_) {}
                    }
                  }
                } catch (_) {}
                // Queue pro cancellation notif (email_cancellation_pro is routed by notification-processor.js:597)
                try {
                  await query(
                    `INSERT INTO notifications (business_id, booking_id, type, status)
                     VALUES ($1, $2, 'email_cancellation_pro', 'queued')`,
                    [bk.business_id, bk.id]
                  );
                } catch (_) {}
                // Send client cancellation email INLINE (pattern parity with public /cancel-booking)
                try {
                  const fullBk = await query(
                    `SELECT b.*, CASE WHEN sv.name IS NOT NULL THEN s.name || ' \u2014 ' || sv.name ELSE s.name END AS service_name,
                            s.category AS service_category,
                            COALESCE(sv.price_cents, s.price_cents, 0) AS service_price_cents,
                            COALESCE(sv.duration_min, s.duration_min, 0) AS duration_min,
                            p.display_name AS practitioner_name,
                            c.full_name AS client_name, c.email AS client_email,
                            biz.name AS biz_name, biz.email AS biz_email, biz.phone AS biz_phone, biz.address AS biz_address,
                            biz.theme AS biz_theme, biz.slug AS biz_slug, biz.settings AS biz_settings
                     FROM bookings b
                     LEFT JOIN clients c ON c.id = b.client_id
                     LEFT JOIN services s ON s.id = b.service_id
                     LEFT JOIN service_variants sv ON sv.id = b.service_variant_id
                     LEFT JOIN practitioners p ON p.id = b.practitioner_id
                     JOIN businesses biz ON biz.id = b.business_id
                     WHERE b.id = $1`, [bk.id]
                  );
                  if (fullBk.rows[0]?.client_email) {
                    const row = fullBk.rows[0];
                    let groupServices = null;
                    if (row.group_id) {
                      const grp = await query(
                        `SELECT CASE WHEN sv.name IS NOT NULL THEN COALESCE(s.category || ' - ', '') || s.name || ' \u2014 ' || sv.name ELSE COALESCE(s.category || ' - ', '') || s.name END AS name,
                                COALESCE(sv.duration_min, s.duration_min) AS duration_min,
                                COALESCE(sv.price_cents, s.price_cents) AS price_cents, b.end_at,
                                b.practitioner_id, p.display_name AS practitioner_name, b.discount_pct
                         FROM bookings b LEFT JOIN services s ON s.id = b.service_id
                         LEFT JOIN service_variants sv ON sv.id = b.service_variant_id
                         LEFT JOIN practitioners p ON p.id = b.practitioner_id
                         WHERE b.group_id = $1 AND b.business_id = $2 ORDER BY b.group_order, b.start_at`,
                        [row.group_id, row.business_id]
                      );
                      if (grp.rows.length > 1) {
                        const _pIds = new Set(grp.rows.map(r => r.practitioner_id));
                        if (_pIds.size <= 1) grp.rows.forEach(r => { r.practitioner_name = null; });
                        grp.rows.forEach(r => { if (r.discount_pct && r.price_cents) { r.original_price_cents = r.price_cents; r.price_cents = Math.round(r.price_cents * (100 - r.discount_pct) / 100); } });
                        groupServices = grp.rows;
                      }
                    }
                    const groupEndAt = groupServices ? groupServices[groupServices.length - 1].end_at : null;
                    const { getGcPaidCents } = require('../../services/gift-card-refund');
                    const gcPaidExt = await getGcPaidCents(bk.id);
                    const { sendCancellationEmail } = require('../../services/email');
                    // B-08 fix: propagation des vraies valeurs GC/pass refunded capturées + net_refund_cents
                    // depuis charge.amount_refunded (full refund car isPartialRefund=false ici).
                    await sendCancellationEmail({
                      booking: { start_at: row.start_at, end_at: groupEndAt || row.end_at, client_name: row.client_name, client_email: row.client_email, service_name: row.service_name, service_category: row.service_category, custom_label: row.custom_label, comment_client: row.comment_client, service_price_cents: row.service_price_cents, booked_price_cents: row.booked_price_cents, discount_pct: row.discount_pct, duration_min: row.duration_min, promotion_label: row.promotion_label, promotion_discount_cents: row.promotion_discount_cents, promotion_discount_pct: row.promotion_discount_pct, practitioner_name: row.practitioner_name, deposit_required: row.deposit_required, deposit_status: 'refunded', deposit_amount_cents: row.deposit_amount_cents, deposit_paid_at: row.deposit_paid_at, deposit_payment_intent_id: row.deposit_payment_intent_id, gc_paid_cents: gcPaidExt, gc_refunded_cents: _whGcRefunded, pass_refunded: _whPassRefunded, net_refund_cents: charge.amount_refunded, cancel_reason: cancelReason },
                      business: { id: row.business_id, name: row.biz_name, email: row.biz_email, phone: row.biz_phone, address: row.biz_address, theme: row.biz_theme, slug: row.biz_slug, settings: row.biz_settings },
                      groupServices
                    });
                    // X3C-05 fix: poser le flag cancellation_email_sent_at pour parité avec cron (éviter
                    // double-email si un futur sweep pick up ce cancel_reason).
                    await query(`UPDATE bookings SET cancellation_email_sent_at = NOW() WHERE id = $1`, [bk.id]).catch(() => {});
                  }
                } catch (emailErr) { console.warn('[STRIPE WH] Client cancel email error:', emailErr.message); }
              } catch (txErr) {
                await txClient.query('ROLLBACK').catch(() => {});
                console.error(`[STRIPE WH] External refund cascade failed for booking ${bk.id}:`, txErr.message);
              } finally {
                txClient.release();
              }
            }
          } catch (refErr) {
            console.warn('[STRIPE WH] charge.refunded processing error:', refErr.message);
          }
        }
        break;
      }

      // ST-2: Handle disputes — alert business owner
      case 'charge.dispute.created': {
        const dispute = event.data.object;
        const chargeId = dispute.charge;
        try {
          // Find the payment intent from the charge
          const ch = await stripe.charges.retrieve(chargeId);
          const pi = ch.payment_intent;
          if (pi) {
            const sessions = await stripe.checkout.sessions.list({ payment_intent: pi, limit: 1 });
            const sessionId = sessions.data[0]?.id || null;
            const bookings = await query(
              `SELECT b.id, b.business_id, biz.email AS biz_email, biz.name AS biz_name
               FROM bookings b JOIN businesses biz ON biz.id = b.business_id
               WHERE b.deposit_payment_intent_id IN ($1, $2)`, [pi, sessionId]
            );
            if (bookings.rows.length > 0) {
              const bk = bookings.rows[0];
              // P1-07: marque le booking en dispute pour bloquer les futurs refunds
              // staff — empêche le double-loss (refund + dispute perdue).
              // Idempotent (COALESCE) : si déjà disputed, garde le 1er timestamp.
              await query(
                `UPDATE bookings
                 SET disputed_at = COALESCE(disputed_at, NOW()), updated_at = NOW()
                 WHERE id = $1`,
                [bk.id]
              ).catch(e => console.warn('[STRIPE WH] Dispute flag update error:', e.message));
              // Queue notification for business owner
              await query(
                `INSERT INTO notifications (business_id, booking_id, type, status, metadata)
                 VALUES ($1, $2, 'email_dispute_alert', 'queued', $3)`,
                [bk.business_id, bk.id, JSON.stringify({ dispute_id: dispute.id, amount: dispute.amount, reason: dispute.reason })]
              ).catch(e => console.warn('[STRIPE WH] Dispute notification queue error:', e.message));
              console.log(`[STRIPE WH] Dispute created for booking ${bk.id}, amount: ${dispute.amount}, reason: ${dispute.reason}`);
            }

            // P1-07 v82 : chercher aussi dans passes + gift_cards — ces achats
            // ont leur propre stripe_payment_intent_id, indépendant des bookings.
            const passes = await query(
              `SELECT id, business_id FROM passes WHERE stripe_payment_intent_id IN ($1, $2)`,
              [pi, sessionId]
            );
            for (const p of passes.rows) {
              await query(
                `UPDATE passes SET disputed_at = COALESCE(disputed_at, NOW()), updated_at = NOW() WHERE id = $1`,
                [p.id]
              ).catch(e => console.warn('[STRIPE WH] Pass dispute flag update error:', e.message));
              console.log(`[STRIPE WH] Dispute flagged on pass ${p.id}`);
            }
            const gcs = await query(
              `SELECT id, business_id FROM gift_cards WHERE stripe_payment_intent_id IN ($1, $2)`,
              [pi, sessionId]
            );
            for (const g of gcs.rows) {
              await query(
                `UPDATE gift_cards SET disputed_at = COALESCE(disputed_at, NOW()), updated_at = NOW() WHERE id = $1`,
                [g.id]
              ).catch(e => console.warn('[STRIPE WH] GC dispute flag update error:', e.message));
              console.log(`[STRIPE WH] Dispute flagged on gift card ${g.id}`);
            }
          }
        } catch (dispErr) {
          console.warn('[STRIPE WH] charge.dispute.created processing error:', dispErr.message);
        }
        break;
      }

      // P1-07 v2: charge.dispute.closed — clear disputed_at pour débloquer
      // refunds staff après résolution (gagnée ou perdue). Sans ce handler,
      // le booking restait verrouillé ad vitam.
      // Stripe envoie dispute.closed dans les 3 cas : won, lost, warning_closed.
      case 'charge.dispute.closed': {
        const dispute = event.data.object;
        const chargeId = dispute.charge;
        try {
          const ch = await stripe.charges.retrieve(chargeId);
          const pi = ch.payment_intent;
          if (pi) {
            const sessions = await stripe.checkout.sessions.list({ payment_intent: pi, limit: 1 });
            const sessionId = sessions.data[0]?.id || null;
            // Clear disputed_at sur les bookings matchant (même logique que dispute.created)
            const r = await query(
              `UPDATE bookings SET disputed_at = NULL, updated_at = NOW()
               WHERE deposit_payment_intent_id IN ($1, $2)
               RETURNING id`,
              [pi, sessionId]
            );
            // P1-07 v82 : clear disputed_at sur passes + gift_cards aussi.
            const rPass = await query(
              `UPDATE passes SET disputed_at = NULL, updated_at = NOW()
               WHERE stripe_payment_intent_id IN ($1, $2) RETURNING id`,
              [pi, sessionId]
            );
            const rGc = await query(
              `UPDATE gift_cards SET disputed_at = NULL, updated_at = NOW()
               WHERE stripe_payment_intent_id IN ($1, $2) RETURNING id`,
              [pi, sessionId]
            );
            console.log(`[STRIPE WH] Dispute closed for ${r.rowCount} booking(s), ${rPass.rowCount} pass(es), ${rGc.rowCount} GC(s) (status: ${dispute.status}, PI: ${pi})`);
          }
        } catch (dispErr) {
          console.warn('[STRIPE WH] charge.dispute.closed processing error:', dispErr.message);
        }
        break;
      }

      // ST-11: Handle failed one-time payment intents (deposits, GC, passes)
      case 'payment_intent.payment_failed': {
        const pi = event.data.object;
        const lastError = pi.last_payment_error;
        console.warn(`[STRIPE WH] Payment failed: PI ${pi.id}, reason: ${lastError?.message || 'unknown'}, code: ${lastError?.code || 'none'}`);
        break;
      }
    }
  } catch (err) {
    console.error('[STRIPE WH] Processing error:', err);
    // BUG-G fix: release the idempotence row so Stripe retries this event.
    // Without this, the event is marked processed forever even though it threw.
    if (_idemClaimed) {
      try {
        await query(`DELETE FROM stripe_webhook_events WHERE event_id = $1`, [event.id]);
      } catch (_) { /* best-effort */ }
    }
    return res.status(500).send('Webhook processing error — will be retried');
  }

  res.json({ received: true });
}

/**
 * Sync subscription state to DB
 */
async function syncSubscription(sub, businessId) {
  const priceId = sub.items.data[0]?.price?.id;
  const plan = getPriceToPlan()[priceId] || sub.metadata?.plan || 'pro';
  const trialEnd = sub.trial_end ? new Date(sub.trial_end * 1000) : null;

  const periodEnd = sub.current_period_end ? new Date(sub.current_period_end * 1000) : null;
  await query(
    `UPDATE businesses SET
      plan = $1,
      stripe_price_id = $2,
      subscription_status = $3,
      trial_ends_at = $4,
      subscription_current_period_end = $6,
      updated_at = NOW()
    WHERE id = $5`,
    [plan, priceId, sub.status, trialEnd, businessId, periodEnd]
  );
  console.log(`[STRIPE WH] Business ${businessId} → plan ${plan} (${sub.status})`);
}

// ============================================================
// STRIPE CONNECT EXPRESS — Merchant payouts
// ============================================================

// POST /api/stripe/connect/onboard — Start or resume Connect onboarding
router.post('/connect/onboard', requireAuth, requireOwner, blockIfImpersonated, async (req, res, next) => {
  try {
    const stripe = getStripe();
    if (!stripe) return res.status(503).json({ error: 'Stripe non configur\u00e9.' });

    const bid = req.businessId;
    const bizResult = await query(
      `SELECT b.id, b.email, b.name, b.stripe_connect_id,
              u.email AS owner_email
       FROM businesses b
       JOIN users u ON u.business_id = b.id AND u.role = 'owner'
       WHERE b.id = $1 LIMIT 1`,
      [bid]
    );
    const biz = bizResult.rows[0];
    if (!biz) return res.status(404).json({ error: 'Business non trouv\u00e9.' });

    let connectId = biz.stripe_connect_id;

    // Create Express account if none exists
    if (!connectId) {
      // P1-stripe-idem : clé STABLE par business_id (pas bucket) — 1 seul
      // compte Connect par biz, donc retry doit retourner le MÊME compte.
      // Sans ça, double-clic ou race crash → 2 comptes Express orphelins
      // (lourd à nettoyer chez Stripe, un biz ne peut avoir qu'un Connect).
      const account = await stripe.accounts.create({
        type: 'express',
        country: 'BE',
        email: biz.owner_email || biz.email,
        business_type: 'individual',
        metadata: { business_id: bid, business_name: biz.name },
        capabilities: {
          card_payments: { requested: true },
          transfers: { requested: true },
          bancontact_payments: { requested: true }
        }
      }, { idempotencyKey: `connect-account-${bid}` });
      connectId = account.id;

      await query(
        `UPDATE businesses SET stripe_connect_id = $1, stripe_connect_status = 'onboarding', updated_at = NOW()
         WHERE id = $2`,
        [connectId, bid]
      );
      console.log(`[STRIPE CONNECT] Created Express account ${connectId} for business ${bid}`);
    }

    // Create Account Link for onboarding (or re-onboarding)
    const baseUrl = process.env.APP_BASE_URL || 'https://genda.be';
    const accountLink = await stripe.accountLinks.create({
      account: connectId,
      refresh_url: `${baseUrl}/dashboard?connect=refresh`,
      return_url: `${baseUrl}/dashboard?connect=success`,
      type: 'account_onboarding'
    });

    res.json({ url: accountLink.url });
  } catch (err) {
    console.error('[STRIPE CONNECT] Onboard error:', err);
    next(err);
  }
});

// GET /api/stripe/connect/status — Connect account status
router.get('/connect/status', requireAuth, async (req, res, next) => {
  try {
    const bid = req.businessId;
    const result = await query(
      `SELECT stripe_connect_id, stripe_connect_status FROM businesses WHERE id = $1`,
      [bid]
    );
    const b = result.rows[0];
    if (!b) return res.status(404).json({ error: 'Business non trouv\u00e9.' });

    const resp = {
      connect_id: b.stripe_connect_id || null,
      connect_status: b.stripe_connect_status || 'none',
      charges_enabled: false,
      payouts_enabled: false,
      details_submitted: false
    };

    // If account exists, fetch live status from Stripe
    if (b.stripe_connect_id) {
      const stripe = getStripe();
      if (stripe) {
        try {
          const acct = await stripe.accounts.retrieve(b.stripe_connect_id);
          resp.charges_enabled = acct.charges_enabled;
          resp.payouts_enabled = acct.payouts_enabled;
          resp.details_submitted = acct.details_submitted;

          // Sync status to DB if changed
          const newStatus = deriveConnectStatus(acct);
          if (newStatus !== b.stripe_connect_status) {
            await query(
              `UPDATE businesses SET stripe_connect_status = $1, updated_at = NOW() WHERE id = $2`,
              [newStatus, bid]
            );
            resp.connect_status = newStatus;
          }
        } catch (e) {
          console.error('[STRIPE CONNECT] Status fetch error:', e.message);
        }
      }
    }

    res.json(resp);
  } catch (err) { next(err); }
});

// POST /api/stripe/connect/dashboard — Login link to Express dashboard
router.post('/connect/dashboard', requireAuth, requireOwner, blockIfImpersonated, async (req, res, next) => {
  try {
    const stripe = getStripe();
    if (!stripe) return res.status(503).json({ error: 'Stripe non configur\u00e9.' });

    const bid = req.businessId;
    const result = await query(
      `SELECT stripe_connect_id FROM businesses WHERE id = $1`, [bid]
    );
    const connectId = result.rows[0]?.stripe_connect_id;
    if (!connectId) return res.status(400).json({ error: 'Aucun compte Stripe connect\u00e9.' });

    const loginLink = await stripe.accounts.createLoginLink(connectId);
    res.json({ url: loginLink.url });
  } catch (err) {
    console.error('[STRIPE CONNECT] Dashboard error:', err);
    next(err);
  }
});

// DELETE /api/stripe/connect — Disconnect Connect account
router.delete('/connect', requireAuth, requireOwner, blockIfImpersonated, async (req, res, next) => {
  try {
    const bid = req.businessId;
    // ST-3: Check for pending deposits before allowing disconnect
    const pending = await query(
      `SELECT COUNT(*) AS cnt FROM bookings
       WHERE business_id = $1 AND status = 'pending_deposit' AND deposit_status = 'pending'`,
      [bid]
    );
    if (parseInt(pending.rows[0].cnt) > 0) {
      return res.status(400).json({
        error: `Impossible de déconnecter Stripe : ${pending.rows[0].cnt} acompte(s) en attente de paiement. Annulez-les d'abord ou attendez leur expiration.`
      });
    }
    // ST-7: Delete the Stripe Express account to avoid orphans
    const bizRes = await query(`SELECT stripe_connect_id FROM businesses WHERE id = $1`, [bid]);
    const connectId = bizRes.rows[0]?.stripe_connect_id;
    if (connectId) {
      try { await getStripe().accounts.del(connectId); } catch (e) { console.warn('[STRIPE CONNECT] Account delete failed (may already be deleted):', e.message); }
    }
    await query(
      `UPDATE businesses SET stripe_connect_id = NULL, stripe_connect_status = 'none', updated_at = NOW()
       WHERE id = $1`,
      [bid]
    );
    console.log(`[STRIPE CONNECT] Business ${bid} disconnected`);
    res.json({ disconnected: true });
  } catch (err) { next(err); }
});

/**
 * Derive connect status from Stripe account object
 */
function deriveConnectStatus(acct) {
  if (acct.charges_enabled && acct.payouts_enabled) return 'active';
  if (acct.requirements?.disabled_reason) return 'disabled';
  if (acct.requirements?.currently_due?.length > 0) return 'restricted';
  if (acct.details_submitted && !acct.charges_enabled) return 'onboarding';
  return 'onboarding';
}

module.exports = router;
module.exports.handleStripeWebhook = handleStripeWebhook;
