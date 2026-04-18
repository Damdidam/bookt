/**
 * C20 / spec 01 — Cron jobs : expire pending bookings, GC, passes.
 *
 * Directly invokes handlers from src/services/*.
 *
 * 5 tests. Tests #2/#3/#4/#5 already covered in C06/C07/C12 ; skipped with note.
 */
const { test, expect } = require('@playwright/test');
const IDS = require('../fixtures/ids');
const { resetMutables } = require('../fixtures/reset-mutables');
const { pool } = require('../../../src/services/db');

test.describe('C20 — cron expiry', () => {
  test.beforeEach(async () => {
    await resetMutables();
  });

  test('1. processExpiredPendingBookings → pending booking past deadline → cancelled', async () => {
    // Insert pending booking with confirmation_expires_at in the past
    const startAt = new Date(Date.now() + 3 * 86400000).toISOString();
    const r = await pool.query(
      `INSERT INTO bookings (business_id, client_id, service_id, practitioner_id,
         start_at, end_at, status, appointment_mode, public_token,
         confirmation_expires_at)
       VALUES ($1, $2, $3, $4, $5, $5::timestamptz + INTERVAL '1 hour',
         'pending', 'cabinet', encode(gen_random_bytes(10), 'hex'),
         NOW() - INTERVAL '5 minutes')
       RETURNING id`,
      [IDS.BUSINESS, IDS.CLIENT_JEAN, IDS.SVC_SHORT, IDS.PRAC_ALICE, startAt]
    );
    const bookingId = r.rows[0].id;

    try {
      const { processExpiredPendingBookings } = require('../../../src/services/booking-confirmation');
      const stats = await processExpiredPendingBookings();
      expect(stats.processed).toBeGreaterThanOrEqual(1);

      const after = await pool.query(`SELECT status FROM bookings WHERE id = $1`, [bookingId]);
      expect(after.rows[0].status).toBe('cancelled');
    } finally {
      await pool.query(`DELETE FROM bookings WHERE id = $1`, [bookingId]);
    }
  });

  test('2. processExpiredGiftCards → covered in C06/04', async () => {
    test.skip(true, 'Covered in C06/04');
  });

  test('3. processExpiredPasses → covered in C07', async () => {
    test.skip(true, 'Covered in C07 pass expiry');
  });

  test('4. processGiftCardExpiryWarnings (J-7) → covered in C12/04', async () => {
    test.skip(true, 'Covered in C12/04 transactional-emails (GC expiry warning)');
  });

  test('5. processPassExpiryWarnings (J-7) → covered in C12/04', async () => {
    test.skip(true, 'Covered in C12/04 transactional-emails (pass expiry warning)');
  });
});
