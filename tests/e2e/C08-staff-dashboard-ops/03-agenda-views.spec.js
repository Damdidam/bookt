/**
 * C08 / spec 03 — Agenda views via GET /api/bookings.
 *
 * Real filters (from src/routes/staff/bookings.js GET /) are `from`, `to`,
 * `status`, `practitioner_id`, `limit`. There is no `date` or `start`/`end`
 * alias — the test uses `from` + `to` with a timezone-safe ISO window.
 *
 * 3 tests.
 */
const { test, expect } = require('@playwright/test');
const IDS = require('../fixtures/ids');
const { staffFetch, ownerToken, staffToken } = require('../fixtures/api-client');
const { resetMutables } = require('../fixtures/reset-mutables');
const { pool } = require('../../../src/services/db');

test.describe('C08 — staff ops : agenda views', () => {
  let sinceTs;
  test.beforeEach(async () => {
    sinceTs = new Date(Date.now() - 1000).toISOString();
    await resetMutables();
  });

  test('1. Day view: GET /api/bookings?from=...&to=... returns bookings for that day', async () => {
    // Insert a future booking at 10:00 today+2d so we know one falls in our window
    const dayStart = new Date();
    dayStart.setDate(dayStart.getDate() + 2);
    dayStart.setHours(10, 0, 0, 0);
    const dayEnd = new Date(dayStart);
    dayEnd.setHours(11, 0, 0, 0);

    const ins = await pool.query(
      `INSERT INTO bookings (business_id, practitioner_id, service_id, client_id, start_at, end_at,
         status, appointment_mode, public_token, booked_price_cents)
       VALUES ($1, $2, $3, $4, $5, $6, 'confirmed', 'cabinet', encode(gen_random_bytes(8),'hex'), 5000)
       RETURNING id`,
      [IDS.BUSINESS, IDS.PRAC_ALICE, IDS.SVC_SHORT, IDS.CLIENT_JEAN,
       dayStart.toISOString(), dayEnd.toISOString()]
    );
    const bkId = ins.rows[0].id;

    const windowStart = new Date(dayStart);
    windowStart.setHours(0, 0, 0, 0);
    const windowEnd = new Date(dayStart);
    windowEnd.setHours(23, 59, 59, 999);

    const res = await staffFetch(
      `/api/bookings?from=${encodeURIComponent(windowStart.toISOString())}&to=${encodeURIComponent(windowEnd.toISOString())}`
    );
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.bookings)).toBe(true);
    const ids = res.body.bookings.map(b => b.id);
    expect(ids).toContain(bkId);
  });

  test('2. Week view: GET /api/bookings with 7-day range returns multiple days', async () => {
    const weekStart = new Date();
    weekStart.setDate(weekStart.getDate() + 1);
    weekStart.setHours(0, 0, 0, 0);
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekEnd.getDate() + 7);

    // Insert two bookings on different days of this window
    const d1 = new Date(weekStart); d1.setHours(9, 0, 0, 0);
    const d1e = new Date(d1); d1e.setHours(10, 0, 0, 0);
    const d2 = new Date(weekStart); d2.setDate(d2.getDate() + 3); d2.setHours(14, 0, 0, 0);
    const d2e = new Date(d2); d2e.setHours(15, 0, 0, 0);

    const ins = await pool.query(
      `INSERT INTO bookings (business_id, practitioner_id, service_id, client_id, start_at, end_at,
         status, appointment_mode, public_token, booked_price_cents)
       VALUES ($1, $2, $3, $4, $5, $6, 'confirmed', 'cabinet', encode(gen_random_bytes(8),'hex'), 5000),
              ($1, $2, $3, $4, $7, $8, 'confirmed', 'cabinet', encode(gen_random_bytes(8),'hex'), 5000)
       RETURNING id`,
      [IDS.BUSINESS, IDS.PRAC_ALICE, IDS.SVC_SHORT, IDS.CLIENT_JEAN,
       d1.toISOString(), d1e.toISOString(), d2.toISOString(), d2e.toISOString()]
    );

    const res = await staffFetch(
      `/api/bookings?from=${encodeURIComponent(weekStart.toISOString())}&to=${encodeURIComponent(weekEnd.toISOString())}`
    );
    expect(res.status).toBe(200);
    const inWindowIds = res.body.bookings.map(b => b.id);
    for (const r of ins.rows) {
      expect(inWindowIds).toContain(r.id);
    }
  });

  test('3. Multi-prac view: owner sees all practitioners, practitioner sees only self', async () => {
    const ownerRes = await staffFetch('/api/bookings', { token: ownerToken() });
    expect(ownerRes.status).toBe(200);
    const pracSetOwner = new Set(ownerRes.body.bookings.map(b => b.practitioner_id));
    // Owner should at minimum see some seed bookings
    expect(pracSetOwner.size).toBeGreaterThanOrEqual(1);

    const bobRes = await staffFetch('/api/bookings', { token: staffToken() });
    expect(bobRes.status).toBe(200);
    for (const bk of bobRes.body.bookings) {
      expect(bk.practitioner_id).toBe(IDS.PRAC_BOB);
    }
  });
});
