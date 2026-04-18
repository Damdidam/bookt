/**
 * C20 / spec 02 — Cron notifications + reminders + deposit expiry.
 *
 * 4 tests (reminders 24h/2h already covered in C12/03 — skipped).
 */
const { test, expect } = require('@playwright/test');
const IDS = require('../fixtures/ids');
const { waitForMockLog } = require('../fixtures/api-client');
const { resetMutables } = require('../fixtures/reset-mutables');
const { pool } = require('../../../src/services/db');

const BIZ_EMAIL = 'test-bookt@genda.be';

test.describe('C20 — cron notif + reminders + deposit', () => {
  let sinceTs;

  test.beforeEach(async () => {
    sinceTs = new Date(Date.now() - 1000).toISOString();
    await resetMutables();
    await pool.query(`DELETE FROM test_mock_log WHERE created_at < NOW() - INTERVAL '1 minute'`);
  });

  test('1. processNotifications → queued email_new_booking_pro → sent', async () => {
    // Create a confirmed booking + queue a pro notif for it
    const startAt = new Date(Date.now() + 3 * 86400000).toISOString();
    const r = await pool.query(
      `INSERT INTO bookings (business_id, client_id, service_id, practitioner_id,
         start_at, end_at, status, appointment_mode, public_token)
       VALUES ($1, $2, $3, $4, $5, $5::timestamptz + INTERVAL '1 hour',
         'confirmed', 'cabinet', encode(gen_random_bytes(10), 'hex'))
       RETURNING id`,
      [IDS.BUSINESS, IDS.CLIENT_JEAN, IDS.SVC_SHORT, IDS.PRAC_ALICE, startAt]
    );
    const bookingId = r.rows[0].id;

    try {
      await pool.query(
        `INSERT INTO notifications (business_id, booking_id, type, status)
         VALUES ($1, $2, 'email_new_booking_pro', 'queued')`,
        [IDS.BUSINESS, bookingId]
      );

      const { processNotifications } = require('../../../src/services/notification-processor');
      await processNotifications();

      // biz owner email receives pro notification
      const emails = await waitForMockLog('email', BIZ_EMAIL, sinceTs, 6000, 1);
      expect(emails.length).toBeGreaterThanOrEqual(1);
    } finally {
      await pool.query(`DELETE FROM notifications WHERE booking_id = $1`, [bookingId]);
      await pool.query(`DELETE FROM bookings WHERE id = $1`, [bookingId]);
    }
  });

  test('2. Reminder 24h → covered in C12/03', async () => {
    test.skip(true, 'Covered in C12/03 reminders-cron');
  });

  test('3. Reminder 2h → covered in C12/03', async () => {
    test.skip(true, 'Covered in C12/03 reminders-cron');
  });

  test('4. processExpiredDeposits → pending_deposit past deadline → cancelled', async () => {
    const startAt = new Date(Date.now() + 3 * 86400000).toISOString();
    const r = await pool.query(
      `INSERT INTO bookings (business_id, client_id, service_id, practitioner_id,
         start_at, end_at, status, appointment_mode, public_token,
         deposit_required, deposit_status, deposit_amount_cents, deposit_deadline,
         booked_price_cents)
       VALUES ($1, $2, $3, $4, $5, $5::timestamptz + INTERVAL '1 hour',
         'pending_deposit', 'cabinet', encode(gen_random_bytes(10), 'hex'),
         true, 'pending', 5000, NOW() - INTERVAL '5 minutes', 10000)
       RETURNING id`,
      [IDS.BUSINESS, IDS.CLIENT_JEAN, IDS.SVC_EXPENSIVE, IDS.PRAC_ALICE, startAt]
    );
    const bookingId = r.rows[0].id;

    try {
      const { processExpiredDeposits } = require('../../../src/services/deposit-expiry');
      const stats = await processExpiredDeposits();
      expect(stats.processed).toBeGreaterThanOrEqual(1);

      const after = await pool.query(
        `SELECT status, deposit_status FROM bookings WHERE id = $1`, [bookingId]
      );
      expect(after.rows[0].status).toBe('cancelled');
      expect(after.rows[0].deposit_status).toBe('cancelled');
    } finally {
      await pool.query(`DELETE FROM bookings WHERE id = $1`, [bookingId]);
    }
  });
});
