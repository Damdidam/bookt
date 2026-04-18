/**
 * Central Stripe client helper.
 * For Phase 1 infra: reads STRIPE_SECRET_KEY globally (tests set it to test key via .env.test).
 * The `business` parameter is accepted for Phase 2+ compatibility (business-scoped keys),
 * currently routed to global env.
 */
function getStripeClient(business) {
  const useTestKey = business?.is_test_account === true;
  const key = useTestKey
    ? (process.env.STRIPE_SECRET_KEY_TEST || process.env.STRIPE_SECRET_KEY)
    : process.env.STRIPE_SECRET_KEY;
  if (!key) {
    throw new Error('STRIPE_SECRET_KEY missing in env');
  }
  return require('stripe')(key);
}

module.exports = { getStripeClient };
