/**
 * C07 / spec 02 — Public pass purchase via Stripe + email validation.
 *
 * Endpoint:
 *   POST /api/public/:slug/pass/checkout  — body { pass_template_id, buyer_email, ... }
 *
 * Notes :
 *   - Sans STRIPE_SECRET_KEY → 500 "Paiement non configuré" (route:300) BEFORE
 *     validation. On accepte [200, 500].
 *   - passes_enabled flag activé en beforeEach.
 *   - Un pass_template temporaire est inséré pour le test purchase.
 *
 * 2 tests.
 */
const { test, expect } = require('@playwright/test');
const IDS = require('../fixtures/ids');
const { publicFetch } = require('../fixtures/api-client');
const { resetMutables } = require('../fixtures/reset-mutables');
const { pool } = require('../../../src/services/db');

const SLUG = 'test-demo-salon';

test.describe('C07 — public pass purchase', () => {
  let tplId;
  test.beforeEach(async () => {
    await resetMutables();
    await pool.query(
      `UPDATE businesses SET settings = settings || '{"passes_enabled": true}'::jsonb WHERE id = $1`,
      [IDS.BUSINESS]
    );
    // Insert a temporary pass_template
    const r = await pool.query(
      `INSERT INTO pass_templates (business_id, service_id, name, sessions_count, price_cents, validity_days, is_active)
       VALUES ($1, $2, 'Pass public test', 5, 20000, 180, true) RETURNING id`,
      [IDS.BUSINESS, IDS.SVC_PASS]
    );
    tplId = r.rows[0].id;
  });

  test.afterEach(async () => {
    if (tplId) {
      await pool.query(`DELETE FROM pass_templates WHERE id = $1`, [tplId]);
      tplId = null;
    }
  });

  test('1. Achat public pass via Stripe (accepte 200 ou 500 si key absente)', async () => {
    const res = await publicFetch(`/api/public/${SLUG}/pass/checkout`, {
      method: 'POST',
      body: {
        pass_template_id: tplId,
        buyer_name: 'Pass Buyer Public',
        buyer_email: 'passbuyer-public@genda-test.be',
      },
    });
    expect([200, 500]).toContain(res.status);
    if (res.status === 200) {
      expect(res.body.url).toMatch(/^https?:\/\//);
      expect(res.body.session_id).toBeTruthy();
    } else {
      expect(res.body.error).toMatch(/Paiement non configuré/i);
    }
  });

  test('2. Achat public pass — disposable email rejetée (400) ou 500', async () => {
    const res = await publicFetch(`/api/public/${SLUG}/pass/checkout`, {
      method: 'POST',
      body: {
        pass_template_id: tplId,
        buyer_email: 'spam@mailinator.com',
      },
    });
    expect([400, 500]).toContain(res.status);
    if (res.status === 400) {
      expect(res.body.error).toMatch(/temporaires/i);
    } else {
      expect(res.body.error).toMatch(/Paiement non configuré/i);
    }
  });
});
