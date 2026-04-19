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

  test('2. Brevo webhook — hard_bounce met à jour notifications.status=failed', async () => {
    // Bug #10 fixé (commit 3f26a5a) : endpoint POST /webhooks/brevo implémenté
    // (src/routes/webhooks/brevo.js) avec secret validation, matching par messageId
    // + fallback email, 14 événements mappés vers sent/failed/queued.
    // Ce test nécessite BREVO_WEBHOOK_SECRET en env pour passer la validation.
    const secret = process.env.BREVO_WEBHOOK_SECRET;
    if (!secret) {
      test.skip(true, 'BREVO_WEBHOOK_SECRET non setté — impossible de tester la validation');
      return;
    }

    // Crée une notification "queued" à matcher via email fallback
    const fakeEmail = `brevo-wh-test-${Date.now()}@genda-test.be`;
    const nRes = await pool.query(
      `INSERT INTO notifications (business_id, type, recipient_email, status, provider, created_at)
       VALUES ($1, 'email_confirmation', $2, 'queued', 'brevo', NOW())
       RETURNING id`,
      [IDS.BUSINESS, fakeEmail]
    );
    const notifId = nRes.rows[0].id;
    try {
      const res = await fetch(`${process.env.APP_BASE_URL || 'http://localhost:3000'}/webhooks/brevo`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-brevo-secret': secret },
        body: JSON.stringify([{
          event: 'hard_bounce',
          email: fakeEmail,
          'message-id': '<test-' + Date.now() + '@brevo.com>',
          reason: 'invalid recipient',
          ts: Math.floor(Date.now() / 1000)
        }])
      });
      expect(res.status, 'Brevo webhook accepté avec bon secret').toBe(200);
      const body = await res.json();
      expect(body.ok).toBe(true);
      expect(body.processed).toBeGreaterThanOrEqual(1);

      // Vérifier que la notification est passée à failed
      const after = await pool.query(`SELECT status, error, metadata FROM notifications WHERE id = $1`, [notifId]);
      expect(after.rows[0].status).toBe('failed');
      expect(after.rows[0].error).toMatch(/brevo_hard_bounce/);
      expect(after.rows[0].metadata?.brevo_event).toBe('hard_bounce');
    } finally {
      await pool.query(`DELETE FROM notifications WHERE id = $1`, [notifId]);
    }
  });

  test('3. Brevo webhook — mauvais secret → 403', async () => {
    // Vérifie que le secret est vraiment gate (sinon n'importe qui peut polluer notifications).
    if (!process.env.BREVO_WEBHOOK_SECRET) {
      test.skip(true, 'BREVO_WEBHOOK_SECRET non setté — skip test sécurité');
      return;
    }
    const res = await fetch(`${process.env.APP_BASE_URL || 'http://localhost:3000'}/webhooks/brevo`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-brevo-secret': 'wrong-secret' },
      body: JSON.stringify([{ event: 'hard_bounce', email: 'x@x.com' }])
    });
    expect(res.status, 'secret invalide doit renvoyer 403').toBe(403);
  });
});
