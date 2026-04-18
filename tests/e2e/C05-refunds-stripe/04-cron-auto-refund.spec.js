/**
 * C05 / spec 04 — Cron processExpiredDeposits auto-cancels pending_deposit
 * bookings past their deposit_deadline.
 *
 * We insert a pending_deposit booking with deposit_deadline in the past, then
 * invoke the exported function directly.
 *
 * 1 test.
 */
const { test, expect } = require('@playwright/test');
const IDS = require('../fixtures/ids');
const { resetMutables } = require('../fixtures/reset-mutables');
const { pool } = require('../../../src/services/db');

test.describe('C05 — cron auto-refund expired deposits', () => {
  test.beforeEach(async () => {
    await resetMutables();
  });

  test('1. pending_deposit past deadline → cancelled with deposit_status=cancelled', async () => {
    const startAt = new Date(Date.now() + 5 * 86400000).toISOString();
    const endAt = new Date(Date.now() + 5 * 86400000 + 3600000).toISOString();
    // deposit_deadline 1 hour in the past (expired)
    const expiredDeadline = new Date(Date.now() - 3600000).toISOString();

    const ins = await pool.query(
      `INSERT INTO bookings (business_id, practitioner_id, service_id, client_id, start_at, end_at,
         status, appointment_mode, public_token, deposit_required, deposit_status,
         deposit_deadline, deposit_amount_cents, booked_price_cents)
       VALUES ($1, $2, $3, $4, $5, $6, 'pending_deposit', 'cabinet',
         encode(gen_random_bytes(8),'hex'), true, 'pending', $7, 10000, 20000)
       RETURNING id`,
      [IDS.BUSINESS, IDS.PRAC_ALICE, IDS.SVC_EXPENSIVE, IDS.CLIENT_JEAN,
       startAt, endAt, expiredDeadline]
    );
    const bkId = ins.rows[0].id;

    const { processExpiredDeposits } = require('../../../src/services/deposit-expiry');
    const result = await processExpiredDeposits();
    expect(result.processed).toBeGreaterThanOrEqual(1);

    const after = await pool.query(
      `SELECT status, deposit_status, cancel_reason FROM bookings WHERE id = $1`,
      [bkId]
    );
    expect(after.rows[0].status).toBe('cancelled');
    expect(after.rows[0].deposit_status).toBe('cancelled');
    expect(after.rows[0].cancel_reason).toMatch(/acompte/i);
  });
});
