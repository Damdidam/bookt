/**
 * C16 / spec 02 — Twilio inbound SMS webhooks (STOP / START).
 *
 * Endpoint: POST /webhooks/twilio/sms/inbound (form-urlencoded, x-twilio-signature).
 *
 * 2 tests. NODE_ENV=production enforces signature check (expected 403 without
 * valid TWILIO_AUTH_TOKEN). We still verify the route answers (200/403).
 * Si non-prod bypass → DB side-effect vérifiable.
 */
const { test, expect } = require('@playwright/test');
const IDS = require('../fixtures/ids');
const { resetMutables } = require('../fixtures/reset-mutables');
const { pool } = require('../../../src/services/db');

const BASE_URL = process.env.APP_BASE_URL || 'http://localhost:3000';

async function postForm(path, body) {
  const params = new URLSearchParams(body).toString();
  return fetch(`${BASE_URL}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: params,
  });
}

test.describe('C16 — Twilio webhooks', () => {
  test.beforeEach(async () => {
    await resetMutables();
  });

  test('1. Twilio STOP inbound → 200/403 (+ consent_sms=false si DB update appliqué)', async () => {
    // Use CLIENT_JEAN's phone — seed sets +32491000001. We'll use that value for the test.
    const phoneRes = await pool.query(`SELECT phone FROM clients WHERE id = $1`, [IDS.CLIENT_JEAN]);
    const phone = phoneRes.rows[0]?.phone;
    test.skip(!phone, 'CLIENT_JEAN seed phone missing');

    // Ensure consent_sms starts true
    await pool.query(`UPDATE clients SET consent_sms = true WHERE id = $1`, [IDS.CLIENT_JEAN]);

    const res = await postForm('/webhooks/twilio/sms/inbound', {
      From: phone,
      Body: 'STOP',
    });
    // 200 = bypass (no prod-gated auth token). 403 = signature gate. 503 = Twilio not configured in prod.
    expect([200, 403, 503]).toContain(res.status);

    if (res.status === 200) {
      // Confirm DB-side state
      const after = await pool.query(`SELECT consent_sms FROM clients WHERE id = $1`, [IDS.CLIENT_JEAN]);
      expect(after.rows[0].consent_sms).toBe(false);
    }
  });

  test('2. Twilio START inbound → 200/403 (+ consent_sms=true si appliqué)', async () => {
    const phoneRes = await pool.query(`SELECT phone FROM clients WHERE id = $1`, [IDS.CLIENT_JEAN]);
    const phone = phoneRes.rows[0]?.phone;
    test.skip(!phone, 'CLIENT_JEAN seed phone missing');

    // Ensure consent_sms starts false
    await pool.query(`UPDATE clients SET consent_sms = false WHERE id = $1`, [IDS.CLIENT_JEAN]);

    const res = await postForm('/webhooks/twilio/sms/inbound', {
      From: phone,
      Body: 'START',
    });
    expect([200, 403, 503]).toContain(res.status);

    if (res.status === 200) {
      const after = await pool.query(`SELECT consent_sms FROM clients WHERE id = $1`, [IDS.CLIENT_JEAN]);
      expect(after.rows[0].consent_sms).toBe(true);
    }

    // Restore original consent
    await pool.query(`UPDATE clients SET consent_sms = true WHERE id = $1`, [IDS.CLIENT_JEAN]);
  });
});
