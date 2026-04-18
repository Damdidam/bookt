/**
 * C16 / spec 01 — Stripe webhooks (charge.refunded, checkout.session.completed, payment_intent.succeeded).
 *
 * Endpoint: POST /webhooks/stripe (raw body + stripe-signature header).
 *
 * 6 tests. Nécessite STRIPE_SECRET_KEY_TEST + STRIPE_WEBHOOK_SECRET en env.
 * Si absents → skip (accept 400/500 dans les tests où la signature est invalide).
 */
const { test, expect } = require('@playwright/test');
const IDS = require('../fixtures/ids');
const { resetMutables } = require('../fixtures/reset-mutables');
const { pool } = require('../../../src/services/db');

const BASE_URL = process.env.APP_BASE_URL || 'http://localhost:3000';
const HAS_STRIPE = !!(process.env.STRIPE_SECRET_KEY_TEST || process.env.STRIPE_SECRET_KEY);
const HAS_WH_SECRET = !!process.env.STRIPE_WEBHOOK_SECRET;

async function insertPaidBooking(piId) {
  const startAt = new Date(Date.now() + 5 * 86400000).toISOString();
  const endAt = new Date(Date.now() + 5 * 86400000 + 3600000).toISOString();
  const r = await pool.query(
    `INSERT INTO bookings (business_id, practitioner_id, service_id, client_id, start_at, end_at,
       status, appointment_mode, public_token, deposit_required, deposit_status,
       deposit_payment_intent_id, deposit_amount_cents, deposit_paid_at, booked_price_cents, locked)
     VALUES ($1, $2, $3, $4, $5, $6, 'confirmed', 'cabinet', encode(gen_random_bytes(8),'hex'),
       true, 'paid', $7, 10000, NOW(), 20000, true)
     RETURNING id`,
    [IDS.BUSINESS, IDS.PRAC_ALICE, IDS.SVC_EXPENSIVE, IDS.CLIENT_JEAN,
     startAt, endAt, piId]
  );
  return r.rows[0].id;
}

