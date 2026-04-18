/**
 * C05 / spec 03 — Staff GC refund + pass refund (single session) + pass refund-full.
 *
 * Endpoints:
 *   POST /api/gift-cards/:id/refund      — body { amount_cents, note, booking_id? }
 *   POST /api/passes/:id/refund          — body { booking_id?, note }  → +1 session
 *   POST /api/passes/:id/refund-full     — body { reason? } → status=cancelled, sessions_remaining=0
 *
 * refund-full Stripe refund branch requires STRIPE_SECRET_KEY — without it +
 * stripe_payment_intent_id set, the endpoint returns 500. The seed pass doesn't
 * have a real PI, so we null it before refund-full to isolate the DB-only path.
 *
 * 3 tests.
 */
const { test, expect } = require('@playwright/test');
const IDS = require('../fixtures/ids');
const { staffFetch } = require('../fixtures/api-client');
const { resetMutables } = require('../fixtures/reset-mutables');
const { pool } = require('../../../src/services/db');

test.describe('C05 — staff gc + pass refund', () => {
  test.beforeEach(async () => {
    await resetMutables();
  });

  test('1. GC refund — balance increases + refund transaction logged', async () => {
    // Force GC_PARTIAL balance to 3000 (below its amount 10000) so refund is possible
    await pool.query(
      `UPDATE gift_cards SET balance_cents = 3000, status = 'active' WHERE id = $1`,
      [IDS.GC_PARTIAL]
    );

    const res = await staffFetch(`/api/gift-cards/${IDS.GC_PARTIAL}/refund`, {
      method: 'POST',
      body: { amount_cents: 2000, note: 'test refund' },
    });
    expect(res.status, `GC refund error: ${JSON.stringify(res.body)}`).toBe(200);
    expect(res.body.balance_cents).toBe(5000);

    const tx = await pool.query(
      `SELECT amount_cents, type FROM gift_card_transactions
       WHERE gift_card_id = $1 AND type = 'refund' ORDER BY created_at DESC LIMIT 1`,
      [IDS.GC_PARTIAL]
    );
    expect(tx.rows.length).toBe(1);
    expect(tx.rows[0].amount_cents).toBe(2000);
  });

  test('2. Pass refund-full — status=cancelled + sessions_remaining=0', async () => {
    // PASS_ACTIVE seed has stripe_payment_intent_id — null it so the endpoint
    // doesn't try to call Stripe and 500 on missing key.
    await pool.query(
      `UPDATE passes SET stripe_payment_intent_id = NULL, status = 'active', sessions_remaining = 5
       WHERE id = $1`,
      [IDS.PASS_ACTIVE]
    );

    const res = await staffFetch(`/api/passes/${IDS.PASS_ACTIVE}/refund-full`, {
      method: 'POST',
      body: { reason: 'test refund-full' },
    });
    expect(res.status, `Refund-full error: ${JSON.stringify(res.body)}`).toBe(200);
    expect(res.body.ok).toBe(true);

    const after = await pool.query(
      `SELECT status, sessions_remaining FROM passes WHERE id = $1`,
      [IDS.PASS_ACTIVE]
    );
    expect(after.rows[0].status).toBe('cancelled');
    expect(after.rows[0].sessions_remaining).toBe(0);

    // Audit log check
    const tx = await pool.query(
      `SELECT sessions, type FROM pass_transactions
       WHERE pass_id = $1 AND type = 'refund' ORDER BY created_at DESC LIMIT 1`,
      [IDS.PASS_ACTIVE]
    );
    expect(tx.rows.length).toBe(1);
    expect(tx.rows[0].sessions).toBe(5);
  });

  test('3. Pass refund +1 session — sessions_remaining increments', async () => {
    // Need sessions_remaining < sessions_total to refund
    await pool.query(
      `UPDATE passes SET sessions_remaining = 3, status = 'active' WHERE id = $1`,
      [IDS.PASS_ACTIVE]
    );

    const before = await pool.query(
      `SELECT sessions_remaining FROM passes WHERE id = $1`,
      [IDS.PASS_ACTIVE]
    );
    const remBefore = before.rows[0].sessions_remaining;

    const res = await staffFetch(`/api/passes/${IDS.PASS_ACTIVE}/refund`, {
      method: 'POST',
      body: { note: 'test +1 session' },
    });
    expect(res.status, `Pass refund error: ${JSON.stringify(res.body)}`).toBe(200);

    const after = await pool.query(
      `SELECT sessions_remaining, status FROM passes WHERE id = $1`,
      [IDS.PASS_ACTIVE]
    );
    expect(after.rows[0].sessions_remaining).toBe(remBefore + 1);
    expect(after.rows[0].status).toBe('active');
  });
});
