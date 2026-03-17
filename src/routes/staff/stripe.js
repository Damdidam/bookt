/**
 * Stripe Subscription Management
 * Handles: checkout, webhooks, customer portal, plan sync
 * 
 * ENV vars needed:
 *   STRIPE_SECRET_KEY        — sk_live_... or sk_test_...
 *   STRIPE_WEBHOOK_SECRET    — whsec_...
 *   STRIPE_PRICE_PRO         — price_... (39€/month)
 *   STRIPE_PRICE_PREMIUM     — price_... (79€/month)
 *   APP_BASE_URL             — https://genda.be
 */

const router = require('express').Router();
const { query } = require('../../services/db');
const { requireAuth, requireOwner } = require('../../middleware/auth');

function getStripe() {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return null;
  return require('stripe')(key);
}

const PLAN_PRICES = {
  pro: () => process.env.STRIPE_PRICE_PRO,
  premium: () => process.env.STRIPE_PRICE_PREMIUM
};

const PRICE_TO_PLAN = {};
// Built dynamically on first call
function getPriceToPlan() {
  if (Object.keys(PRICE_TO_PLAN).length === 0) {
    const pro = process.env.STRIPE_PRICE_PRO;
    const premium = process.env.STRIPE_PRICE_PREMIUM;
    if (pro) PRICE_TO_PLAN[pro] = 'pro';
    if (premium) PRICE_TO_PLAN[premium] = 'premium';
  }
  return PRICE_TO_PLAN;
}

