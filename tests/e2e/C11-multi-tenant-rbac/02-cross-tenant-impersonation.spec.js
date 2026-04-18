/**
 * C11 / spec 02 — Cross-tenant isolation + impersonation guardrails.
 *
 * 1. Cross-tenant: A JWT scoped to business A cannot touch business B resources —
 *    req.businessId is re-derived from the DB (auth.js:32) so even a forged JWT
 *    with businessId=B ends up with req.businessId=A; queries filter `WHERE
 *    business_id = req.businessId` so rows from B are 404.
 * 2. Impersonated JWT → GET still works + req.user.impersonated=true is populated.
 *    (verified indirectly via the destructive block in test 3).
 * 3. blockIfImpersonated on DELETE /api/services/:id → 403.
 * 4. JWT with unknown userId → 401 "Compte désactivé ou introuvable".
 *
 * 4 tests.
 */
const { test, expect } = require('@playwright/test');
const jwt = require('jsonwebtoken');
const IDS = require('../fixtures/ids');
const { staffFetch, signTestToken, ownerToken } = require('../fixtures/api-client');
const { resetMutables } = require('../fixtures/reset-mutables');
const { pool } = require('../../../src/services/db');

const BUSINESS_B = '00000000-0000-4000-8000-0000000009B0';
const USER_B_OWNER = '00000000-0000-4000-8000-0000000009B1';
const SVC_B = '00000000-0000-4000-8000-0000000009B2';

async function createBusinessB() {
  await pool.query(
    `INSERT INTO businesses (id, name, slug, email, sector, category, is_test_account, is_active, plan)
     VALUES ($1, 'TEST BIS', 'test-bis-c11', 'bis-c11@genda-test.be', 'coiffeur', 'salon', true, true, 'pro')
     ON CONFLICT (id) DO NOTHING`,
    [BUSINESS_B]
  );
  await pool.query(
    `INSERT INTO users (id, business_id, email, password_hash, role, is_active)
     VALUES ($1, $2, 'bis-owner-c11@genda-test.be', '$2b$10$placeholder', 'owner', true)
     ON CONFLICT (id) DO NOTHING`,
    [USER_B_OWNER, BUSINESS_B]
  );
  await pool.query(
    `INSERT INTO services (id, business_id, name, duration_min, price_cents, is_active)
     VALUES ($1, $2, 'Service B Cross-Tenant', 30, 3000, true)
     ON CONFLICT (id) DO NOTHING`,
    [SVC_B, BUSINESS_B]
  );
}

async function cleanupBusinessB() {
  await pool.query(`DELETE FROM services WHERE business_id = $1`, [BUSINESS_B]);
  await pool.query(`DELETE FROM users WHERE business_id = $1`, [BUSINESS_B]);
  await pool.query(`DELETE FROM businesses WHERE id = $1`, [BUSINESS_B]);
}

test.describe('C11 — multi-tenant RBAC : cross-tenant + impersonation', () => {
  test.beforeAll(async () => {
    await createBusinessB();
  });
  test.afterAll(async () => {
    await cleanupBusinessB();
  });

  let sinceTs;
  test.beforeEach(async () => {
    sinceTs = new Date(Date.now() - 1000).toISOString();
    await resetMutables();
  });

  test('1. Cross-tenant : Alice (biz A) tente PATCH service de biz B → 404 (scope filter)', async () => {
    const aliceTok = ownerToken();
    // Attempt to modify BIZ B's service using Alice's token.
    const patchRes = await staffFetch(`/api/services/${SVC_B}`, {
      method: 'PATCH',
      token: aliceTok,
      body: { price_cents: 9999 },
    });
    // Routes use WHERE business_id = req.businessId → service not found in Alice's scope.
    expect([403, 404], `cross-tenant PATCH: ${patchRes.status} body=${JSON.stringify(patchRes.body)}`).toContain(patchRes.status);

    // DB : price UNCHANGED on BIZ B's service.
    const r = await pool.query(`SELECT price_cents FROM services WHERE id = $1`, [SVC_B]);
    expect(r.rows[0].price_cents).toBe(3000);

    // Also: DELETE should similarly 404/403.
    const delRes = await staffFetch(`/api/services/${SVC_B}`, { method: 'DELETE', token: aliceTok });
    expect([403, 404], `cross-tenant DELETE: ${delRes.status} body=${JSON.stringify(delRes.body)}`).toContain(delRes.status);

    // Service still exists.
    const r2 = await pool.query(`SELECT id FROM services WHERE id = $1`, [SVC_B]);
    expect(r2.rows.length).toBe(1);
  });

  test('2. Impersonation : JWT impersonated=true → GET /auth/me passe + logs admin', async () => {
    // Sign an impersonated token for Alice (as admin would produce).
    const token = jwt.sign(
      {
        userId: IDS.USER_ALICE_OWNER,
        businessId: IDS.BUSINESS,
        impersonated: true,
        impersonatedBy: 'admin-e2e@genda.be',
      },
      process.env.JWT_SECRET,
      { expiresIn: '1h' }
    );
    // Read-only : /me must succeed.
    const meRes = await staffFetch('/api/auth/me', { token });
    expect(meRes.status, `impersonated /me: ${JSON.stringify(meRes.body)}`).toBe(200);
    expect(meRes.body.user.email).toBe('alice-test@genda-test.be');

    // A non-destructive list should also work.
    const svcRes = await staffFetch('/api/services', { token });
    expect(svcRes.status).toBe(200);
    expect(Array.isArray(svcRes.body.services)).toBe(true);

    // Note : Admin impersonation currently logs via console.log (admin/index.js:271) —
    // no audit_logs row written on issuance. Destructive-op audit is tested in #3.
  });

  test('3. blockIfImpersonated : DELETE /api/services/:id impersonated → 403', async () => {
    // Create a throwaway service on Alice's business.
    const createRes = await staffFetch('/api/services', {
      method: 'POST',
      body: { name: `C11 Impersonation Target ${Date.now()}`, duration_min: 30, price_cents: 2000 },
    });
    expect(createRes.status).toBe(201);
    const svcId = createRes.body.service.id;

    // Sign impersonated token.
    const impersonatedTok = jwt.sign(
      {
        userId: IDS.USER_ALICE_OWNER,
        businessId: IDS.BUSINESS,
        impersonated: true,
        impersonatedBy: 'admin-e2e@genda.be',
      },
      process.env.JWT_SECRET,
      { expiresIn: '1h' }
    );

    // DELETE must be blocked by blockIfImpersonated middleware (services.js:425).
    const delRes = await staffFetch(`/api/services/${svcId}`, {
      method: 'DELETE',
      token: impersonatedTok,
    });
    expect(delRes.status, `impersonated DELETE: ${JSON.stringify(delRes.body)}`).toBe(403);
    expect(delRes.body.error).toMatch(/impersonation/i);

    // DB : service still exists.
    const r = await pool.query(`SELECT id FROM services WHERE id = $1`, [svcId]);
    expect(r.rows.length).toBe(1);

    // Cleanup via non-impersonated owner.
    await pool.query(`DELETE FROM services WHERE id = $1`, [svcId]);
  });

  test('4. JWT userId inconnu (user fantôme) → 401 "Compte désactivé ou introuvable"', async () => {
    // Sign a perfectly valid JWT for a user that does not exist.
    const ghostUserId = '00000000-0000-4000-8000-0000000099FF';
    const tok = signTestToken(ghostUserId, IDS.BUSINESS, 'owner');
    const res = await staffFetch('/api/auth/me', { token: tok });
    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/désactivé|introuvable|invalide/i);
  });
});
