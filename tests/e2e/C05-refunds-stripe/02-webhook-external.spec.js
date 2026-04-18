/**
 * C05 / spec 02 — Stripe webhook external refund cascade.
 *
 * Endpoint: POST /webhooks/stripe  (raw body + stripe-signature header).
 *
 * charge.refunded event:
 *  - amount_refunded === amount (FULL)   → cascade cancel + GC/pass refund +
 *    deposit_status='refunded'.
 *  - amount_refunded <  amount (PARTIAL) → no cascade, pro-only alert.
 *
 * Requires STRIPE_SECRET_KEY_TEST + STRIPE_WEBHOOK_SECRET in env to sign the
 * test payload. If these are missing, skip the spec so the suite stays green.
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

async function insertPaidBooking(piId) {
  const startAt = new Date(Date.now() + 5 * 86400000).toISOString();
  const endAt = new Date(Date.now() + 5 * 86400000 + 3600000).toISOString();
  const r = await pool.query(
    `INSERT INTO bookings (business_id, practitioner_id, service_id, client_id, start_at, end_at,
       status, appointment_mode, public_token, deposit_required, deposit_status,
       deposit_payment_intent_id, deposit_amount_cents, deposit_paid_at, booked_price_cents, locked)
     VALUES ($1, $2, $3, $4, $5, $6, 'confirmed', 'cabinet', encode(gen_random_bytes(8),'hex'),
       true, 'paid', $7, 10000, NOW(), 20000, true)
     RETURNING id, public_token`,
    [IDS.BUSINESS, IDS.PRAC_ALICE, IDS.SVC_EXPENSIVE, IDS.CLIENT_JEAN,
     startAt, endAt, piId]
  );
  return r.rows[0].id;
}

test.describe('C05 — webhook external refund (charge.refunded)', () => {
  test.beforeEach(async () => {
    await resetMutables();
  });
  test.skip(!HAS_STRIPE || !HAS_WH_SECRET,
    'STRIPE_SECRET_KEY_TEST + STRIPE_WEBHOOK_SECRET required to sign webhook payloads');

  test('1. Full refund via Stripe Dashboard → booking cancelled + deposit_status=refunded', async () => {
    const { buildSignedWebhook } = require('../fixtures/stripe-test');
    const piId = 'pi_test_wh_full_' + Date.now();
    const bkId = await insertPaidBooking(piId);

    const { payload, signature } = buildSignedWebhook('charge.refunded', {
      id: 'ch_test_' + Date.now(),
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
    expect(res.status).toBe(200);

    // Allow a beat for async processing
    await new Promise(r => setTimeout(r, 500));

    const after = await pool.query(
      `SELECT status, deposit_status, cancel_reason FROM bookings WHERE id = $1`,
      [bkId]
    );
    expect(after.rows[0].status).toBe('cancelled');
    expect(after.rows[0].deposit_status).toBe('refunded');
  });

  test('2. Partial refund via Stripe Dashboard → booking NOT cancelled', async () => {
    const { buildSignedWebhook } = require('../fixtures/stripe-test');
    const piId = 'pi_test_wh_partial_' + Date.now();
    const bkId = await insertPaidBooking(piId);

    const { payload, signature } = buildSignedWebhook('charge.refunded', {
      id: 'ch_test_' + Date.now(),
      object: 'charge',
      amount: 10000,
      amount_refunded: 3000, // partial
      payment_intent: piId,
      status: 'succeeded',
      refunded: false,
    });
    const res = await fetch(`${BASE_URL}/webhooks/stripe`, {
      method: 'POST',
      headers: { 'stripe-signature': signature, 'content-type': 'application/json' },
      body: payload,
    });
    expect(res.status).toBe(200);

    await new Promise(r => setTimeout(r, 500));

    const after = await pool.query(
      `SELECT status, deposit_status FROM bookings WHERE id = $1`,
      [bkId]
    );
    // Booking STAYS confirmed (partial refund shouldn't cascade cancel)
    expect(after.rows[0].status).toBe('confirmed');
    expect(after.rows[0].deposit_status).toBe('paid');
  });
});
