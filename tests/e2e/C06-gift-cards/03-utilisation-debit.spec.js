/**
 * C06 / spec 03 — Staff manual debit (use gift card in salon).
 *
 * Endpoint:
 *   POST /api/gift-cards/:id/debit  — body { amount_cents, booking_id?, note? }
 *
 * Rules (route:198) :
 *   - amount_cents <= 0 → 400 "Montant invalide"
 *   - GC status !== 'active' → 400 "Cette carte n'est plus active"
 *   - balance < amount → 400 "Solde insuffisant"
 *   - Success : balance -= amount, status='used' si balance=0 sinon 'active'
 *
 * 3 tests.
 */
const { test, expect } = require('@playwright/test');
const IDS = require('../fixtures/ids');
const { staffFetch } = require('../fixtures/api-client');
const { resetMutables } = require('../fixtures/reset-mutables');
const { pool } = require('../../../src/services/db');

test.describe('C06 — staff gc debit', () => {
  test.beforeEach(async () => {
    await resetMutables();
  });

  test('1. Staff manual debit — balance decreases + transaction logged', async () => {
    // GC_ACTIVE reset → balance_cents=10000 after resetMutables
    const res = await staffFetch(`/api/gift-cards/${IDS.GC_ACTIVE}/debit`, {
      method: 'POST',
      body: { amount_cents: 2000, note: 'Debit C06 test' },
    });
    expect(res.status, `Debit error: ${JSON.stringify(res.body)}`).toBe(200);
    expect(res.body.balance_cents).toBe(8000);
    expect(res.body.status).toBe('active');

    // DB verify
    const r = await pool.query(
      `SELECT balance_cents, status FROM gift_cards WHERE id = $1`,
      [IDS.GC_ACTIVE]
    );
    expect(r.rows[0].balance_cents).toBe(8000);
    expect(r.rows[0].status).toBe('active');

    // Transaction logged
    const tx = await pool.query(
      `SELECT amount_cents, type, note FROM gift_card_transactions
       WHERE gift_card_id = $1 AND type = 'debit' ORDER BY created_at DESC LIMIT 1`,
      [IDS.GC_ACTIVE]
    );
    expect(tx.rows.length).toBe(1);
    expect(tx.rows[0].amount_cents).toBe(2000);
    expect(tx.rows[0].note).toBe('Debit C06 test');
  });

  test('2. Staff debit > balance — 400 Solde insuffisant', async () => {
    // GC_ACTIVE reset → 10000 balance. Try debit 20000.
    const res = await staffFetch(`/api/gift-cards/${IDS.GC_ACTIVE}/debit`, {
      method: 'POST',
      body: { amount_cents: 20000 },
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Solde insuffisant/i);

    // DB unchanged
    const r = await pool.query(
      `SELECT balance_cents FROM gift_cards WHERE id = $1`,
      [IDS.GC_ACTIVE]
    );
    expect(r.rows[0].balance_cents).toBe(10000);
  });

  test('3. Staff debit on cancelled GC — 400 carte plus active', async () => {
    // Null stripe_PI first, then cancel GC_ACTIVE
    await pool.query(
      `UPDATE gift_cards SET stripe_payment_intent_id = NULL, status = 'cancelled' WHERE id = $1`,
      [IDS.GC_ACTIVE]
    );

    const res = await staffFetch(`/api/gift-cards/${IDS.GC_ACTIVE}/debit`, {
      method: 'POST',
      body: { amount_cents: 1000 },
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/plus active|n'est plus/i);
  });
});
