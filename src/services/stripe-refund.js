/**
 * Stripe refund helper — wrap stripe.refunds.create avec les paramètres Connect
 * corrects pour TOUS les destination charges (deposits, passes, gift cards).
 *
 * BUG P0 avant ce helper : les 21 sites appelaient `stripe.refunds.create({payment_intent})`
 * SANS reverse_transfer → sur destination charges (Connect), Stripe remboursait le client
 * depuis le SOLDE PLATEFORME, les merchants conservaient les fonds transférés.
 * Résultat : Genda payait 100% de chaque refund Connect.
 *
 * Fix : `reverse_transfer: true` TOUJOURS, `refund_application_fee: true` si FULL refund
 * (pas d'amount spécifié → on veut rembourser aussi l'application fee plateforme).
 * Pour partial refund (amount spécifié, ex: policy=net), la plateforme garde son app fee.
 *
 * @param {Object} stripe - Stripe SDK instance
 * @param {Object} params - refund params: { payment_intent, amount?, ... }
 * @param {string} idempotencyKey - key stable ou bucket selon contexte
 */
async function createRefund(stripe, params, idempotencyKey) {
  const refundParams = {
    ...params,
    reverse_transfer: true,  // destination charge → récupérer le transfer du merchant
  };
  // Full refund (no amount) → rembourser aussi l'application fee plateforme
  // Partial refund (amount specified, ex policy=net) → plateforme garde app fee
  if (params.amount === undefined || params.amount === null) {
    refundParams.refund_application_fee = true;
  }
  const options = idempotencyKey ? { idempotencyKey } : undefined;
  return stripe.refunds.create(refundParams, options);
}

module.exports = { createRefund };
