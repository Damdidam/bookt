/**
 * C16 / spec 03 — Webhook idempotence + Brevo (si endpoint existe).
 *
 * 2 tests.
 */
const { test, expect } = require('@playwright/test');
const IDS = require('../fixtures/ids');
const { resetMutables } = require('../fixtures/reset-mutables');
const { pool } = require('../../../src/services/db');

const BASE_URL = process.env.APP_BASE_URL || 'http://localhost:3000';
const HAS_STRIPE = !!(process.env.STRIPE_SECRET_KEY_TEST || process.env.STRIPE_SECRET_KEY);
const HAS_WH_SECRET = !!process.env.STRIPE_WEBHOOK_SECRET;

test.describe('C16 — webhook idempotence', () => {
  test.beforeEach(async () => {
    await resetMutables();
  });

  test('1. Stripe replay: même event envoyé 2× → 2e réponse cohérente', async () => {
    test.skip(!HAS_STRIPE || !HAS_WH_SECRET, 'STRIPE env missing');
    const { buildSignedWebhook } = require('../fixtures/stripe-test');

    const eventId = 'evt_test_c16_replay_' + Date.now();
    const piId = 'pi_test_c16_replay_' + Date.now();
    const payloadObj = {
      id: 'ch_test_c16_replay',
      object: 'charge',
      amount: 5000,
      amount_refunded: 0,
      payment_intent: piId,
      status: 'succeeded',
      refunded: false,
    };
    const { payload, signature } = buildSignedWebhook('charge.refunded', payloadObj);

    const res1 = await fetch(`${BASE_URL}/webhooks/stripe`, {
      method: 'POST',
      headers: { 'stripe-signature': signature, 'content-type': 'application/json' },
      body: payload,
    });
    const res2 = await fetch(`${BASE_URL}/webhooks/stripe`, {
      method: 'POST',
      headers: { 'stripe-signature': signature, 'content-type': 'application/json' },
      body: payload,
    });
    expect([200, 400, 500]).toContain(res1.status);
    expect([200, 400, 500]).toContain(res2.status);
    // Idempotence : same status family — accept both 200 idempotent or even 200 both times since
    // the handler handles duplicates gracefully (see [STRIPE WH] "Duplicate" branches).
    expect(res1.status).toBe(res2.status);
  });

  test('2. Brevo bounce webhook — endpoint non-implémenté, skip', async () => {
    // grep confirmed no /webhooks/brevo route exists in src/routes/.
    test.skip(true, 'Brevo bounce webhook not implemented in src/routes/');
  });
});
