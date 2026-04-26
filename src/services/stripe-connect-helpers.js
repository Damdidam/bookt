/**
 * Stripe Connect helpers — centralise les checks du status Stripe Connect
 * pour les flows backend qui declenchent un checkout (deposit, gift_card, pass).
 *
 * Sans Stripe Connect actif, les liens checkout publics (deposit.js:41,
 * gift-cards-passes.js:51) refusent → bookings bloques + emails casses.
 * Ces helpers permettent de gate les endpoints staff/admin qui activent
 * ces features avant que le client ne reçoive un lien casse.
 */

const { queryWithRLS } = require('./db');

/**
 * Fetch et valide le status Stripe Connect d'un business.
 * @param {string} businessId
 * @returns {Promise<{active: boolean, connectId: string|null, status: string|null}>}
 */
async function getStripeConnectStatus(businessId) {
  const res = await queryWithRLS(businessId,
    `SELECT stripe_connect_id, stripe_connect_status FROM businesses WHERE id = $1`,
    [businessId]
  );
  const row = res.rows[0];
  return {
    active: !!(row?.stripe_connect_id && row.stripe_connect_status === 'active'),
    connectId: row?.stripe_connect_id || null,
    status: row?.stripe_connect_status || null
  };
}

module.exports = { getStripeConnectStatus };
