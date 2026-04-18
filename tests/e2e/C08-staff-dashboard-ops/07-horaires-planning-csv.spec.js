/**
 * C08 / spec 07 — Horaires, planning (absences), CSV import, client search + detail.
 *
 * Endpoints:
 *   GET  /api/business-hours
 *   PUT  /api/business-hours                 — replaces weekly schedule
 *   GET  /api/availabilities
 *   PUT  /api/availabilities                 — body {practitioner_id, schedule}
 *   POST /api/planning/absences              — body {practitioner_id, date_from, date_to, type?}
 *   POST /api/clients/import                 — body {clients:[{full_name, phone, email}]}
 *   GET  /api/clients?search=...             — (not `q`: query param is `search`)
 *   GET  /api/clients/:id
 *
 * 7 tests.
 */
const { test, expect } = require('@playwright/test');
const IDS = require('../fixtures/ids');
const { staffFetch } = require('../fixtures/api-client');
const { resetMutables } = require('../fixtures/reset-mutables');
const { pool } = require('../../../src/services/db');

test.describe('C08 — staff ops : horaires, planning, CSV, clients', () => {
  let sinceTs;
  test.beforeEach(async () => {
    sinceTs = new Date(Date.now() - 1000).toISOString();
    await resetMutables();
    // Also clean any test absences created by prior runs
    await pool.query(
      `DELETE FROM staff_absences WHERE business_id = $1 AND note ILIKE 'C08-TEST%'`,
      [IDS.BUSINESS]
    );
  });

  test('1. CRUD horaires business: GET then PUT overwrites', async () => {
    const getRes = await staffFetch('/api/business-hours');
    expect(getRes.status).toBe(200);
    expect(getRes.body.schedule).toBeTruthy();
    expect(Array.isArray(getRes.body.closures)).toBe(true);

    // Save current schedule so we can restore
    const current = getRes.body.schedule;

    // PUT a new weekly schedule — Tuesday 10-17
    const putRes = await staffFetch('/api/business-hours', {
      method: 'PUT',
      body: {
        schedule: {
          '2': [{ start_time: '10:00', end_time: '17:00' }],
        },
      },
    });
    expect(putRes.status, `put: ${JSON.stringify(putRes.body)}`).toBe(200);

    const r = await pool.query(
      `SELECT weekday, start_time, end_time FROM business_schedule
       WHERE business_id = $1 AND is_active = true`,
      [IDS.BUSINESS]
    );
    expect(r.rows.length).toBe(1);
    expect(r.rows[0].weekday).toBe(2);
    expect(r.rows[0].start_time).toBe('10:00:00');

    // Restore seed schedule: weekdays 1..6, 09:00-19:00
    const restore = {};
    for (const [weekday, windows] of Object.entries(current)) {
      restore[weekday] = windows.map(w => ({ start_time: w.start_time.slice(0, 5), end_time: w.end_time.slice(0, 5) }));
    }
    await staffFetch('/api/business-hours', { method: 'PUT', body: { schedule: restore } });
  });

  test('2. CRUD horaires practitioner via GET + PUT /api/availabilities', async () => {
    const getRes = await staffFetch('/api/availabilities');
    expect(getRes.status).toBe(200);
    expect(getRes.body.availabilities).toBeTruthy();

    // Snapshot Carol's current schedule (likely empty)
    const carolBefore = (await pool.query(
      `SELECT weekday, start_time, end_time FROM availabilities WHERE practitioner_id = $1`,
      [IDS.PRAC_CAROL]
    )).rows;

    // Replace with a simple weekday-3 (Thu in DB mondays-based) 10-14
    const putRes = await staffFetch('/api/availabilities', {
      method: 'PUT',
      body: {
        practitioner_id: IDS.PRAC_CAROL,
        schedule: { '3': [{ start_time: '10:00', end_time: '14:00' }] },
      },
    });
    expect(putRes.status, `put: ${JSON.stringify(putRes.body)}`).toBe(200);

    const after = await pool.query(
      `SELECT weekday, start_time, end_time FROM availabilities WHERE practitioner_id = $1`,
      [IDS.PRAC_CAROL]
    );
    expect(after.rows.length).toBe(1);
    expect(after.rows[0].weekday).toBe(3);

    // Restore
    await pool.query(`DELETE FROM availabilities WHERE practitioner_id = $1`, [IDS.PRAC_CAROL]);
    for (const w of carolBefore) {
      await pool.query(
        `INSERT INTO availabilities (business_id, practitioner_id, weekday, start_time, end_time)
         VALUES ($1, $2, $3, $4, $5)`,
        [IDS.BUSINESS, IDS.PRAC_CAROL, w.weekday, w.start_time, w.end_time]
      );
    }
  });

  test('3. Create practitioner absence via POST /api/planning/absences', async () => {
    const from = new Date(); from.setDate(from.getDate() + 10);
    const to = new Date(from); to.setDate(to.getDate() + 2);
    const fromStr = from.toISOString().slice(0, 10);
    const toStr = to.toISOString().slice(0, 10);

    const res = await staffFetch('/api/planning/absences', {
      method: 'POST',
      body: {
        practitioner_id: IDS.PRAC_BOB,
        date_from: fromStr,
        date_to: toStr,
        type: 'conge',
        note: 'C08-TEST absence',
      },
    });
    expect(res.status, `absence create: ${JSON.stringify(res.body)}`).toBe(201);
    expect(res.body.absence).toBeTruthy();
    expect(res.body.absence.practitioner_id).toBe(IDS.PRAC_BOB);

    // Verify absence blocks availability: checkPracAvailability should now reject
    // a booking on one of the absence days. We probe via a direct DB check.
    const r = await pool.query(
      `SELECT COUNT(*)::int AS cnt FROM staff_absences
       WHERE business_id = $1 AND practitioner_id = $2
         AND date_from <= $3::date AND date_to >= $3::date`,
      [IDS.BUSINESS, IDS.PRAC_BOB, fromStr]
    );
    expect(r.rows[0].cnt).toBeGreaterThan(0);

    // Cleanup
    await pool.query(`DELETE FROM staff_absences WHERE id = $1`, [res.body.absence.id]);
  });

  test('4. CSV import clients with E164 duplicate detection', async () => {
    const tag = Date.now();
    const res = await staffFetch('/api/clients/import', {
      method: 'POST',
      body: {
        clients: [
          { full_name: `Csv One ${tag}`, phone: '+32470111111', email: `csv1-${tag}@genda-test.be` },
          { full_name: `Csv Two ${tag}`, phone: '0470 111 111', email: `csv2-${tag}@genda-test.be` }, // same phone BE format → dedup
          { full_name: `Csv Three ${tag}`, phone: '+32480222222', email: `csv3-${tag}@genda-test.be` },
        ],
      },
    });
    expect(res.status, `import: ${JSON.stringify(res.body)}`).toBe(200);
    expect(res.body.imported).toBeGreaterThan(0);
    expect(res.body.skipped).toBeGreaterThanOrEqual(1);
    expect(Array.isArray(res.body.errors)).toBe(true);
  });

  test('5. CSV import with invalid rows → errors[] returned', async () => {
    const tag = Date.now();
    const res = await staffFetch('/api/clients/import', {
      method: 'POST',
      body: {
        clients: [
          { full_name: '', phone: '+32470999111', email: `bademail-${tag}@ok.be` },       // missing name
          { full_name: `Bad Email ${tag}`, phone: '', email: 'not-an-email' },              // bad email
          { full_name: `Bad Phone ${tag}`, phone: 'abc', email: `okphone-${tag}@ok.be` },   // bad phone
        ],
      },
    });
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.errors)).toBe(true);
    expect(res.body.errors.length).toBeGreaterThanOrEqual(1);
  });

  test('6. Client search via GET /api/clients?search=jean returns match', async () => {
    // Seed clients include Jean. Query backend uses `search` (not `q`).
    const res = await staffFetch('/api/clients?search=jean');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.clients)).toBe(true);
    const found = res.body.clients.find(c => c.id === IDS.CLIENT_JEAN);
    expect(found, `clients: ${JSON.stringify(res.body.clients.map(c => c.full_name))}`).toBeTruthy();
  });

  test('7. Client detail + bookings via GET /api/clients/:id', async () => {
    const res = await staffFetch(`/api/clients/${IDS.CLIENT_JEAN}`);
    expect(res.status).toBe(200);
    expect(res.body.client).toBeTruthy();
    expect(res.body.client.id).toBe(IDS.CLIENT_JEAN);
    expect(Array.isArray(res.body.bookings)).toBe(true);
    // At least one booking historique should belong to Jean (BK_COMPLETED_1-3/NOSHOW_1)
    // depending on seed. Check the response includes the bookings[] array.
    expect(res.body).toHaveProperty('bookings');
  });
});
