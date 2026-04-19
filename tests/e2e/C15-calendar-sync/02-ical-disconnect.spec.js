/**
 * C15 / spec 02 — iCal feed generation + disconnect.
 *
 * Endpoints:
 *   POST   /api/calendar/ical/generate        — creates/rotates ical connection
 *   GET    /api/calendar/ical/:token          — public iCal feed (text/calendar)
 *   DELETE /api/calendar/connections/:id      — disconnect + purge calendar_events
 *
 * Token format = base64url("<business_id>:<practitioner_id|all>:<secret>").
 * The secret is persisted encrypted-or-plain in calendar_connections.access_token
 * (column stores the raw value when CALENDAR_TOKEN_KEY absent).
 *
 * 3 tests.
 */
const { test, expect } = require('@playwright/test');
const IDS = require('../fixtures/ids');
const { staffFetch, ownerToken, BASE_URL } = require('../fixtures/api-client');
const { resetMutables } = require('../fixtures/reset-mutables');
const { pool } = require('../../../src/services/db');

async function cleanupTestConnections() {
  // Wipe any calendar connections created during tests for our seed business
  await pool.query(
    `DELETE FROM calendar_events WHERE connection_id IN
       (SELECT id FROM calendar_connections WHERE business_id = $1)`,
    [IDS.BUSINESS]
  );
  await pool.query(
    `DELETE FROM calendar_connections WHERE business_id = $1`,
    [IDS.BUSINESS]
  );
}

test.describe('C15 — iCal feed + disconnect', () => {
  let sinceTs;
  test.beforeEach(async () => {
    sinceTs = new Date(Date.now() - 1000).toISOString();
    await resetMutables();
    await cleanupTestConnections();
  });

  test.afterAll(async () => {
    await cleanupTestConnections();
  });

  test('1. POST /api/calendar/ical/generate then GET /api/calendar/ical/:token', async () => {
    // Generate feed for all practitioners
    const gen = await staffFetch('/api/calendar/ical/generate', {
      method: 'POST',
      body: { practitioner_id: null },
      token: ownerToken()
    });
    expect(gen.status, `gen: ${JSON.stringify(gen.body)}`).toBe(200);
    expect(gen.body.ical_url).toMatch(/\/api\/calendar\/ical\//);
    expect(gen.body.webcal_url).toMatch(/^webcal:\/\//);
    expect(typeof gen.body.token).toBe('string');

    // Fetch the feed (no auth on the public :token route)
    const feedRes = await fetch(BASE_URL + '/api/calendar/ical/' + gen.body.token);
    // Bug #7 fixé (commit 3f26a5a) : Content-Disposition encode filename RFC 5987
    // (ASCII fallback + filename*=UTF-8''…) → plus de ERR_INVALID_CHAR même si le
    // nom du business contient em-dash / accents.
    expect(feedRes.status, `feed status for business with em-dash in name`).toBe(200);
    expect(feedRes.headers.get('content-type') || '').toMatch(/text\/calendar/);
    const disposition = feedRes.headers.get('content-disposition') || '';
    // Header doit contenir à la fois le fallback ASCII et la variante UTF-8 encodée
    expect(disposition).toMatch(/filename=".+\.ics"/);
    expect(disposition).toMatch(/filename\*=UTF-8''/);
    const body = await feedRes.text();
    expect(body).toMatch(/^BEGIN:VCALENDAR/);
    expect(body).toMatch(/END:VCALENDAR/);
    expect(body).toMatch(/X-WR-CALNAME:/);
  });

  test('2. DELETE /api/calendar/connections/:id — disconnect removes row', async () => {
    // Create a real ical connection via generate, then disconnect via DELETE.
    const gen = await staffFetch('/api/calendar/ical/generate', {
      method: 'POST',
      body: { practitioner_id: null },
      token: ownerToken()
    });
    expect(gen.status).toBe(200);

    // Find the connection id
    const r1 = await pool.query(
      `SELECT id FROM calendar_connections WHERE business_id = $1 AND provider = 'ical'`,
      [IDS.BUSINESS]
    );
    expect(r1.rows.length).toBe(1);
    const connId = r1.rows[0].id;

    const del = await staffFetch(`/api/calendar/connections/${connId}`, {
      method: 'DELETE',
      token: ownerToken()
    });
    expect(del.status, `del: ${JSON.stringify(del.body)}`).toBe(200);
    expect(del.body.disconnected).toBe(true);

    // Row is gone
    const r2 = await pool.query(
      `SELECT id FROM calendar_connections WHERE id = $1`, [connId]
    );
    expect(r2.rows.length).toBe(0);
  });

  test('3. DELETE fake google connection purges calendar_events', async () => {
    // Insert a fake google connection + one dummy calendar_event FK row.
    const connIns = await pool.query(
      `INSERT INTO calendar_connections
        (business_id, user_id, provider, access_token, status, sync_direction, sync_enabled)
       VALUES ($1, $2, 'google', 'fake-token-xyz', 'active', 'both', true)
       RETURNING id`,
      [IDS.BUSINESS, IDS.USER_ALICE_OWNER]
    );
    const connId = connIns.rows[0].id;

    // Create a dummy booking to satisfy FK + one calendar_event row pointing to conn
    const startAt = new Date(Date.now() + 7 * 86400000).toISOString();
    const endAt = new Date(Date.now() + 7 * 86400000 + 30 * 60000).toISOString();
    const bkIns = await pool.query(
      `INSERT INTO bookings (business_id, service_id, practitioner_id, client_id,
                             start_at, end_at, status, booked_price_cents, channel)
       VALUES ($1, $2, $3, $4, $5, $6, 'confirmed', 2500, 'manual')
       RETURNING id`,
      [IDS.BUSINESS, IDS.SVC_SHORT, IDS.PRAC_ALICE, IDS.CLIENT_JEAN, startAt, endAt]
    );
    const bkId = bkIns.rows[0].id;

    await pool.query(
      `INSERT INTO calendar_events (connection_id, booking_id, external_event_id, direction, synced_at)
       VALUES ($1, $2, 'gcal-xyz', 'push', NOW())`,
      [connId, bkId]
    );

    // Before: 1 event
    const before = await pool.query(
      `SELECT COUNT(*)::int AS n FROM calendar_events WHERE connection_id = $1`, [connId]
    );
    expect(before.rows[0].n).toBe(1);

    // DELETE
    const del = await staffFetch(`/api/calendar/connections/${connId}`, {
      method: 'DELETE',
      token: ownerToken()
    });
    expect(del.status).toBe(200);

    // calendar_events purged, connection purged
    const evAfter = await pool.query(
      `SELECT COUNT(*)::int AS n FROM calendar_events WHERE connection_id = $1`, [connId]
    );
    expect(evAfter.rows[0].n).toBe(0);
    const connAfter = await pool.query(
      `SELECT COUNT(*)::int AS n FROM calendar_connections WHERE id = $1`, [connId]
    );
    expect(connAfter.rows[0].n).toBe(0);

    // Cleanup booking
    await pool.query(`DELETE FROM bookings WHERE id = $1`, [bkId]);
  });
});
