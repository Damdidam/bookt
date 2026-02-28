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

      case 'invoice.paid': {
        const invoice = event.data.object;
        const subId = invoice.subscription;
        if (subId) {
          await query(
            `UPDATE businesses SET subscription_status = 'active', updated_at = NOW()
             WHERE stripe_subscription_id = $1`,
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

module.exports = router;
module.exports.handleStripeWebhook = handleStripeWebhook;
