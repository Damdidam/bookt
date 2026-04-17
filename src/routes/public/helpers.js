const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const escHtml = s => (s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');

/**
 * Attempt Stripe refund for a deposit. Handles both pi_ (PaymentIntent) and cs_ (Checkout Session) IDs.
 * Respects refund_policy ('full' or 'net') from business settings.
 * @param {string} depositPaymentIntentId - stored ID (may be cs_ or pi_)
 * @param {string} label - log label for error messages
 * @param {object} [opts] - optional { refundPolicy, depositAmountCents, bookingId }
 */
async function stripeRefundDeposit(depositPaymentIntentId, label, opts) {
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
      const refundPolicy = opts?.refundPolicy || 'full';
      if (refundPolicy === 'net' && opts?.depositAmountCents && opts?.bookingId) {
        const { query: dbQuery } = require('../../services/db');
        const gcRes = await dbQuery(
          `SELECT COALESCE(SUM(amount_cents), 0) AS gc_paid_cents
           FROM gift_card_transactions WHERE booking_id = $1 AND type = 'debit'`,
          [opts.bookingId]
        );
        const gcPaidCents = parseInt(gcRes.rows[0]?.gc_paid_cents) || 0;
        const actualStripeCharge = Math.max(opts.depositAmountCents - gcPaidCents, 0);
        const stripeFees = actualStripeCharge > 0 ? Math.round(actualStripeCharge * 0.015) + 25 : 0;
        const netRefund = Math.max(actualStripeCharge - stripeFees, 0);
        // D-12 parity: Stripe min 50c. Sous ce seuil → no refund (retention appliquée en amont par le caller).
        if (netRefund >= 50) {
          await stripe.refunds.create({ payment_intent: piId, amount: netRefund });
          console.log(`[${label}] Net refund: ${netRefund}c (fees: ${stripeFees}c, gc: ${gcPaidCents}c) for PI ${piId}`);
        }
      } else {
        await stripe.refunds.create({ payment_intent: piId });
      }
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
function shouldRequireDeposit(bizSettings, totalPriceCents, totalDurationMin, noShowCount, isVip, stripeConnectStatus) {
  if (!bizSettings?.deposit_enabled) return { required: false };
  if (isVip) return { required: false };
  // Deposits require active Stripe Connect — funds go to the merchant
  if (stripeConnectStatus !== 'active') return { required: false };

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
  // Cap deposit at total price (never charge more than the service costs)
  depCents = Math.min(depCents, totalPriceCents);

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
function computeDepositDeadline(startAt, bizSettings, existingDeadline) {
  // Use the business-configured deposit deadline hours (default 48h), not the confirmation timeout
  const hoursDefault = parseInt(bizSettings?.deposit_deadline_hours) || 48;
  const fromNow = new Date(Date.now() + hoursDefault * 3600000);
  const minBefore = new Date(startAt.getTime() - 2 * 3600000); // 2h before RDV
  // Start from existing deadline if still valid, else use NOW + configured hours
  let deadline = existingDeadline && new Date(existingDeadline) > new Date() ? new Date(existingDeadline) : fromNow;
  // Cap at 2h before new start_at
  if (minBefore.getTime() > Date.now() && minBefore < deadline) {
    deadline = minBefore;
  }
  // Safety: deadline must be in the future (at least 20 min from now)
  if (deadline.getTime() < Date.now() + 20 * 60000) {
    deadline = new Date(Date.now() + 20 * 60000);
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
  // SE-3: Support hour-based deadlines (h-24, h-48, etc.)
  const hourMatch = deadline.match(/^h-(\d+)$/);
  if (hourMatch) {
    const hoursAhead = parseInt(hourMatch[1], 10);
    const diffMs = slot.getTime() - Date.now();
    return diffMs >= 0 && diffMs <= hoursAhead * 3600000;
  }
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

/** Drop the minisite cache entry for a business — call after services/promotions/site mutations. */
function invalidateMinisiteCache(businessId) {
  if (!businessId) return;
  delete _minisiteCache[`minisite_${businessId}`];
  // M-02 fix: le "prochain créneau dispo" affiché sur le minisite devient obsolète dès qu'un booking
  // est créé/annulé/déplacé. Purger en même temps que la cache minisite évite d'afficher un créneau
  // déjà pris pendant jusqu'à 5 min.
  delete _nextSlotCache[`nextSlot_${businessId}`];
}

// Periodic cache cleanup every 5 min — delete entries older than their TTL
setInterval(() => {
  const now = Date.now();
  for (const key in _minisiteCache) {
    if (now - _minisiteCache[key].ts > 2 * 60000) delete _minisiteCache[key];
  }
  for (const key in _nextSlotCache) {
    if (now - _nextSlotCache[key].ts > 5 * 60000) delete _nextSlotCache[key];
  }
}, 5 * 60000).unref();

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
 * @param {boolean} isNewClient - true if client record was just created
 * @param {string|null} clientId - existing client UUID (null if new client), used for first_visit check
 */
async function validateAndCalcPromo(txClient, businessId, promotionId, serviceIds, totalPriceCents, isNewClient, clientId, servicePrices, promoEligibleMap) {
  if (!promotionId) return { valid: false };

  // Fetch promo
  const promoRes = await txClient.query(
    `SELECT * FROM promotions WHERE id = $1 AND business_id = $2 AND is_active = true FOR UPDATE`,
    [promotionId, businessId]
  );
  if (promoRes.rows.length === 0) return { valid: false };
  const promo = promoRes.rows[0];

  // M16 fix: Check usage limit
  if (promo.max_uses != null && promo.current_uses >= promo.max_uses) return { valid: false, reason: 'limit_reached' };

  // BUG-M1: Check promo_eligible for regular promos (not just last-minute)
  if (!promoEligibleMap) {
    promoEligibleMap = {};
    if (serviceIds.length > 0) {
      const peRes = await txClient.query(
        `SELECT id, promo_eligible FROM services WHERE id = ANY($1) AND business_id = $2`,
        [serviceIds, businessId]
      );
      peRes.rows.forEach(r => { promoEligibleMap[r.id] = r.promo_eligible !== false; });
    }
  }
  // For specific_service promos, check the targeted service is promo_eligible
  if (promo.condition_type === 'specific_service' && promo.condition_service_id) {
    if (promoEligibleMap[promo.condition_service_id] === false) return { valid: false };
  } else if (promo.reward_type !== 'info_only') {
    // For other promo types, at least one service in the cart must be promo_eligible
    const anyEligible = serviceIds.some(id => promoEligibleMap[id] !== false);
    if (!anyEligible) return { valid: false };
  }

  // Validate condition
  switch (promo.condition_type) {
    case 'specific_service':
      if (!serviceIds.includes(promo.condition_service_id)) return { valid: false };
      break;
    case 'min_amount':
      if (totalPriceCents < promo.condition_min_cents) return { valid: false };
      break;
    case 'first_visit': {
      if (isNewClient) break; // brand new client = definitely first visit
      // Existing client: check booking_count (aligns with frontend check: booking_count === 0)
      const bcRes = await txClient.query(
        `SELECT COUNT(*)::int AS cnt FROM bookings WHERE client_id = $1 AND status NOT IN ('cancelled')`,
        [clientId]
      );
      if (bcRes.rows[0]?.cnt > 0) return { valid: false };
      break;
    }
    case 'date_range': {
      const now = new Date();
      const todayBrussels = now.toLocaleDateString('en-CA', { timeZone: 'Europe/Brussels' });
      if (promo.condition_start_date) {
        const startStr = promo.condition_start_date instanceof Date
          ? promo.condition_start_date.toLocaleDateString('en-CA', { timeZone: 'Europe/Brussels' })
          : String(promo.condition_start_date).slice(0, 10);
        if (todayBrussels < startStr) return { valid: false };
      }
      if (promo.condition_end_date) {
        const endStr = promo.condition_end_date instanceof Date
          ? promo.condition_end_date.toLocaleDateString('en-CA', { timeZone: 'Europe/Brussels' })
          : String(promo.condition_end_date).slice(0, 10);
        if (todayBrussels > endStr) return { valid: false };
      }
      break;
    }
    case 'none':
      break;
    default:
      return { valid: false };
  }

  // Calculate discount
  if (!promo.reward_value && promo.reward_type !== 'info_only' && promo.reward_type !== 'free_service') return { valid: false };
  let discount_cents = 0;
  let discount_pct = null;

  if (promo.reward_type === 'discount_pct') {
    discount_pct = promo.reward_value;
    if (promo.condition_type === 'specific_service') {
      // Use variant-resolved price if available, fall back to DB query
      let svcPrice = servicePrices?.[promo.condition_service_id];
      if (svcPrice == null) {
        const svcRes = await txClient.query(
          `SELECT price_cents FROM services WHERE id = $1`, [promo.condition_service_id]
        );
        svcPrice = svcRes.rows[0]?.price_cents || 0;
      }
      discount_cents = Math.round(svcPrice * promo.reward_value / 100);
    } else {
      discount_cents = Math.round(totalPriceCents * promo.reward_value / 100);
    }
  } else if (promo.reward_type === 'discount_fixed') {
    if (promo.condition_type === 'specific_service') {
      // Use variant-resolved price if available, fall back to DB query
      let svcPrice = servicePrices?.[promo.condition_service_id];
      if (svcPrice == null) {
        const svcRes = await txClient.query(
          `SELECT price_cents FROM services WHERE id = $1`, [promo.condition_service_id]
        );
        svcPrice = svcRes.rows[0]?.price_cents || 0;
      }
      discount_cents = Math.min(promo.reward_value, svcPrice);
    } else {
      discount_cents = Math.min(promo.reward_value, totalPriceCents);
    }
  } else if (promo.reward_type === 'free_service') {
    // The free service must be in the cart (added by frontend)
    if (!promo.reward_service_id || !serviceIds.includes(promo.reward_service_id)) return { valid: false };
    if (promo.reward_service_id) {
      let freePrice = servicePrices?.[promo.reward_service_id];
      if (freePrice == null) {
        const freeRes = await txClient.query(
          `SELECT price_cents FROM services WHERE id = $1`, [promo.reward_service_id]
        );
        freePrice = freeRes.rows[0]?.price_cents || 0;
      }
      discount_cents = freePrice;
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
    reward_service_id: promo.reward_service_id || null,
    condition_type: promo.condition_type,
    condition_service_id: promo.condition_service_id || null
  };
}

/**
 * Decrement promo current_uses when a booking with a promo is cancelled.
 * Safe to call multiple times — only decrements once per booking.
 */
async function decrementPromoUsage(bookingId, dbClient) {
  const q = dbClient ? dbClient.query.bind(dbClient) : require('../../services/db').query;
  // Check primary booking first
  let bk = await q(`SELECT promotion_id, business_id, group_id FROM bookings WHERE id = $1 AND promotion_id IS NOT NULL`, [bookingId]);
  // If primary has no promo but is part of a group, check siblings (promo may be on a non-primary sibling)
  if (bk.rows.length === 0) {
    const grp = await q(`SELECT group_id FROM bookings WHERE id = $1`, [bookingId]);
    if (grp.rows[0]?.group_id) {
      bk = await q(`SELECT promotion_id, business_id FROM bookings WHERE group_id = $1 AND promotion_id IS NOT NULL LIMIT 1`, [grp.rows[0].group_id]);
    }
  }
  if (bk.rows.length === 0) return;
  const { promotion_id, business_id } = bk.rows[0];
  await q(`UPDATE promotions SET current_uses = GREATEST(current_uses - 1, 0) WHERE id = $1 AND business_id = $2`, [promotion_id, business_id]);
}

/**
 * Normalize an email for uniqueness checks:
 * - lowercase + trim
 * - Gmail/Googlemail: strip dots from local part + remove +tag
 * - All providers: remove +tag portion
 */
function normalizeEmail(email) {
  if (!email) return '';
  let [local, domain] = email.toLowerCase().trim().split('@');
  if (!domain) return email.toLowerCase().trim();

  // Strip +tag for all providers
  const plusIdx = local.indexOf('+');
  if (plusIdx > 0) local = local.substring(0, plusIdx);

  // Gmail/Googlemail: dots in local part are ignored
  if (domain === 'gmail.com' || domain === 'googlemail.com') {
    local = local.replace(/\./g, '');
    domain = 'gmail.com'; // normalize googlemail → gmail
  }

  return `${local}@${domain}`;
}

/**
 * Check if an email domain is a disposable/temporary email provider.
 * Returns true if the domain is disposable (should be blocked for signup).
 */
const DISPOSABLE_DOMAINS = new Set([
  'mailinator.com','guerrillamail.com','guerrillamail.net','tempmail.com','throwaway.email',
  'temp-mail.org','fakeinbox.com','sharklasers.com','guerrillamailblock.com','grr.la',
  'dispostable.com','trashmail.com','trashmail.net','yopmail.com','yopmail.fr',
  'maildrop.cc','mailnesia.com','tempail.com','tempr.email','discard.email',
  'mohmal.com','getnada.com','emailondeck.com','33mail.com','maildax.com',
  'jetable.org','trash-mail.com','mytemp.email','temp-mail.io','tempmailo.com',
  'minutemail.com','emailfake.com','crazymailing.com','armyspy.com','dayrep.com',
  'einrot.com','fleckens.hu','gustr.com','jourrapide.com','rhyta.com','superrito.com',
  'teleworm.us','10minutemail.com','10minutemail.net','mailcatch.com'
]);

function isDisposableEmail(email) {
  if (!email) return false;
  const domain = email.toLowerCase().trim().split('@')[1];
  return DISPOSABLE_DOMAINS.has(domain);
}

module.exports = {
  UUID_RE, escHtml, stripeRefundDeposit, shouldRequireDeposit,
  computeDepositDeadline, isWithinLastMinuteWindow, SECTOR_PRACTITIONER,
  _nextSlotCache, _minisiteCache, invalidateMinisiteCache, BASE_URL, validateAndCalcPromo, decrementPromoUsage,
  normalizeEmail, isDisposableEmail
};
