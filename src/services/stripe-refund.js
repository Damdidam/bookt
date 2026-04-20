/**
 * Stripe refund helper — wrap stripe.refunds.create avec les paramètres Connect
 * corrects pour TOUS les destination charges (deposits, passes, gift cards).
 *
 * BUG P0 avant ce helper : les 21 sites appelaient `stripe.refunds.create({payment_intent})`
 * SANS reverse_transfer → sur destination charges (Connect), Stripe remboursait le client
 * depuis le SOLDE PLATEFORME, les merchants conservaient les fonds transférés.
 * Résultat : Genda payait 100% de chaque refund Connect.
 *
 * Fix auto-détection Connect :
 * - Retrieve le PI pour lire `transfer_data`
 * - Si Connect (transfer_data ou application_fee_amount présent) → reverse_transfer: true
 * - Si charge directe plateforme (biz sans Stripe Connect) → pas de reverse_transfer
 *   (évite Stripe error "reverse_transfer can only be used with destination charges")
 *
 * Pour les cas Connect :
 * - Full refund (no amount) → refund_application_fee: true (plateforme refund sa fee)
 * - Partial refund (amount spécifié, ex policy=net) → plateforme garde app fee
 *
 * @param {Object} stripe - Stripe SDK instance
 * @param {Object} params - refund params: { payment_intent, amount?, ... }
 * @param {string} idempotencyKey - key stable ou bucket selon contexte
 */
async function createRefund(stripe, params, idempotencyKey) {
  const refundParams = { ...params };

  // Auto-détection Connect : fetch PI pour déterminer si destination charge.
  // Ce retrieve coûte ~100ms mais évite les erreurs Stripe sur charges directes
  // (GC/Pass vendus par biz sans Stripe Connect actif).
  let isConnectCharge = false;
  if (params.payment_intent) {
    try {
      const pi = await stripe.paymentIntents.retrieve(params.payment_intent);
      // Connect destination charge si transfer_data.destination OU application_fee_amount
      // (Stripe pose l'un ou l'autre quand le charge est routé vers un Connect account).
      isConnectCharge = !!(
        (pi.transfer_data && pi.transfer_data.destination) ||
        pi.application_fee_amount
      );
    } catch (e) {
      // En cas d'erreur retrieve (PI déjà captured, rate limit, etc.) on
      // assume NON-Connect pour safety (meilleur faux négatif qu'un crash
      // reverse_transfer sur charge directe).
      console.warn('[STRIPE REFUND] PI retrieve failed for Connect detection:', e.message);
      isConnectCharge = false;
    }
  }

  if (isConnectCharge) {
    refundParams.reverse_transfer = true;
    // Full refund (no amount) → rembourser aussi l'application fee plateforme.
    // Partial refund (amount spécifié, ex policy=net) → plateforme garde app fee.
    if (params.amount === undefined || params.amount === null) {
      refundParams.refund_application_fee = true;
    }
  }
  // Sinon (charge directe plateforme) : pas de reverse_transfer — Stripe refund
  // depuis la plateforme simplement, aucun transfer à reverser.

  const options = idempotencyKey ? { idempotencyKey } : undefined;
  return stripe.refunds.create(refundParams, options);
}

module.exports = { createRefund };
