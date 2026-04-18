/**
 * C11 / spec 01 — Practitioner scope enforcement.
 *
 * Practitioner role (Bob) must only see / mutate their OWN bookings.
 * Relevant middleware: resolvePractitionerScope (src/middleware/auth.js:102) +
 * per-route checks on req.practitionerFilter in bookings.js / bookings-status.js /
 * bookings-time.js.
 *
 * 3 tests.
 */
const { test, expect } = require('@playwright/test');
const IDS = require('../fixtures/ids');
const { staffFetch, ownerToken, staffToken } = require('../fixtures/api-client');
const { resetMutables } = require('../fixtures/reset-mutables');
const { pool } = require('../../../src/services/db');

// Alice availability : not on Sun/Mon/Tue (getDay 0/1/2) — see C08 spec 04.
const futureStart = (daysOut = 3, hour = 10) => {
  const d = new Date();
  d.setDate(d.getDate() + daysOut);
  while (d.getDay() === 0 || d.getDay() === 1 || d.getDay() === 2) {
    d.setDate(d.getDate() + 1);
  }
  d.setHours(hour, 0, 0, 0);
  return d;
};

async function insertBooking({ pracId, clientId = IDS.CLIENT_JEAN, daysOut, hour }) {
  const start = futureStart(daysOut, hour);
  const end = new Date(start.getTime() + 30 * 60000);
  const r = await pool.query(
    `INSERT INTO bookings (business_id, service_id, practitioner_id, client_id, start_at, end_at, status, booked_price_cents, channel)
     VALUES ($1, $2, $3, $4, $5, $6, 'confirmed', 2500, 'manual')
     RETURNING id, start_at, practitioner_id`,
    [IDS.BUSINESS, IDS.SVC_SHORT, pracId, clientId, start.toISOString(), end.toISOString()]
  );
  return r.rows[0];
}

test.describe('C11 — multi-tenant RBAC : practitioner scope', () => {
  let sinceTs;
  test.beforeEach(async () => {
    sinceTs = new Date(Date.now() - 1000).toISOString();
    await resetMutables();
  });

  test('1. Practitioner (Bob) → GET /api/bookings ne voit QUE ses RDV', async () => {
    // Insert one booking for Alice and one for Bob in the future (the seed already has
    // historical rows on both pracs but those are excluded from the calendar feed
    // after 1 day).
    const aliceBk = await insertBooking({ pracId: IDS.PRAC_ALICE, daysOut: 3, hour: 10 });
    const bobBk = await insertBooking({ pracId: IDS.PRAC_BOB, daysOut: 3, hour: 14 });

    const bobRes = await staffFetch('/api/bookings', { token: staffToken() });
    expect(bobRes.status).toBe(200);
    expect(Array.isArray(bobRes.body.bookings)).toBe(true);

    // Every row returned to Bob must belong to Bob.
    for (const bk of bobRes.body.bookings) {
      expect(bk.practitioner_id).toBe(IDS.PRAC_BOB);
    }
    const ids = bobRes.body.bookings.map(b => b.id);
    expect(ids).toContain(bobBk.id);
    expect(ids).not.toContain(aliceBk.id);

    // Owner should see both
    const ownerRes = await staffFetch('/api/bookings', { token: ownerToken() });
    expect(ownerRes.status).toBe(200);
    const ownerIds = ownerRes.body.bookings.map(b => b.id);
    expect(ownerIds).toContain(aliceBk.id);
    expect(ownerIds).toContain(bobBk.id);
  });

  test('2. Practitioner PATCH /bookings/:id/move sur RDV d\'Alice → 403', async () => {
    const aliceBk = await insertBooking({ pracId: IDS.PRAC_ALICE, daysOut: 4, hour: 9 });

    const newStart = futureStart(4, 14);
    const newEnd = new Date(newStart.getTime() + 30 * 60000);
    const moveRes = await staffFetch(`/api/bookings/${aliceBk.id}/move`, {
      method: 'PATCH',
      token: staffToken(),
      body: { start_at: newStart.toISOString(), end_at: newEnd.toISOString() },
    });
    // bookings-time.js:162 returns 403 'Accès interdit' when practitionerFilter mismatches.
    // Could also return 404 if a future hardened version filters at SELECT level.
    expect([403, 404], `move status on Alice's booking: ${moveRes.status} body=${JSON.stringify(moveRes.body)}`).toContain(moveRes.status);

    // DB must be unchanged
    const r = await pool.query(`SELECT start_at FROM bookings WHERE id = $1`, [aliceBk.id]);
    expect(new Date(r.rows[0].start_at).getTime()).toBe(new Date(aliceBk.start_at).getTime());
  });

  test('3. Practitioner PATCH /bookings/:id/status = cancelled sur RDV d\'Alice → 403', async () => {
    const aliceBk = await insertBooking({ pracId: IDS.PRAC_ALICE, daysOut: 5, hour: 11 });

    const cancelRes = await staffFetch(`/api/bookings/${aliceBk.id}/status`, {
      method: 'PATCH',
      token: staffToken(),
      body: { status: 'cancelled', cancel_reason: 'Bob tente de cancel Alice' },
    });
    // bookings-status.js:141 returns 403 'Accès interdit' for scope mismatch.
    expect([403, 404], `cancel status: ${cancelRes.status} body=${JSON.stringify(cancelRes.body)}`).toContain(cancelRes.status);

    // DB : booking still confirmed
    const r = await pool.query(`SELECT status FROM bookings WHERE id = $1`, [aliceBk.id]);
    expect(r.rows[0].status).toBe('confirmed');
  });
});
