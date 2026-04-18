/**
 * C04 / spec 01 — Client confirm (modified_pending → confirmed).
 *
 * The public POST /api/public/booking/:token/confirm only flips
 * status='modified_pending' → 'confirmed'. It does NOT operate on
 * pending_deposit bookings (which wait on Stripe webhook to flip to confirmed).
 *
 * Flow tested: create a booking via public POST, then UPDATE status to
 * 'modified_pending' to simulate a staff-initiated modification, then POST
 * /confirm and verify DB status flips to 'confirmed' + locked=true.
 *
 * 1 test.
 */
const { test, expect } = require('@playwright/test');
const IDS = require('../fixtures/ids');
const { publicFetch } = require('../fixtures/api-client');
const { resetMutables } = require('../fixtures/reset-mutables');
const { pool } = require('../../../src/services/db');

const SLUG = 'test-demo-salon';

function isoPlusDays(days, hour = 10) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  d.setHours(hour, 0, 0, 0);
  return d.toISOString();
}

test.describe('C04 — client post-booking: confirm modified_pending', () => {
  let sinceTs;
  test.beforeEach(async () => {
    sinceTs = new Date(Date.now() - 1000).toISOString();
    await resetMutables();
  });

  test('1. Confirm modified_pending → confirmed', async () => {
    // Create a simple booking (SVC_SHORT, no deposit) — starts as confirmed
    const email = `e2e-c04-confirm-${Date.now()}@genda-test.be`;
    const startAt = isoPlusDays(7, 10);

    const create = await publicFetch(`/api/public/${SLUG}/bookings`, {
      method: 'POST',
      body: {
        service_id: IDS.SVC_SHORT,
        practitioner_id: IDS.PRAC_ALICE,
        start_at: startAt,
        appointment_mode: 'cabinet',
        client_name: 'E2E C04 Confirm',
        client_email: email,
        client_phone: '+32491000700',
        consent_sms: true,
        consent_email: true,
        consent_marketing: false,
      },
    });
    expect(create.status, `Create error: ${JSON.stringify(create.body)}`).toBe(201);
    const token = create.body.booking.public_token || create.body.booking.token;
    const bkId = create.body.booking.id;

    // Force status to modified_pending (simulates staff modification pending client ack)
    await pool.query(
      `UPDATE bookings SET status = 'modified_pending', locked = false WHERE id = $1`,
      [bkId]
    );

    // Client clicks "Ça me convient" → POST /confirm
    const res = await publicFetch(`/api/public/booking/${token}/confirm`, {
      method: 'POST',
      body: {},
    });
    expect(res.status, `Confirm error: ${JSON.stringify(res.body)}`).toBe(200);
    expect(res.body.confirmed).toBe(true);

    // DB assertion: status='confirmed' + locked=true
    const after = await pool.query(
      `SELECT status, locked FROM bookings WHERE id = $1`,
      [bkId]
    );
    expect(after.rows[0].status).toBe('confirmed');
    expect(after.rows[0].locked).toBe(true);
  });
});
