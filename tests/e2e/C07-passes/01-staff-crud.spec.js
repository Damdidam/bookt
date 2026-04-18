/**
 * C07 / spec 01 — Staff pass CRUD (create, list, cancel + H-10 guard).
 *
 * Endpoints:
 *   POST   /api/passes          — create pass (staff)
 *   GET    /api/passes          — list
 *   PATCH  /api/passes/:id      — cancel (body {status:'cancelled'})
 *
 * Notes :
 *   - POST gates on settings.passes_enabled → enabled in beforeEach.
 *   - H-10 guard (route:395-407) : PATCH cancel interdit si
 *     stripe_payment_intent_id SET + sessions_remaining > 0 + price_cents > 0
 *     → 400 avec code 'use_refund_full_endpoint'.
 *   - Seed PASS_ACTIVE a déjà PI 'pi_test_pass_active' + 5/10 sessions + 30000c
 *     → guard H-10 se déclenche tel quel.
 *
 * 3 tests.
 */
const { test, expect } = require('@playwright/test');
const IDS = require('../fixtures/ids');
const { staffFetch } = require('../fixtures/api-client');
const { resetMutables } = require('../fixtures/reset-mutables');
const { pool } = require('../../../src/services/db');

test.describe('C07 — staff pass crud', () => {
  test.beforeEach(async () => {
    await resetMutables();
    await pool.query(
      `UPDATE businesses SET settings = settings || '{"passes_enabled": true}'::jsonb WHERE id = $1`,
      [IDS.BUSINESS]
    );
  });

  test('1. Staff create pass — 201 + row in DB', async () => {
    const res = await staffFetch('/api/passes', {
      method: 'POST',
      body: {
        service_id: IDS.SVC_PASS,
        name: 'Pass CRUD 10 séances',
        sessions_total: 10,
        price_cents: 40000,
        validity_days: 90,
        buyer_name: 'Pass Buyer CRUD',
        buyer_email: 'passcrud-buyer@genda-test.be',
      },
    });
    expect(res.status, `Create pass error: ${JSON.stringify(res.body)}`).toBe(201);
    expect(res.body.code).toMatch(/^PS-[A-Z0-9]{4}-[A-Z0-9]{4}$/);
    expect(res.body.status).toBe('active');
    expect(res.body.sessions_total).toBe(10);
    expect(res.body.sessions_remaining).toBe(10);
    expect(res.body.price_cents).toBe(40000);

    // DB verify
    const r = await pool.query(
      `SELECT status, sessions_remaining, sessions_total, service_id, buyer_email
       FROM passes WHERE id = $1`,
      [res.body.id]
    );
    expect(r.rows[0].status).toBe('active');
    expect(r.rows[0].sessions_remaining).toBe(10);
    expect(r.rows[0].sessions_total).toBe(10);
    expect(r.rows[0].service_id).toBe(IDS.SVC_PASS);
    expect(r.rows[0].buyer_email).toBe('passcrud-buyer@genda-test.be');

    // Cleanup
    await pool.query(`DELETE FROM pass_transactions WHERE pass_id = $1`, [res.body.id]);
    await pool.query(`DELETE FROM passes WHERE id = $1`, [res.body.id]);
  });

  test('2. Staff list passes — contient 3 seed passes', async () => {
    const res = await staffFetch('/api/passes');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.passes)).toBe(true);

    const ids = res.body.passes.map((p) => p.id);
    expect(ids).toContain(IDS.PASS_ACTIVE);
    expect(ids).toContain(IDS.PASS_EXPIRED);
    expect(ids).toContain(IDS.PASS_EMPTY);
    expect(res.body.feature_enabled).toBe(true);
  });

  test('3. Staff cancel pass AVEC stripe + sessions>0 — guard H-10 renvoie 400', async () => {
    // PASS_ACTIVE seed : stripe_pi='pi_test_pass_active', 5/10 sessions, price=30000
    // Reset ensures active + sessions_remaining=5
    await pool.query(
      `UPDATE passes SET stripe_payment_intent_id = 'pi_test_H10_guard' WHERE id = $1`,
      [IDS.PASS_ACTIVE]
    );

    const res = await staffFetch(`/api/passes/${IDS.PASS_ACTIVE}`, {
      method: 'PATCH',
      body: { status: 'cancelled' },
    });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('use_refund_full_endpoint');
    expect(res.body.error).toMatch(/Rembours|refund/i);

    // DB status unchanged
    const r = await pool.query(`SELECT status FROM passes WHERE id = $1`, [IDS.PASS_ACTIVE]);
    expect(r.rows[0].status).toBe('active');
  });
});
