const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const escHtml = s => (s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');

/**
 * Attempt Stripe refund for a deposit. Handles both pi_ (PaymentIntent) and cs_ (Checkout Session) IDs.
 * @param {string} depositPaymentIntentId - stored ID (may be cs_ or pi_)
 * @param {string} label - log label for error messages
 */
async function stripeRefundDeposit(depositPaymentIntentId, label) {
  if (!depositPaymentIntentId) return;
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return;
  try {
    const stripe = require('stripe')(key);
    let piId = depositPaymentIntentId;
    if (piId.startsWith('cs_')) {
      const session = await stripe.checkout.sessions.retrieve(piId);
      piId = session.payment_intent;
      if (!piId) return; // session not yet paid
    }
    if (piId && piId.startsWith('pi_')) {
      await stripe.refunds.create({ payment_intent: piId });
    }
  } catch (stripeErr) {
    if (stripeErr.code !== 'charge_already_refunded') {
      console.error(`[${label}] Stripe refund failed:`, stripeErr.message);
    }
  }
}

/**
 * Determine if a deposit should be required for a public booking.
 * Returns { required: true, depCents, reason } or { required: false }.
 *
 * Triggers (OR logic — any one is enough):
 *   1. Price/duration thresholds (applies to ALL clients, even new ones)
 *   2. No-show recidivists (only if clientId exists and has history)
 *
 * @param {object} bizSettings - business.settings JSONB
 * @param {number} totalPriceCents - total price of all services
 * @param {number} totalDurationMin - total duration in minutes
 * @param {number} noShowCount - client's no-show count (0 for new clients)
 * @param {boolean} [isVip=false] - VIP clients are exempt from deposits
 */
function shouldRequireDeposit(bizSettings, totalPriceCents, totalDurationMin, noShowCount, isVip) {
  if (!bizSettings?.deposit_enabled) return { required: false };
  if (isVip) return { required: false };

  // Check price/duration thresholds
  const priceThresh = bizSettings.deposit_price_threshold_cents || 0;
  const durThresh = bizSettings.deposit_duration_threshold_min || 0;
  const threshMode = bizSettings.deposit_threshold_mode || 'any';

  const priceHit = priceThresh > 0 && totalPriceCents >= priceThresh;
  const durHit = durThresh > 0 && totalDurationMin >= durThresh;

  // Only evaluate threshold if at least one threshold is configured
  const hasThresholds = priceThresh > 0 || durThresh > 0;
  const thresholdTrigger = hasThresholds && (threshMode === 'both' ? (priceHit && durHit) : (priceHit || durHit));

  // Check no-show recidivist
  const noShowThreshold = bizSettings.deposit_noshow_threshold || 2;
  const noShowTrigger = noShowCount >= noShowThreshold;

  if (!thresholdTrigger && !noShowTrigger) return { required: false };

  // Calculate deposit amount
  let depCents = 0;
  if (bizSettings.deposit_type === 'fixed') {
    depCents = bizSettings.deposit_fixed_cents || 2500;
  } else {
    depCents = Math.round(totalPriceCents * (bizSettings.deposit_percent || 50) / 100);
  }

  if (depCents <= 0) return { required: false };

  const reasons = [];
  if (thresholdTrigger) {
    if (priceHit) reasons.push('prix');
    if (durHit) reasons.push('durée');
  }
  if (noShowTrigger) reasons.push('no-show');

  return { required: true, depCents, reason: reasons.join('+') };
}

/**
 * Compute deposit payment deadline.
 * Same logic as booking confirmation: NOW + confirmation_timeout (default 30 min),
 * capped at start_at - 2h minimum. Deposit payment = confirmation.
 * @param {Date} startAt - Appointment start time
 * @param {object} bizSettings - Business settings
 * @returns {Date} deadline
 */
function computeDepositDeadline(startAt, bizSettings) {
  const timeoutMin = parseInt(bizSettings?.booking_confirmation_timeout_min) || 30;
  const confirmDeadline = new Date(Date.now() + timeoutMin * 60000);
  const minBefore = new Date(startAt.getTime() - 2 * 3600000); // 2h before RDV
  // Use confirmation timeout, but don't exceed start_at - 2h
  let deadline = confirmDeadline;
  if (minBefore.getTime() > Date.now() && minBefore < deadline) {
    deadline = minBefore;
  }
  // Safety: deadline must be in the future (at least 5 min from now)
  if (deadline.getTime() < Date.now() + 5 * 60000) {
    deadline = new Date(Date.now() + 5 * 60000);
  }
  return deadline;
}

/**
 * Check if a slot date falls within the last-minute promotional window.
 * @param {string} slotDate - YYYY-MM-DD
 * @param {string} todayBrussels - YYYY-MM-DD (today in Europe/Brussels)
 * @param {string} deadline - 'j-2' | 'j-1' | 'same_day'
 */
function isWithinLastMinuteWindow(slotDate, todayBrussels, deadline) {
  const slot = new Date(slotDate + 'T12:00:00Z');
  const now = new Date(todayBrussels + 'T12:00:00Z');
  const diffDays = Math.round((slot - now) / 86400000);
  if (diffDays < 0) return false;
  switch (deadline) {
    case 'j-2': return diffDays <= 2;
    case 'j-1': return diffDays <= 1;
    case 'same_day': return diffDays === 0;
    default: return false;
  }
}

const SECTOR_PRACTITIONER = {
  coiffeur:'Coiffeur·se', esthetique:'Esthéticien·ne', bien_etre:'Praticien·ne',
  osteopathe:'Ostéopathe', veterinaire:'Vétérinaire', photographe:'Photographe',
  medecin:'Médecin', dentiste:'Dentiste', kine:'Kinésithérapeute',
  comptable:'Collaborateur·rice', avocat:'Avocat·e', autre:'Praticien·ne'
};

// Caches (shared in-memory)
const _nextSlotCache = {};
const _minisiteCache = {};

const BASE_URL = process.env.APP_BASE_URL || process.env.BASE_URL || 'https://genda.be';

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
        // Client already exists in clients table for this business = not first visit
        const existsRes = await txClient.query(
          `SELECT 1 FROM clients WHERE id = $1 AND business_id = $2`,
          [clientId, businessId]
        );
        if (existsRes.rows.length > 0) return { valid: false };
      }
      // clientId is null = new client = first visit OK
      break;
    case 'date_range': {
      const now = new Date();
      if (promo.condition_start_date && now < new Date(promo.condition_start_date)) return { valid: false };
      if (promo.condition_end_date && now > new Date(promo.condition_end_date + 'T23:59:59')) return { valid: false };
      break;
    }
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
      // Discount on the specific service only
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
    // The free service is added to the cart by the frontend
    // The discount = price of the free service
    if (promo.reward_service_id) {
      const freeRes = await txClient.query(
        `SELECT price_cents FROM services WHERE id = $1`, [promo.reward_service_id]
      );
      discount_cents = freeRes.rows[0]?.price_cents || 0;
    }
  } else if (promo.reward_type === 'info_only') {
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

module.exports = {
  UUID_RE, escHtml, stripeRefundDeposit, shouldRequireDeposit,
  computeDepositDeadline, isWithinLastMinuteWindow, SECTOR_PRACTITIONER,
  _nextSlotCache, _minisiteCache, BASE_URL, validateAndCalcPromo
};
