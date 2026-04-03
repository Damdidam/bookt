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
router.post('/checkout', requireAuth, requireOwner, async (req, res, next) => {
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

    // Create Checkout Session
    const baseUrl = process.env.APP_BASE_URL || 'https://genda.be';

    const sessionParams = {
      customer: customerId,
      mode: 'subscription',
      payment_method_types: ['card', 'bancontact'],
      line_items: [{
        price: priceId,
        quantity: 1
      }],
      subscription_data: {
        metadata: { business_id: bid, plan }
      },
      success_url: `${baseUrl}/dashboard?subscription=success&plan=${plan}`,
      cancel_url: `${baseUrl}/dashboard?subscription=cancel`,
      locale: 'fr',
      allow_promotion_codes: true,
      billing_address_collection: 'required',
      tax_id_collection: { enabled: true },
      metadata: { business_id: bid, plan }
    };

    const session = await stripe.checkout.sessions.create(sessionParams);

    res.json({ url: session.url, session_id: session.id });
  } catch (err) {
    console.error('[STRIPE] Checkout error:', err);
    next(err);
  }
});

// ============================================================
// POST /api/stripe/portal — Customer Portal (manage billing)
// ============================================================
router.post('/portal', requireAuth, requireOwner, async (req, res, next) => {
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

  console.log(`[STRIPE WH] ${event.type}`);

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
          console.log(`[STRIPE WH] Deposit paid for booking ${bookingId} (PI: ${piId})`);

          // Update booking + group siblings + detached bookings atomically in a transaction
          const txClient = await pool.connect();
          let upd, linkedIds = [];
          try {
            await txClient.query('BEGIN');

            // Update booking: pending_deposit → confirmed, deposit_status → paid
            upd = await txClient.query(
              `UPDATE bookings SET
                status = 'confirmed',
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
                  `UPDATE bookings SET status = 'confirmed', deposit_status = 'paid',
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
                  `UPDATE bookings SET status = 'confirmed', deposit_status = 'paid',
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
            } catch (_) {}

            // Send confirmation email to client
            try {
              const bkData = await query(
                `SELECT b.start_at, b.end_at, b.deposit_amount_cents, b.group_id, b.public_token,
                        b.promotion_label, b.promotion_discount_cents, b.promotion_discount_pct,
                        c.full_name AS client_name, c.email AS client_email,
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
                    groupServices.forEach(r => { if (r.discount_pct && r.price_cents) r.price_cents = Math.round(r.price_cents * (100 - r.discount_pct) / 100); });
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
                    groupServices.forEach(r => { if (r.discount_pct && r.price_cents) r.price_cents = Math.round(r.price_cents * (100 - r.discount_pct) / 100); });
                  }
                }
                if (groupServices) d.end_at = groupServices[groupServices.length - 1].end_at;
                const { getGcPaidCents } = require('../../services/gift-card-refund');
                d.gc_paid_cents = await getGcPaidCents(bookingId);
                const { sendDepositPaidEmail } = require('../../services/email');
                await sendDepositPaidEmail({
                  booking: d,
                  business: { name: d.business_name, email: d.business_email, phone: d.business_phone, address: d.business_address, theme: d.theme, slug: d.slug, settings: d.business_settings },
                  groupServices
                });
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
            // Booking was already cancelled/expired — auto-refund the orphaned payment
            console.warn(`[STRIPE WH] Deposit payment for already-cancelled booking ${bookingId} — initiating auto-refund`);
            try {
              if (piId && piId.startsWith('pi_')) {
                await stripe.refunds.create({ payment_intent: piId });
                console.log(`[STRIPE WH] Auto-refund successful for orphaned payment PI ${piId}`);
              }
              // Notify the business about the orphaned payment
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
              // Still try to notify business
              try {
                await query(
                  `INSERT INTO notifications (business_id, booking_id, type, status, metadata)
                   VALUES ($1, $2, 'email_deposit_orphan', 'queued', $3)`,
                  [businessId, bookingId, JSON.stringify({ payment_intent: piId, auto_refunded: refundErr.code === 'charge_already_refunded', error: refundErr.message })]
                );
              } catch (_) {}
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
                  await stripe.refunds.create({ payment_intent: piId });
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

            const gc = await query(
              `INSERT INTO gift_cards (business_id, code, amount_cents, balance_cents,
               buyer_name, buyer_email, recipient_name, recipient_email, message,
               stripe_payment_intent_id, expires_at)
               VALUES ($1, $2, $3, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *`,
              [bizId, code, amountCents,
               session.metadata.buyer_name || null, session.metadata.buyer_email || null,
               session.metadata.recipient_name || null, session.metadata.recipient_email || null,
               session.metadata.message || null, piId, expiresAt]
            );

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
                  await query(
                    `INSERT INTO clients (id, business_id, full_name, email, source, created_at, updated_at)
                     VALUES (gen_random_uuid(), $1, $2, $3, 'gift_card', NOW(), NOW())`,
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
              const { sendGiftCardEmail, sendGiftCardReceiptEmail } = require('../../services/email');

              if (giftCard.recipient_email) {
                await sendGiftCardEmail({ giftCard, business: biz }).catch(e =>
                  console.error('[GIFT-CARD] Recipient email failed:', e.message));
              }
              if (giftCard.buyer_email) {
                await sendGiftCardReceiptEmail({ giftCard, business: biz }).catch(e =>
                  console.error('[GIFT-CARD] Buyer receipt failed:', e.message));
              }
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

            // Idempotency guard — Stripe may deliver the same event multiple times
            const passPi = session.payment_intent;
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
                  await stripe.refunds.create({ payment_intent: passPiId });
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
            const passRes = await query(
              `INSERT INTO passes (business_id, pass_template_id, service_id, service_variant_id, code, name, sessions_total, sessions_remaining, price_cents, buyer_name, buyer_email, stripe_payment_intent_id, expires_at)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $7, $8, $9, $10, $11, $12)
               RETURNING *`,
              [business_id, pass_template_id, tpl.service_id, tpl.service_variant_id || null, code, tpl.name, tpl.sessions_count, tpl.price_cents, buyer_name, buyer_email, session.payment_intent, expiresAt.toISOString()]
            );
            const pass = passRes.rows[0];

            // Create purchase transaction
            await query(
              `INSERT INTO pass_transactions (pass_id, business_id, sessions, type, note)
               VALUES ($1, $2, $3, 'purchase', $4)`,
              [pass.id, business_id, tpl.sessions_count, `Achat Stripe — ${code}`]
            );

            // Auto-create client if email provided
            if (buyer_email) {
              await query(
                `INSERT INTO clients (business_id, full_name, email, source)
                 VALUES ($1, $2, $3, 'pass')
                 ON CONFLICT (business_id, email) DO NOTHING`,
                [business_id, buyer_name || 'Client', buyer_email]
              ).catch(() => {});
            }

            // Send email
            try {
              const bizRes = await query(`SELECT name, slug, email, theme, phone, address FROM businesses WHERE id = $1`, [business_id]);
              const biz = bizRes.rows[0];
              if (biz && buyer_email) {
                const { sendPassPurchaseEmail } = require('../../services/email');
                await sendPassPurchaseEmail({
                  pass: { code, name: tpl.name, sessions_total: tpl.sessions_count, price_cents: tpl.price_cents, service_name: tpl.service_name, buyer_name, buyer_email, expires_at: expiresAt },
                  business: { name: biz.name, slug: biz.slug, email: biz.email, phone: biz.phone, address: biz.address, theme: biz.theme }
                });
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
        // M6: Don't overwrite 'trialing' on $0 trial invoices
        if (subId && invoice.billing_reason !== 'subscription_create') {
          await query(
            `UPDATE businesses SET subscription_status = 'active', updated_at = NOW()
             WHERE stripe_subscription_id = $1 AND subscription_status != 'trialing'`,
            [subId]
          );
          console.log(`[STRIPE WH] Payment received for subscription ${subId}`);
        }
        break;
      }
    }
  } catch (err) {
    console.error('[STRIPE WH] Processing error:', err);
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
router.post('/connect/onboard', requireAuth, requireOwner, async (req, res, next) => {
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
      });
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
router.post('/connect/dashboard', requireAuth, requireOwner, async (req, res, next) => {
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
router.delete('/connect', requireAuth, requireOwner, async (req, res, next) => {
  try {
    const bid = req.businessId;
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
