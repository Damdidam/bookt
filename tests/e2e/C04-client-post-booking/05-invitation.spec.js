/**
 * C04 / spec 05 — Invitation flow (pro-initiated bookings with status='pending').
 *
 * When the business has settings.booking_confirmation_required=true, new public
 * bookings land in status='pending' and the client must POST /confirm-booking
 * to flip to 'confirmed'. To reject, the client POSTs /cancel (which accepts
 * 'pending' as eligible status).
 *
 * Endpoints:
 *   POST /api/public/booking/:token/confirm-booking — pending → confirmed (JSON)
 *   POST /api/public/booking/:token/cancel          — any eligible → cancelled
 *
 * For these tests we seed the booking via direct INSERT with status='pending'
 * to bypass the business settings toggle.
 *
 * 2 tests.
 */
const { test, expect } = require('@playwright/test');
const IDS = require('../fixtures/ids');
const { publicFetch } = require('../fixtures/api-client');
const { resetMutables } = require('../fixtures/reset-mutables');
const { pool } = require('../../../src/services/db');

async function insertPendingBooking(serviceId) {
  const startAt = new Date(Date.now() + 5 * 86400000).toISOString();
  const endAt = new Date(Date.now() + 5 * 86400000 + 1800000).toISOString();
  const r = await pool.query(
    `INSERT INTO bookings (business_id, practitioner_id, service_id, client_id, start_at, end_at,
       status, appointment_mode, public_token, booked_price_cents, confirmation_expires_at)
     VALUES ($1, $2, $3, $4, $5, $6, 'pending', 'cabinet', encode(gen_random_bytes(8),'hex'),
       1500, NOW() + INTERVAL '7 days')
     RETURNING id, public_token`,
    [IDS.BUSINESS, IDS.PRAC_ALICE, serviceId, IDS.CLIENT_JEAN, startAt, endAt]
  );
  return { id: r.rows[0].id, token: r.rows[0].public_token };
}

test.describe('C04 — invitation: confirm + reject pending', () => {
  let sinceTs;
  test.beforeEach(async () => {
    sinceTs = new Date(Date.now() - 1000).toISOString();
    await resetMutables();
  });

  test('1. Reject pending invitation → status=cancelled', async () => {
    const { id, token } = await insertPendingBooking(IDS.SVC_SHORT);

    const res = await publicFetch(`/api/public/booking/${token}/cancel`, {
      method: 'POST',
      body: { reason: 'Pas disponible' },
    });
    expect(res.status, `Cancel error: ${JSON.stringify(res.body)}`).toBe(200);
    expect(res.body.cancelled).toBe(true);

    const after = await pool.query(
      `SELECT status, cancel_reason FROM bookings WHERE id = $1`,
      [id]
    );
    expect(after.rows[0].status).toBe('cancelled');
    expect(after.rows[0].cancel_reason).toBe('Pas disponible');
  });

  test('2. Confirm pending invitation → status=confirmed', async () => {
    const { id, token } = await insertPendingBooking(IDS.SVC_SHORT);

    const res = await publicFetch(`/api/public/booking/${token}/confirm-booking`, {
      method: 'POST',
      body: {},
    });
    expect(res.status, `Confirm error: ${JSON.stringify(res.body)}`).toBe(200);
    expect(res.body.confirmed).toBe(true);

    const after = await pool.query(
      `SELECT status, locked, confirmation_expires_at FROM bookings WHERE id = $1`,
      [id]
    );
    expect(after.rows[0].status).toBe('confirmed');
    expect(after.rows[0].locked).toBe(true);
    expect(after.rows[0].confirmation_expires_at).toBeNull();
  });
});
