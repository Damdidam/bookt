/**
 * C12 / spec 03 — Rappels cron (reminders 24h, 2h).
 *
 * 3 tests.
 * Utilise `processReminders()` depuis src/services/reminders.js.
 *
 * Mapping kind (subject[0..50]) :
 *   - 'Rappel : votre RDV du …' → reminder_24h
 *   - 'Votre RDV est dans 2h — …' → reminder_2h
 *   - 'Paiement orphelin détecté' → deposit_orphan (via notification-processor)
 */
const { test, expect } = require('@playwright/test');
const IDS = require('../fixtures/ids');
const { waitForMockLog } = require('../fixtures/api-client');
const { resetMutables } = require('../fixtures/reset-mutables');
const { pool } = require('../../../src/services/db');

const BIZ_EMAIL = 'test-bookt@genda.be';

test.describe('C12 — reminders cron', () => {
  let sinceTs;

  test.beforeEach(async () => {
    sinceTs = new Date(Date.now() - 1000).toISOString();
    await resetMutables();
    await pool.query(`DELETE FROM test_mock_log WHERE created_at < NOW() - INTERVAL '1 minute'`);
  });

  test('1. Reminder 24h via processReminders() → email kind reminder_24h', async () => {
    // Create a booking at start=now+24h+5min so it falls in the 23h..25h window
    const startAt = new Date(Date.now() + 24 * 3600000 + 5 * 60000).toISOString();
    const r = await pool.query(
      `INSERT INTO bookings (business_id, client_id, service_id, practitioner_id,
         start_at, end_at, status, appointment_mode, reminder_24h_sent_at, public_token)
       VALUES ($1, $2, $3, $4, $5, $5::timestamptz + INTERVAL '15 min',
               'confirmed', 'cabinet', NULL, encode(gen_random_bytes(10), 'hex'))
       RETURNING id`,
      [IDS.BUSINESS, IDS.CLIENT_JEAN, IDS.SVC_SHORT, IDS.PRAC_ALICE, startAt]
    );
    const bookingId = r.rows[0].id;

    try {
      const { processReminders } = require('../../../src/services/reminders');
      const stats = await processReminders();
      expect(stats.email_24h, `stats=${JSON.stringify(stats)}`).toBeGreaterThanOrEqual(1);

      const emails = await waitForMockLog('email', 'jean-test@genda-test.be', sinceTs, 6000, 1);
      const hit = emails.find(e => /^Rappel : votre RDV/i.test(e.payload.subject));
      expect(hit, `No reminder 24h email. got=${emails.map(e => e.payload.subject).join(' | ')}`).toBeTruthy();
    } finally {
      await pool.query(`DELETE FROM bookings WHERE id = $1`, [bookingId]);
    }
  });

  test('2. Reminder 2h via processReminders() → email kind reminder_2h', async () => {
    // Need reminder_email_2h === true (already enabled in seed) + start_at in 1h..2h15min
    const startAt = new Date(Date.now() + 2 * 3600000 - 5 * 60000).toISOString(); // ≈1h55min
    const r = await pool.query(
      `INSERT INTO bookings (business_id, client_id, service_id, practitioner_id,
         start_at, end_at, status, appointment_mode, reminder_2h_sent_at, public_token)
       VALUES ($1, $2, $3, $4, $5, $5::timestamptz + INTERVAL '15 min',
               'confirmed', 'cabinet', NULL, encode(gen_random_bytes(10), 'hex'))
       RETURNING id`,
      [IDS.BUSINESS, IDS.CLIENT_JEAN, IDS.SVC_SHORT, IDS.PRAC_ALICE, startAt]
    );
    const bookingId = r.rows[0].id;

    try {
      const { processReminders } = require('../../../src/services/reminders');
      const stats = await processReminders();
      // email_2h counter only increments when settings.reminder_email_2h === true AND client_email
      expect(stats.email_2h, `stats=${JSON.stringify(stats)}`).toBeGreaterThanOrEqual(1);

      const emails = await waitForMockLog('email', 'jean-test@genda-test.be', sinceTs, 6000, 1);
      const hit = emails.find(e => /dans 2h/i.test(e.payload.subject));
      expect(hit, `No reminder 2h email. got=${emails.map(e => e.payload.subject).join(' | ')}`).toBeTruthy();
    } finally {
      await pool.query(`DELETE FROM bookings WHERE id = $1`, [bookingId]);
    }
  });

  test('3. Deposit orphan → email dispatch via notification-processor', async () => {
    // email_deposit_orphan is queued then processed — orphan paiement when booking cancelled
    // but PaymentIntent was received. We simulate by creating a cancelled booking + queued notif.
    const startAt = new Date(Date.now() + 24 * 3600000).toISOString();
    const r = await pool.query(
      `INSERT INTO bookings (business_id, client_id, service_id, practitioner_id,
         start_at, end_at, status, appointment_mode)
       VALUES ($1, $2, $3, $4, $5, $5::timestamptz + INTERVAL '15 min',
               'cancelled', 'cabinet')
       RETURNING id`,
      [IDS.BUSINESS, IDS.CLIENT_JEAN, IDS.SVC_SHORT, IDS.PRAC_ALICE, startAt]
    );
    const bookingId = r.rows[0].id;

    try {
      await pool.query(
        `INSERT INTO notifications (business_id, booking_id, type, status, metadata)
         VALUES ($1, $2, 'email_deposit_orphan', 'queued', $3)`,
        [IDS.BUSINESS, bookingId, JSON.stringify({ amount: 5000 })]
      );
      const { processNotifications } = require('../../../src/services/notification-processor');
      await processNotifications();

      const emails = await waitForMockLog('email', BIZ_EMAIL, sinceTs, 6000, 1);
      const hit = emails.find(e => /orphelin/i.test(e.payload.subject));
      expect(hit, `No deposit_orphan email. got=${emails.map(e => e.payload.subject).join(' | ')}`).toBeTruthy();
    } finally {
      await pool.query(`DELETE FROM notifications WHERE booking_id = $1`, [bookingId]);
      await pool.query(`DELETE FROM bookings WHERE id = $1`, [bookingId]);
    }
  });
});
