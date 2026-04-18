/**
 * C14 / spec 01 — Dashboard alerts (types).
 *
 * Endpoint: GET /api/dashboard/summary
 * Alerts shape in body.alerts (cf src/routes/staff/dashboard.js:244-251):
 *   - pending_confirmations : COUNT bookings status='pending' +
 *       start_at > NOW() AND < NOW()+7d
 *   - unpaid_deposits       : COUNT bookings deposit_required=true +
 *       deposit_status='pending' + status NOT IN ('cancelled','no_show')
 *   - recent_no_shows       : COUNT bookings status='no_show' +
 *       start_at >= NOW()-7d
 *   - upcoming_absences     : ARRAY staff_absences (date_to >= today +
 *       date_from <= today+7)
 *
 * Note: status check contraint on bookings.status → 'modified_pending' n'est PAS
 * compté dans pending_confirmations (seul 'pending'). Test adapté.
 *
 * 4 tests.
 */
const { test, expect } = require('@playwright/test');
const IDS = require('../fixtures/ids');
const { staffFetch } = require('../fixtures/api-client');
const { resetMutables } = require('../fixtures/reset-mutables');
const { pool } = require('../../../src/services/db');

// Alice availability : not on Sun/Mon/Tue — pick safe future slot
function futureStart(daysOut = 3, hour = 10) {
  const d = new Date();
  d.setDate(d.getDate() + daysOut);
  while (d.getDay() === 0 || d.getDay() === 1 || d.getDay() === 2) {
    d.setDate(d.getDate() + 1);
  }
  d.setHours(hour, 0, 0, 0);
  return d;
}

test.describe('C14 — dashboard alerts : types', () => {
  let sinceTs;
  test.beforeEach(async () => {
    sinceTs = new Date(Date.now() - 1000).toISOString();
    await resetMutables();
    await pool.query(
      `DELETE FROM staff_absences WHERE business_id = $1 AND note LIKE 'C14-TEST%'`,
      [IDS.BUSINESS]
    );
  });

  test('1. Alert pending_confirmations — pending booking inflates the count', async () => {
    // Baseline
    const baseline = await staffFetch('/api/dashboard/summary');
    expect(baseline.status).toBe(200);
    const baseCount = baseline.body.alerts.pending_confirmations;

    // INSERT a future pending booking
    const start = futureStart(4, 11);
    const end = new Date(start.getTime() + 30 * 60000);
    const ins = await pool.query(
      `INSERT INTO bookings (business_id, service_id, practitioner_id, client_id,
                             start_at, end_at, status, booked_price_cents, channel)
       VALUES ($1, $2, $3, $4, $5, $6, 'pending', 2500, 'manual')
       RETURNING id`,
      [IDS.BUSINESS, IDS.SVC_SHORT, IDS.PRAC_ALICE, IDS.CLIENT_JEAN,
       start.toISOString(), end.toISOString()]
    );

    const after = await staffFetch('/api/dashboard/summary');
    expect(after.status).toBe(200);
    expect(after.body.alerts.pending_confirmations).toBeGreaterThanOrEqual(baseCount + 1);

    // cleanup
    await pool.query(`DELETE FROM bookings WHERE id = $1`, [ins.rows[0].id]);
  });

  test('2. Alert unpaid_deposits — booking with deposit_status=pending', async () => {
    const baseline = await staffFetch('/api/dashboard/summary');
    const baseCount = baseline.body.alerts.unpaid_deposits;

    const start = futureStart(5, 12);
    const end = new Date(start.getTime() + 30 * 60000);
    const deadline = new Date(Date.now() + 24 * 3600000).toISOString();
    const ins = await pool.query(
      `INSERT INTO bookings (business_id, service_id, practitioner_id, client_id,
                             start_at, end_at, status, booked_price_cents, channel,
                             deposit_required, deposit_status, deposit_amount_cents, deposit_deadline)
       VALUES ($1, $2, $3, $4, $5, $6, 'pending_deposit', 5000, 'manual',
               true, 'pending', 1500, $7)
       RETURNING id`,
      [IDS.BUSINESS, IDS.SVC_SHORT, IDS.PRAC_ALICE, IDS.CLIENT_JEAN,
       start.toISOString(), end.toISOString(), deadline]
    );

    const after = await staffFetch('/api/dashboard/summary');
    expect(after.status).toBe(200);
    expect(after.body.alerts.unpaid_deposits).toBeGreaterThanOrEqual(baseCount + 1);

    await pool.query(`DELETE FROM bookings WHERE id = $1`, [ins.rows[0].id]);
  });

  test('3. Alert recent_no_shows — BK_NOSHOW_1 seed at J-3 appears in count', async () => {
    // seed has BK_NOSHOW_1 status='no_show' at days:-3 → should be counted
    // in recent_no_shows (start_at >= NOW()-7d).
    const res = await staffFetch('/api/dashboard/summary');
    expect(res.status).toBe(200);
    expect(res.body.alerts.recent_no_shows).toBeGreaterThanOrEqual(1);

    // Sanity-check that BK_NOSHOW_1 is indeed present in the 7-day window.
    const r = await pool.query(
      `SELECT id FROM bookings WHERE id = $1
       AND status = 'no_show' AND start_at >= NOW() - INTERVAL '7 days'`,
      [IDS.BK_NOSHOW_1]
    );
    expect(r.rows.length).toBe(1);
  });

  test('4. Alert upcoming_absences — insert staff_absences returned in summary', async () => {
    const baseline = await staffFetch('/api/dashboard/summary');
    const baseLen = baseline.body.alerts.upcoming_absences.length;

    // Insert a future absence (date_from tomorrow, date_to J+3)
    const today = new Date();
    const tomorrow = new Date(today); tomorrow.setDate(today.getDate() + 1);
    const inThree = new Date(today); inThree.setDate(today.getDate() + 3);
    const fromStr = tomorrow.toISOString().slice(0, 10);
    const toStr = inThree.toISOString().slice(0, 10);

    const ins = await pool.query(
      `INSERT INTO staff_absences (business_id, practitioner_id, date_from, date_to, type, note)
       VALUES ($1, $2, $3, $4, 'conge', 'C14-TEST absence')
       RETURNING id, date_from, date_to, type`,
      [IDS.BUSINESS, IDS.PRAC_ALICE, fromStr, toStr]
    );

    const after = await staffFetch('/api/dashboard/summary');
    expect(after.status).toBe(200);
    expect(Array.isArray(after.body.alerts.upcoming_absences)).toBe(true);
    expect(after.body.alerts.upcoming_absences.length).toBeGreaterThanOrEqual(baseLen + 1);

    // At least one absence should have our practitioner + type 'conge'
    const hasOurs = after.body.alerts.upcoming_absences.some(
      a => a.type === 'conge' && a.practitioner_name
    );
    expect(hasOurs).toBe(true);

    await pool.query(`DELETE FROM staff_absences WHERE id = $1`, [ins.rows[0].id]);
  });
});
