/**
 * C01 / spec 07 — Consent/input validation on public booking.
 *
 * 3 tests :
 *   1. consent_sms=false — booking succeeds, client row stores consent_sms=false.
 *      Mock log note: src/services/sms.js:28 logs SMS attempts BEFORE the consent
 *      check (line 39), so in SKIP_SMS=1 mode the mock log WILL contain an SMS
 *      entry regardless of consent. The production guard at sms.js:39-41 prevents
 *      the actual Twilio call — it's just not observable in mock mode. Asserting
 *      on the stored `clients.consent_sms=false` and booking success is the
 *      reliable contract.
 *   2. Disposable email (test@mailinator.com) → 400 with the dedicated error.
 *   3. Phone invalid ('abc123') → 400 "Format téléphone invalide".
 */
const { test, expect } = require('@playwright/test');
const IDS = require('../fixtures/ids');
const { publicFetch, waitForMockLog } = require('../fixtures/api-client');
const { pool } = require('../../../src/services/db');

const SLUG = 'test-demo-salon';

function isoPlusDays(days, hour = 10) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  d.setHours(hour, 0, 0, 0);
  return d.toISOString();
}

test.describe('C01 — booking public mono: consent & validation', () => {
  let sinceTs;
  test.beforeAll(() => { sinceTs = new Date(Date.now() - 5000).toISOString(); });

  test('1. consent_sms=false — booking succeeds, client record persists the opt-out', async () => {
    const email = `e2e-consent-sms-off-${Date.now()}@genda-test.be`;
    const phone = `+3249100${String(Math.floor(Math.random()*9000)+1000)}`;
    const startAt = isoPlusDays(7, 10); // Sat — Alice open

    const { status, body } = await publicFetch(`/api/public/${SLUG}/bookings`, {
      method: 'POST',
      body: {
        service_id: IDS.SVC_SHORT,
        practitioner_id: IDS.PRAC_ALICE,
        start_at: startAt,
        appointment_mode: 'cabinet',
        client_name: 'E2E SMS Opt-out',
        client_email: email,
        client_phone: phone,
        consent_sms: false,
        consent_email: true,
        consent_marketing: false,
      },
    });

    expect(status, `API error: ${JSON.stringify(body)}`).toBe(201);
    expect(body.booking.status).toBe('confirmed');

    const row = await pool.query(
      `SELECT c.consent_sms, c.consent_email, c.consent_marketing
       FROM clients c JOIN bookings b ON b.client_id = c.id
       WHERE b.id = $1`,
      [body.booking.id]
    );
    expect(row.rows[0].consent_sms).toBe(false);
    expect(row.rows[0].consent_email).toBe(true);
    expect(row.rows[0].consent_marketing).toBe(false);

    // Informational: an email mock entry SHOULD appear (consent_email=true).
    const emails = await waitForMockLog('email', email, sinceTs, 3000, 1);
    test.info().annotations.push({
      type: 'email-mock-count', description: String(emails.length),
    });
  });

  test('2. Disposable email (mailinator.com) → 400 rejected', async () => {
    const startAt = isoPlusDays(7, 12);
    const { status, body } = await publicFetch(`/api/public/${SLUG}/bookings`, {
      method: 'POST',
      body: {
        service_id: IDS.SVC_SHORT,
        practitioner_id: IDS.PRAC_ALICE,
        start_at: startAt,
        appointment_mode: 'cabinet',
        client_name: 'E2E Disposable',
        client_email: 'test@mailinator.com',
        client_phone: '+32491000000',
        consent_sms: true,
        consent_email: true,
        consent_marketing: false,
      },
    });
    expect(status).toBe(400);
    expect(body.error).toMatch(/temporaires|disposable/i);
  });

  test('3. Phone invalid (abc123) → 400 "Format téléphone invalide"', async () => {
    const startAt = isoPlusDays(7, 13);
    const { status, body } = await publicFetch(`/api/public/${SLUG}/bookings`, {
      method: 'POST',
      body: {
        service_id: IDS.SVC_SHORT,
        practitioner_id: IDS.PRAC_ALICE,
        start_at: startAt,
        appointment_mode: 'cabinet',
        client_name: 'E2E Bad Phone',
        client_email: `e2e-badphone-${Date.now()}@genda-test.be`,
        client_phone: 'abc123',
        consent_sms: true,
        consent_email: true,
        consent_marketing: false,
      },
    });
    expect(status).toBe(400);
    expect(body.error).toMatch(/Format téléphone invalide/);
  });
});