// ============================================================
// POST /api/stripe/checkout — Create Stripe Checkout Session
// Body: { plan: 'pro' | 'premium' }
// ============================================================
router.post('/checkout', requireAuth, requireOwner, async (req, res, next) => {
  try {
    const stripe = getStripe();
    if (!stripe) return res.status(503).json({ error: 'Stripe non configuré. Contactez le support.' });

    const bid = req.businessId;
    const { plan } = req.body;

    if (!plan || !PLAN_PRICES[plan]) {
      return res.status(400).json({ error: 'Plan invalide. Choisissez pro ou premium.' });
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
        trial_period_days: 14,
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

    // If upgrading from pro → premium, no trial
    if (biz.current_plan === 'pro' && plan === 'premium') {
      delete sessionParams.subscription_data.trial_period_days;
    }

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

          // Update booking: pending_deposit → confirmed, deposit_status → paid
          const upd = await query(
            `UPDATE bookings SET
              status = 'confirmed',
              deposit_status = 'paid',
              deposit_paid_at = NOW(),
              deposit_payment_intent_id = COALESCE($1, deposit_payment_intent_id),
              deposit_deadline = NULL,
              locked = true
             WHERE id = $2 AND business_id = $3 AND status = 'pending_deposit'
             RETURNING id, business_id, group_id, client_id`,
            [piId, bookingId, businessId]
          );

          if (upd.rows.length > 0) {
            const bk = upd.rows[0];

            // Propagate to group siblings AND ungrouped bookings sharing same deposit
            // (handles case where bookings were ungrouped/reassigned after deposit request)
            const linkedIds = [];

            // 1. Group siblings (still in same group)
            if (bk.group_id) {
              const grpUpd = await query(
                `UPDATE bookings SET status = 'confirmed', deposit_status = 'paid',
                  deposit_paid_at = NOW(), deposit_deadline = NULL, locked = true
                 WHERE group_id = $1 AND business_id = $2 AND id != $3 AND status = 'pending_deposit'
                 RETURNING id`,
                [bk.group_id, businessId, bookingId]
              );
              grpUpd.rows.forEach(r => linkedIds.push(r.id));
            }

            // 2. Ungrouped bookings sharing same deposit_payment_intent_id (detached after deposit request)
            if (piId) {
              const detachedUpd = await query(
                `UPDATE bookings SET status = 'confirmed', deposit_status = 'paid',
                  deposit_paid_at = NOW(), deposit_deadline = NULL, locked = true
                 WHERE deposit_payment_intent_id = $1 AND business_id = $2 AND id != $3
                   AND status = 'pending_deposit' AND group_id IS DISTINCT FROM $4
                 RETURNING id`,
                [piId, businessId, bookingId, bk.group_id]
              );
              detachedUpd.rows.forEach(r => linkedIds.push(r.id));
            }

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
                        c.full_name AS client_name, c.email AS client_email,
                        CASE WHEN sv.name IS NOT NULL THEN s.name || ' — ' || sv.name ELSE s.name END AS service_name,
                        s.category AS service_category,
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
                 JOIN practitioners p ON p.id = b.practitioner_id
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
                            COALESCE(sv.price_cents, s.price_cents) AS price_cents, b.end_at
                     FROM bookings b
                     LEFT JOIN services s ON s.id = b.service_id
                     LEFT JOIN service_variants sv ON sv.id = b.service_variant_id
                     WHERE b.id = ANY($1) AND b.business_id = $2
                     ORDER BY b.start_at`,
                    [allLinkedIds, businessId]
                  );
                  if (grp.rows.length > 1) {
                    groupServices = grp.rows;
                  }
                } else if (d.group_id) {
                  const grp = await query(
                    `SELECT CASE WHEN sv.name IS NOT NULL THEN COALESCE(s.category || ' - ', '') || s.name || ' \u2014 ' || sv.name ELSE COALESCE(s.category || ' - ', '') || s.name END AS name,
                            COALESCE(sv.duration_min, s.duration_min) AS duration_min,
                            COALESCE(sv.price_cents, s.price_cents) AS price_cents, b.end_at
                     FROM bookings b
                     LEFT JOIN services s ON s.id = b.service_id
                     LEFT JOIN service_variants sv ON sv.id = b.service_variant_id
                     WHERE b.group_id = $1 AND b.business_id = $2
                     ORDER BY b.group_order, b.start_at`,
                    [d.group_id, businessId]
                  );
                  if (grp.rows.length > 1) {
                    groupServices = grp.rows;
                  }
                }
                if (groupServices) d.end_at = groupServices[groupServices.length - 1].end_at;
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
            // Race condition: deposit-expiry cron may have cancelled the booking while Stripe processed payment
            const stale = await query(
              `SELECT id, status, deposit_status FROM bookings WHERE id = $1 AND business_id = $2`,
              [bookingId, businessId]
            );
            if (stale.rows.length > 0 && stale.rows[0].status === 'cancelled') {
              console.warn(`[STRIPE WH] Race: booking ${bookingId} was cancelled while deposit was paid. Attempting auto-refund.`);
              if (piId && piId.startsWith('pi_')) {
                try {
                  await stripe.refunds.create({ payment_intent: piId });
                  console.log(`[STRIPE WH] Auto-refunded PI ${piId} for cancelled booking ${bookingId}`);
                } catch (refundErr) {
                  if (refundErr.code !== 'charge_already_refunded') {
                    console.error(`[STRIPE WH] Auto-refund failed for PI ${piId}:`, refundErr.message);
                  }
                }
              }
            }
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

          await query(
            `UPDATE businesses SET
              plan = $1,
              stripe_subscription_id = $2,
              stripe_price_id = $3,
              subscription_status = $4,
              trial_ends_at = $5,
              stripe_customer_id = COALESCE(stripe_customer_id, $6),
              updated_at = NOW()
            WHERE id = $7`,
            [plan, sub.id, priceId, sub.status, trialEnd, session.customer, businessId]
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

  await query(
    `UPDATE businesses SET
      plan = $1,
      stripe_price_id = $2,
      subscription_status = $3,
      trial_ends_at = $4,
      updated_at = NOW()
    WHERE id = $5`,
    [plan, priceId, sub.status, trialEnd, businessId]
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