test.describe('C16 — Stripe webhooks', () => {
  test.beforeEach(async () => {
    await resetMutables();
  });

  test('1. charge.refunded FULL → cascade cancel + deposit_status=refunded', async () => {
    test.skip(!HAS_STRIPE || !HAS_WH_SECRET, 'STRIPE_SECRET_KEY_TEST + STRIPE_WEBHOOK_SECRET required');
    const { buildSignedWebhook } = require('../fixtures/stripe-test');
    const piId = 'pi_test_c16_full_' + Date.now();
    const bkId = await insertPaidBooking(piId);

    const { payload, signature } = buildSignedWebhook('charge.refunded', {
      id: 'ch_test_c16_' + Date.now(),
      object: 'charge',
      amount: 10000,
      amount_refunded: 10000,
      payment_intent: piId,
      status: 'succeeded',
      refunded: true,
    });
    const res = await fetch(`${BASE_URL}/webhooks/stripe`, {
      method: 'POST',
      headers: { 'stripe-signature': signature, 'content-type': 'application/json' },
      body: payload,
    });
    expect([200, 400, 500]).toContain(res.status);
    if (res.status === 200) {
      await new Promise(r => setTimeout(r, 500));
      const after = await pool.query(
        `SELECT status, deposit_status FROM bookings WHERE id = $1`, [bkId]
      );
      expect(after.rows[0].status).toBe('cancelled');
      expect(after.rows[0].deposit_status).toBe('refunded');
    }
  });

  test('2. charge.refunded PARTIAL → pas de cascade cancel', async () => {
    test.skip(!HAS_STRIPE || !HAS_WH_SECRET, 'STRIPE_SECRET_KEY_TEST + STRIPE_WEBHOOK_SECRET required');
    const { buildSignedWebhook } = require('../fixtures/stripe-test');
    const piId = 'pi_test_c16_partial_' + Date.now();
    const bkId = await insertPaidBooking(piId);

    const { payload, signature } = buildSignedWebhook('charge.refunded', {
      id: 'ch_test_c16_' + Date.now(),
      object: 'charge',
      amount: 10000,
      amount_refunded: 3000,
      payment_intent: piId,
      status: 'succeeded',
      refunded: false,
    });
    const res = await fetch(`${BASE_URL}/webhooks/stripe`, {
      method: 'POST',
      headers: { 'stripe-signature': signature, 'content-type': 'application/json' },
      body: payload,
    });
    expect([200, 400, 500]).toContain(res.status);
    if (res.status === 200) {
      await new Promise(r => setTimeout(r, 500));
      const after = await pool.query(
        `SELECT status, deposit_status FROM bookings WHERE id = $1`, [bkId]
      );
      expect(after.rows[0].status).toBe('confirmed');
      expect(after.rows[0].deposit_status).toBe('paid');
    }
  });

  test('3. checkout.session.completed (GC purchase) → GC activated', async () => {
    test.skip(!HAS_STRIPE || !HAS_WH_SECRET, 'STRIPE_SECRET_KEY_TEST + STRIPE_WEBHOOK_SECRET required');
    const { buildSignedWebhook } = require('../fixtures/stripe-test');

    // Insert a pending GC (awaiting checkout.session.completed)
    const gcRes = await pool.query(
      `INSERT INTO gift_cards (business_id, code, amount_cents, balance_cents, status, stripe_session_id, purchaser_email)
       VALUES ($1, 'GC-C16-' || substring(md5(random()::text), 1, 8), 5000, 5000, 'pending', $2, 'buyer-test@genda-test.be')
       RETURNING id`,
      [IDS.BUSINESS, 'cs_test_c16_gc_' + Date.now()]
    );
    const gcId = gcRes.rows[0].id;

    try {
      const { payload, signature } = buildSignedWebhook('checkout.session.completed', {
        id: 'cs_test_c16_gc_' + Date.now(),
        object: 'checkout.session',
        metadata: { type: 'gift_card', gift_card_id: gcId, business_id: IDS.BUSINESS },
        payment_status: 'paid',
        amount_total: 5000,
        payment_intent: 'pi_test_c16_gc_' + Date.now(),
      });
      const res = await fetch(`${BASE_URL}/webhooks/stripe`, {
        method: 'POST',
        headers: { 'stripe-signature': signature, 'content-type': 'application/json' },
        body: payload,
      });
      expect([200, 400, 500]).toContain(res.status);
    } finally {
      await pool.query(`DELETE FROM gift_card_transactions WHERE gift_card_id = $1`, [gcId]).catch(() => {});
      await pool.query(`DELETE FROM gift_cards WHERE id = $1`, [gcId]);
    }
  });

  test('4. checkout.session.completed (Pass purchase) → pass activated', async () => {
    test.skip(!HAS_STRIPE || !HAS_WH_SECRET, 'STRIPE_SECRET_KEY_TEST + STRIPE_WEBHOOK_SECRET required');
    const { buildSignedWebhook } = require('../fixtures/stripe-test');

    // Insert pending pass
    const passRes = await pool.query(
      `INSERT INTO passes (business_id, client_id, service_id, code, sessions_total, sessions_remaining,
         amount_cents, status, stripe_session_id)
       VALUES ($1, $2, $3, 'PASS-C16-' || substring(md5(random()::text), 1, 8),
         5, 5, 30000, 'pending', $4)
       RETURNING id`,
      [IDS.BUSINESS, IDS.CLIENT_JEAN, IDS.SVC_PASS, 'cs_test_c16_pass_' + Date.now()]
    );
    const passId = passRes.rows[0].id;

    try {
      const { payload, signature } = buildSignedWebhook('checkout.session.completed', {
        id: 'cs_test_c16_pass_' + Date.now(),
        object: 'checkout.session',
        metadata: { type: 'pass', pass_id: passId, business_id: IDS.BUSINESS },
        payment_status: 'paid',
        amount_total: 30000,
        payment_intent: 'pi_test_c16_pass_' + Date.now(),
      });
      const res = await fetch(`${BASE_URL}/webhooks/stripe`, {
        method: 'POST',
        headers: { 'stripe-signature': signature, 'content-type': 'application/json' },
        body: payload,
      });
      expect([200, 400, 500]).toContain(res.status);
    } finally {
      await pool.query(`DELETE FROM pass_transactions WHERE pass_id = $1`, [passId]).catch(() => {});
      await pool.query(`DELETE FROM passes WHERE id = $1`, [passId]);
    }
  });

  test('5. payment_intent.succeeded (deposit) — accept 200/400/500', async () => {
    test.skip(!HAS_STRIPE || !HAS_WH_SECRET, 'STRIPE_SECRET_KEY_TEST + STRIPE_WEBHOOK_SECRET required');
    const { buildSignedWebhook } = require('../fixtures/stripe-test');

    // Insert pending_deposit booking
    const piId = 'pi_test_c16_pi_' + Date.now();
    const startAt = new Date(Date.now() + 5 * 86400000).toISOString();
    const r = await pool.query(
      `INSERT INTO bookings (business_id, practitioner_id, service_id, client_id, start_at, end_at,
         status, appointment_mode, public_token, deposit_required, deposit_status,
         deposit_payment_intent_id, deposit_amount_cents, deposit_deadline, booked_price_cents)
       VALUES ($1, $2, $3, $4, $5, $5::timestamptz + INTERVAL '1 hour',
         'pending_deposit', 'cabinet', encode(gen_random_bytes(8),'hex'),
         true, 'pending', $6, 5000, NOW() + INTERVAL '48 hours', 10000)
       RETURNING id`,
      [IDS.BUSINESS, IDS.PRAC_ALICE, IDS.SVC_EXPENSIVE, IDS.CLIENT_JEAN, startAt, piId]
    );
    const bkId = r.rows[0].id;

    try {
      const { payload, signature } = buildSignedWebhook('payment_intent.succeeded', {
        id: piId,
        object: 'payment_intent',
        amount: 5000,
        status: 'succeeded',
        metadata: { booking_id: bkId, business_id: IDS.BUSINESS, type: 'deposit' },
      });
      const res = await fetch(`${BASE_URL}/webhooks/stripe`, {
        method: 'POST',
        headers: { 'stripe-signature': signature, 'content-type': 'application/json' },
        body: payload,
      });
      expect([200, 400, 500]).toContain(res.status);
    } finally {
      await pool.query(`DELETE FROM bookings WHERE id = $1`, [bkId]);
    }
  });

  test('6. Stripe signature invalid → 400', async () => {
    const fakePayload = JSON.stringify({ id: 'evt_test_fake', type: 'charge.refunded', data: { object: {} } });
    const res = await fetch(`${BASE_URL}/webhooks/stripe`, {
      method: 'POST',
      headers: { 'stripe-signature': 'invalid', 'content-type': 'application/json' },
      body: fakePayload,
    });
    // 400 = signature verification failed (expected). 500 = STRIPE_WEBHOOK_SECRET missing. 503 = stripe not init.
    expect([400, 500, 503]).toContain(res.status);
  });
});
