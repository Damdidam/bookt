/**
 * Retrieve the actual Stripe processing fee for a payment, when available.
 *
 * The old pattern `Math.round(charge * 0.015) + 25` assumes Visa/MasterCard
 * pricing (1.5% + 25c). Bancontact payments (enabled in our Checkout sessions)
 * are billed at a flat 0.24 € regardless of amount → the estimate over-charges
 * the client on every Bancontact refund. For a 10 € deposit Bancontact,
 *   estimate: round(1000 * 0.015) + 25 = 40c
 *   reality:                             24c
 * so the client receives 16c less than they should.
 *
 * This helper asks Stripe for the real fee via balance_transaction. If the
 * lookup fails for any reason (network, insufficient scope, PI not yet
 * settled), the caller keeps the historical estimate as a safe fallback.
 */

async function getActualStripeFeeCents(stripe, paymentIntentId) {
  if (!stripe || !paymentIntentId) return null;
  try {
    const pi = await stripe.paymentIntents.retrieve(paymentIntentId, {
      expand: ['latest_charge.balance_transaction']
    });
    const ch = pi?.latest_charge;
    // `ch` is either an expanded object or null; fallback to searching charges list.
    let bt = ch && typeof ch === 'object' ? ch.balance_transaction : null;
    if (!bt && pi?.charges?.data?.length) {
      const successCharge = pi.charges.data.find(c => c.status === 'succeeded') || pi.charges.data[0];
      bt = successCharge?.balance_transaction || null;
    }
    if (!bt) return null;
    if (typeof bt === 'object' && typeof bt.fee === 'number') return bt.fee;
    if (typeof bt === 'string') {
      const bal = await stripe.balanceTransactions.retrieve(bt);
      if (typeof bal?.fee === 'number') return bal.fee;
    }
    return null;
  } catch (err) {
    console.warn('[STRIPE FEE] lookup failed for', paymentIntentId, '-', err.message);
    return null;
  }
}

/**
 * Historical estimate — kept as fallback when the real fee is unavailable.
 * Kept in one place so we don't drift across call sites.
 */
function estimateStripeFeeCents(grossCents) {
  const g = parseInt(grossCents) || 0;
  if (g <= 0) return 0;
  return Math.round(g * 0.015) + 25;
}

/**
 * Resolve the fee for a refund computation: real fee if we can reach Stripe,
 * otherwise estimate. Returns 0 when the gross charge is 0.
 */
async function resolveStripeFeeCents(stripe, paymentIntentId, grossCents) {
  const gross = parseInt(grossCents) || 0;
  if (gross <= 0) return 0;
  const real = await getActualStripeFeeCents(stripe, paymentIntentId);
  if (real != null && real >= 0) return real;
  return estimateStripeFeeCents(gross);
}

module.exports = { getActualStripeFeeCents, estimateStripeFeeCents, resolveStripeFeeCents };
