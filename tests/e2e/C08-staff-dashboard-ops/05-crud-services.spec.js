/**
 * C08 / spec 05 — Services CRUD + variants.
 *
 * Endpoints :
 *   POST   /api/services
 *   PATCH  /api/services/:id
 *   DELETE /api/services/:id       — 409 if active bookings or active passes
 *   POST   /api/services/:id/variants
 *
 * 4 tests.
 */
const { test, expect } = require('@playwright/test');
const IDS = require('../fixtures/ids');
const { staffFetch } = require('../fixtures/api-client');
const { resetMutables } = require('../fixtures/reset-mutables');
const { pool } = require('../../../src/services/db');

test.describe('C08 — staff ops : services CRUD', () => {
  let sinceTs;
  test.beforeEach(async () => {
    sinceTs = new Date(Date.now() - 1000).toISOString();
    await resetMutables();
  });

  test('1. Create service → 201', async () => {
    const uniq = Date.now();
    const res = await staffFetch('/api/services', {
      method: 'POST',
      body: {
        name: `Test Service ${uniq}`,
        duration_min: 45,
        price_cents: 7500,
        category: 'test-cat',
      },
    });
    expect(res.status, `create service: ${JSON.stringify(res.body)}`).toBe(201);
    expect(res.body.service).toBeTruthy();
    expect(res.body.service.name).toContain('Test Service');
    expect(res.body.service.duration_min).toBe(45);
    expect(res.body.service.price_cents).toBe(7500);

    // Cleanup
    await pool.query(`DELETE FROM services WHERE id = $1`, [res.body.service.id]);
  });

  test('2. Edit service price via PATCH → 200', async () => {
    const uniq = Date.now();
    const createRes = await staffFetch('/api/services', {
      method: 'POST',
      body: { name: `Edit Target ${uniq}`, duration_min: 30, price_cents: 5000 },
    });
    expect(createRes.status).toBe(201);
    const id = createRes.body.service.id;

    const patchRes = await staffFetch(`/api/services/${id}`, {
      method: 'PATCH',
      body: { price_cents: 9999 },
    });
    expect(patchRes.status, `patch: ${JSON.stringify(patchRes.body)}`).toBe(200);

    const r = await pool.query(`SELECT price_cents FROM services WHERE id = $1`, [id]);
    expect(r.rows[0].price_cents).toBe(9999);

    // Cleanup
    await pool.query(`DELETE FROM services WHERE id = $1`, [id]);
  });

  test('3. Delete service with active pass linked → 409', async () => {
    const uniq = Date.now();
    // Create service
    const createRes = await staffFetch('/api/services', {
      method: 'POST',
      body: { name: `Pass Linked ${uniq}`, duration_min: 60, price_cents: 10000 },
    });
    expect(createRes.status).toBe(201);
    const svcId = createRes.body.service.id;

    // Link an active pass to it. Pass code is varchar(12) → keep it short.
    const shortCode = `PS-${String(uniq).slice(-8)}`;
    const passIns = await pool.query(
      `INSERT INTO passes (business_id, service_id, name, code, sessions_total, sessions_remaining,
         price_cents, status, buyer_email)
       VALUES ($1, $2, 'Test Pass', $3, 10, 10, 10000, 'active', 'buyer-${uniq}@genda-test.be')
       RETURNING id`,
      [IDS.BUSINESS, svcId, shortCode]
    );
    const passId = passIns.rows[0].id;

    const delRes = await staffFetch(`/api/services/${svcId}`, { method: 'DELETE' });
    expect(delRes.status, `delete: ${JSON.stringify(delRes.body)}`).toBe(409);
    expect(delRes.body.error).toMatch(/abonnement|pass|actif/i);

    // Cleanup
    await pool.query(`DELETE FROM passes WHERE id = $1`, [passId]);
    await pool.query(`DELETE FROM services WHERE id = $1`, [svcId]);
  });

  test('4. Create service then add variant via POST /:id/variants', async () => {
    const uniq = Date.now();
    const createRes = await staffFetch('/api/services', {
      method: 'POST',
      body: { name: `Variant Parent ${uniq}`, duration_min: 60, price_cents: 8000 },
    });
    expect(createRes.status).toBe(201);
    const svcId = createRes.body.service.id;

    const varRes = await staffFetch(`/api/services/${svcId}/variants`, {
      method: 'POST',
      body: {
        name: 'Courte',
        duration_min: 30,
        price_cents: 5000,
      },
    });
    expect(varRes.status, `variant create: ${JSON.stringify(varRes.body)}`).toBe(201);
    expect(varRes.body.variant).toBeTruthy();
    expect(varRes.body.variant.service_id).toBe(svcId);
    expect(varRes.body.variant.duration_min).toBe(30);

    // Cleanup
    await pool.query(`DELETE FROM service_variants WHERE service_id = $1`, [svcId]);
    await pool.query(`DELETE FROM services WHERE id = $1`, [svcId]);
  });
});
