/**
 * C06 / spec 01 — Staff GC CRUD (create, list, cancel, guard M3).
 *
 * Endpoints:
 *   POST   /api/gift-cards            — create GC (staff)
 *   GET    /api/gift-cards            — list
 *   PATCH  /api/gift-cards/:id        — cancel / reactivate (body {status})
 *
 * Notes :
 *   - POST gates on settings.giftcard_enabled (route:86). Seed business ne l'a
 *     pas → on l'active via UPDATE businesses.settings en beforeEach.
 *   - M3 guard (route:157) : cancel via PATCH interdit si stripe_payment_intent_id
 *     set + balance > 0 → 400 avec code 'use_refund_endpoint'. Seed GC_ACTIVE
 *     a déjà 'pi_test_gc_active' → idéal pour tester la guard.
 *   - Pour le test "cancel sans Stripe PI" : GC_CANCELLED seed n'a pas de PI
 *     mais déjà status=cancelled (409). On nulle le PI de GC_ACTIVE pour tester
 *     le succès path.
 *
 * 4 tests.
 */
const { test, expect } = require('@playwright/test');
const IDS = require('../fixtures/ids');
const { staffFetch } = require('../fixtures/api-client');
const { resetMutables } = require('../fixtures/reset-mutables');
const { pool } = require('../../../src/services/db');

test.describe('C06 — staff gc crud', () => {
  test.beforeEach(async () => {
    await resetMutables();
    // Enable giftcard feature for this business (seed doesn't set it)
    await pool.query(
      `UPDATE businesses SET settings = settings || '{"giftcard_enabled": true}'::jsonb WHERE id = $1`,
      [IDS.BUSINESS]
    );
  });

  test('1. Staff create GC — 201 + row in DB', async () => {
    const res = await staffFetch('/api/gift-cards', {
      method: 'POST',
      body: {
        amount_cents: 5000,
        buyer_name: 'Acheteur CRUD',
        buyer_email: 'crud-buyer@genda-test.be',
        recipient_name: 'Destinataire CRUD',
        recipient_email: 'crud-recipient@genda-test.be',
        message: 'Joyeux anniversaire',
      },
    });
    expect(res.status, `Create error: ${JSON.stringify(res.body)}`).toBe(201);
    expect(res.body.code).toMatch(/^GC-[A-Z0-9]{4}-[A-Z0-9]{4}$/);
    expect(res.body.status).toBe('active');
    expect(res.body.balance_cents).toBe(5000);

    // DB verify
    const r = await pool.query(
      `SELECT status, balance_cents, amount_cents, recipient_email FROM gift_cards WHERE id = $1`,
      [res.body.id]
    );
    expect(r.rows[0].status).toBe('active');
    expect(r.rows[0].balance_cents).toBe(5000);
    expect(r.rows[0].amount_cents).toBe(5000);
    expect(r.rows[0].recipient_email).toBe('crud-recipient@genda-test.be');

    // Cleanup
    await pool.query(`DELETE FROM gift_card_transactions WHERE gift_card_id = $1`, [res.body.id]);
    await pool.query(`DELETE FROM gift_cards WHERE id = $1`, [res.body.id]);
  });

  test('2. Staff list GC — 200 + contains 4 seed GCs', async () => {
    const res = await staffFetch('/api/gift-cards');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.gift_cards)).toBe(true);

    const ids = res.body.gift_cards.map((gc) => gc.id);
    expect(ids).toContain(IDS.GC_ACTIVE);
    expect(ids).toContain(IDS.GC_PARTIAL);
    expect(ids).toContain(IDS.GC_EXPIRED);
    expect(ids).toContain(IDS.GC_CANCELLED);

    // feature_enabled propagated
    expect(res.body.feature_enabled).toBe(true);
  });

  test('3. Staff cancel GC sans stripe_PI — 200', async () => {
    // Null stripe_PI on GC_ACTIVE so the M3 guard doesn't trigger
    await pool.query(
      `UPDATE gift_cards SET stripe_payment_intent_id = NULL, status = 'active' WHERE id = $1`,
      [IDS.GC_ACTIVE]
    );

    const res = await staffFetch(`/api/gift-cards/${IDS.GC_ACTIVE}`, {
      method: 'PATCH',
      body: { status: 'cancelled' },
    });
    expect(res.status, `Cancel error: ${JSON.stringify(res.body)}`).toBe(200);
    expect(res.body.status).toBe('cancelled');

    // DB verify
    const r = await pool.query(`SELECT status FROM gift_cards WHERE id = $1`, [IDS.GC_ACTIVE]);
    expect(r.rows[0].status).toBe('cancelled');
  });

  test('4. Staff cancel GC AVEC stripe_PI + balance>0 — guard M3 renvoie 400', async () => {
    // Ensure GC_ACTIVE has a Stripe PI + balance > 0
    await pool.query(
      `UPDATE gift_cards SET stripe_payment_intent_id = 'pi_test_M3_guard', status = 'active', balance_cents = 10000 WHERE id = $1`,
      [IDS.GC_ACTIVE]
    );

    const res = await staffFetch(`/api/gift-cards/${IDS.GC_ACTIVE}`, {
      method: 'PATCH',
      body: { status: 'cancelled' },
    });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('use_refund_endpoint');
    expect(res.body.error).toMatch(/Rembours/i);

    // DB : status unchanged
    const r = await pool.query(`SELECT status FROM gift_cards WHERE id = $1`, [IDS.GC_ACTIVE]);
    expect(r.rows[0].status).toBe('active');
  });
});
