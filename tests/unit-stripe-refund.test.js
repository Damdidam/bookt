/**
 * Unit tests : src/services/stripe-refund.js createRefund helper.
 * Mock Stripe SDK pour vérifier :
 * - reverse_transfer:true appliqué si Connect
 * - refund_application_fee:true uniquement si full refund (no amount)
 * - Charge directe plateforme (pas Connect) → NO reverse_transfer
 * - idempotencyKey propagé
 * - PI retrieve fail → fallback NON-Connect (safer)
 *
 * Exécution : `node tests/unit-stripe-refund.test.js`
 */
const { createRefund } = require('../src/services/stripe-refund');

function assert(cond, msg) {
  if (!cond) { console.error('✗ FAIL:', msg); process.exit(1); }
}

// Fabrique un mock Stripe retournant un PI contrôlable + capture le refund call.
function mockStripe(piOverride, retrieveThrows) {
  const calls = { retrieve: null, refundParams: null, refundOptions: null };
  return {
    _calls: calls,
    paymentIntents: {
      retrieve: async (piId) => {
        calls.retrieve = piId;
        if (retrieveThrows) throw new Error(retrieveThrows);
        return piOverride;
      }
    },
    refunds: {
      create: async (params, options) => {
        calls.refundParams = params;
        calls.refundOptions = options;
        return { id: 're_mock', amount: params.amount || 5000 };
      }
    }
  };
}

(async () => {
  // Case 1 : Connect charge, full refund (no amount)
  const s1 = mockStripe({ transfer_data: { destination: 'acct_X' }, application_fee_amount: 150 });
  await createRefund(s1, { payment_intent: 'pi_1' }, 'idem-1');
  assert(s1._calls.refundParams.reverse_transfer === true, 'Case 1: reverse_transfer true');
  assert(s1._calls.refundParams.refund_application_fee === true, 'Case 1: refund_application_fee true (full refund)');
  assert(s1._calls.refundParams.payment_intent === 'pi_1', 'Case 1: PI propagated');
  assert(s1._calls.refundOptions.idempotencyKey === 'idem-1', 'Case 1: idempotencyKey propagated');

  // Case 2 : Connect charge, partial refund (with amount)
  const s2 = mockStripe({ transfer_data: { destination: 'acct_X' } });
  await createRefund(s2, { payment_intent: 'pi_2', amount: 3000 }, 'idem-2');
  assert(s2._calls.refundParams.reverse_transfer === true, 'Case 2: reverse_transfer true');
  assert(s2._calls.refundParams.refund_application_fee === undefined, 'Case 2: NO refund_application_fee (partial)');
  assert(s2._calls.refundParams.amount === 3000, 'Case 2: amount propagated');

  // Case 3 : NON-Connect (direct charge) — pas de transfer_data, pas d'app_fee
  const s3 = mockStripe({ transfer_data: null, application_fee_amount: null });
  await createRefund(s3, { payment_intent: 'pi_3' }, 'idem-3');
  assert(s3._calls.refundParams.reverse_transfer === undefined, 'Case 3: NO reverse_transfer (direct charge)');
  assert(s3._calls.refundParams.refund_application_fee === undefined, 'Case 3: NO refund_application_fee (direct charge)');

  // Case 4 : NON-Connect mais application_fee_amount présent (edge) → Connect path
  const s4 = mockStripe({ transfer_data: null, application_fee_amount: 150 });
  await createRefund(s4, { payment_intent: 'pi_4' }, 'idem-4');
  assert(s4._calls.refundParams.reverse_transfer === true, 'Case 4: app_fee present → Connect path');

  // Case 5 : PI retrieve throw (rate limit, already captured, etc.) → fallback NON-Connect
  const s5 = mockStripe(null, 'rate_limited');
  await createRefund(s5, { payment_intent: 'pi_5' }, 'idem-5');
  assert(s5._calls.refundParams.reverse_transfer === undefined, 'Case 5: retrieve fail → safer fallback (no reverse_transfer)');
  assert(s5._calls.refundParams.payment_intent === 'pi_5', 'Case 5: refund still attempted');

  // Case 6 : no payment_intent param → skip retrieve, skip Connect detection
  const s6 = mockStripe({});
  await createRefund(s6, { charge: 'ch_6' }, 'idem-6');
  assert(s6._calls.retrieve === null, 'Case 6: no PI → no retrieve');
  assert(s6._calls.refundParams.reverse_transfer === undefined, 'Case 6: no reverse_transfer');
  assert(s6._calls.refundParams.charge === 'ch_6', 'Case 6: charge propagated');

  // Case 7 : no idempotencyKey → pas d'options arg (ou undefined)
  const s7 = mockStripe({ transfer_data: { destination: 'acct_Y' } });
  await createRefund(s7, { payment_intent: 'pi_7' }); // 3e arg absent
  assert(s7._calls.refundOptions === undefined, 'Case 7: no idem → options undefined');

  // Case 8 : amount=null explicit → full refund path
  const s8 = mockStripe({ transfer_data: { destination: 'acct_Z' } });
  await createRefund(s8, { payment_intent: 'pi_8', amount: null }, 'idem-8');
  assert(s8._calls.refundParams.refund_application_fee === true, 'Case 8: amount=null → full refund');

  // Case 9 : amount=0 (partial refund 0) → partial path
  const s9 = mockStripe({ transfer_data: { destination: 'acct_W' } });
  await createRefund(s9, { payment_intent: 'pi_9', amount: 0 }, 'idem-9');
  assert(s9._calls.refundParams.refund_application_fee === undefined, 'Case 9: amount=0 → partial path (no refund_app_fee)');

  console.log('✓ createRefund — 9 cases OK');
  console.log('\n✓ stripe-refund.js unit tests PASS (15 assertions)');
  process.exit(0);
})().catch(e => { console.error('✗ Uncaught:', e.message); process.exit(1); });
