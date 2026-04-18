/**
 * C03 / spec 01 — Promo activity & expiry edge cases.
 *
 * Each test temporarily mutates a promo row to simulate a lifecycle condition,
 * POSTs a public booking that would normally apply the promo, and verifies
 * that the backend correctly REJECTS the promo (valid:false / promotion=null).
 *
 * 4 tests :
 *   1. max_uses reached (current_uses=100, max_uses=100) → promo rejected
 *   2. is_active=false                                   → promo rejected
 *   3. condition_end_date passé (date_range promo)       → promo rejected
 *   4. condition_start_date futur (date_range promo)     → promo rejected
 *
 * resetMutables() in beforeEach restaure current_uses=0 + is_active=true via
 * the promotions seed rule. For condition_start/end_date, we restore manually
 * in afterEach.
 */
const { test, expect } = require('@playwright/test');
const IDS = require('../fixtures/ids');
const { publicFetch } = require('../fixtures/api-client');
const { resetMutables } = require('../fixtures/reset-mutables');
const { pool } = require('../../../src/services/db');

const SLUG = 'test-demo-salon';

function isoPlusDays(days, hour = 10) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  d.setHours(hour, 0, 0, 0);
  return d.toISOString();
}

async function bookSvcLong({ email, days, hour, promotion_id }) {
  return await publicFetch(`/api/public/${SLUG}/bookings`, {
    method: 'POST',
    body: {
      service_id: IDS.SVC_LONG,
      practitioner_id: IDS.PRAC_ALICE,
      start_at: isoPlusDays(days, hour),
      appointment_mode: 'cabinet',
      client_name: 'E2E C03 Edge',
      client_email: email,
      client_phone: `+3249100${String(Math.floor(Math.random() * 9000) + 1000)}`,
      consent_sms: true,
      consent_email: true,
      consent_marketing: false,
      promotion_id,
    },
  });
}

test.describe('C03 — promos edge: activity/expiry', () => {
  let sinceTs;
  test.beforeEach(async () => {
    sinceTs = new Date(Date.now() - 1000).toISOString();
    await resetMutables();
  });

  test('1. max_uses atteint (current_uses=100/100) → promo rejetée', async () => {
    // Bump current_uses to match max_uses (seed max=100)
    await pool.query(
      `UPDATE promotions SET current_uses = max_uses WHERE id = $1`,
      [IDS.PROMO_PCT]
    );

    const email = `e2e-c03-maxuses-${Date.now()}@genda-test.be`;
    const { status, body } = await bookSvcLong({ email, days: 7, hour: 9, promotion_id: IDS.PROMO_PCT });

    // Booking succeeds but promo NOT applied (limit_reached short-circuits validateAndCalcPromo)
    expect(status, `API error: ${JSON.stringify(body)}`).toBe(201);
    expect(body.promotion).toBeNull();
    expect(body.booking.promotion_discount_cents || 0).toBe(0);

    const dbRow = await pool.query(
      `SELECT promotion_id, promotion_discount_cents FROM bookings WHERE id = $1`,
      [body.booking.id]
    );
    expect(dbRow.rows[0].promotion_id).toBeNull();
    expect(dbRow.rows[0].promotion_discount_cents).toBe(0);
    // current_uses remained at 100 (no increment since promo rejected)
    const promoRow = await pool.query(`SELECT current_uses FROM promotions WHERE id = $1`, [IDS.PROMO_PCT]);
    expect(promoRow.rows[0].current_uses).toBe(100);
  });

  test('2. is_active=false → promo rejetée', async () => {
    await pool.query(
      `UPDATE promotions SET is_active = false WHERE id = $1`,
      [IDS.PROMO_PCT]
    );
    try {
      const email = `e2e-c03-inactive-${Date.now()}@genda-test.be`;
      const { status, body } = await bookSvcLong({ email, days: 7, hour: 12, promotion_id: IDS.PROMO_PCT });

      expect(status, `API error: ${JSON.stringify(body)}`).toBe(201);
      expect(body.promotion).toBeNull();
      expect(body.booking.promotion_discount_cents || 0).toBe(0);

      const dbRow = await pool.query(
        `SELECT promotion_id, promotion_discount_cents FROM bookings WHERE id = $1`,
        [body.booking.id]
      );
      expect(dbRow.rows[0].promotion_id).toBeNull();
      expect(dbRow.rows[0].promotion_discount_cents).toBe(0);
    } finally {
      // Restore is_active=true (resetMutables only touches current_uses)
      await pool.query(`UPDATE promotions SET is_active = true WHERE id = $1`, [IDS.PROMO_PCT]);
    }
  });

  test('3. condition_end_date passé → promo rejetée', async () => {
    // Snapshot original dates to restore
    const snap = await pool.query(
      `SELECT condition_start_date, condition_end_date FROM promotions WHERE id = $1`,
      [IDS.PROMO_DATE]
    );
    const origStart = snap.rows[0].condition_start_date;
    const origEnd = snap.rows[0].condition_end_date;

    await pool.query(
      `UPDATE promotions
         SET condition_start_date = CURRENT_DATE - INTERVAL '10 days',
             condition_end_date   = CURRENT_DATE - INTERVAL '1 day'
       WHERE id = $1`,
      [IDS.PROMO_DATE]
    );
    try {
      const email = `e2e-c03-expired-${Date.now()}@genda-test.be`;
      const { status, body } = await bookSvcLong({ email, days: 7, hour: 15, promotion_id: IDS.PROMO_DATE });

      expect(status, `API error: ${JSON.stringify(body)}`).toBe(201);
      expect(body.promotion).toBeNull();
      expect(body.booking.promotion_discount_cents || 0).toBe(0);

      const dbRow = await pool.query(
        `SELECT promotion_id, promotion_discount_cents FROM bookings WHERE id = $1`,
        [body.booking.id]
      );
      expect(dbRow.rows[0].promotion_id).toBeNull();
      expect(dbRow.rows[0].promotion_discount_cents).toBe(0);
    } finally {
      await pool.query(
        `UPDATE promotions SET condition_start_date = $2, condition_end_date = $3 WHERE id = $1`,
        [IDS.PROMO_DATE, origStart, origEnd]
      );
    }
  });

  test('4. condition_start_date futur → promo rejetée', async () => {
    const snap = await pool.query(
      `SELECT condition_start_date, condition_end_date FROM promotions WHERE id = $1`,
      [IDS.PROMO_DATE]
    );
    const origStart = snap.rows[0].condition_start_date;
    const origEnd = snap.rows[0].condition_end_date;

    await pool.query(
      `UPDATE promotions
         SET condition_start_date = CURRENT_DATE + INTERVAL '10 days',
             condition_end_date   = CURRENT_DATE + INTERVAL '40 days'
       WHERE id = $1`,
      [IDS.PROMO_DATE]
    );
    try {
      const email = `e2e-c03-future-${Date.now()}@genda-test.be`;
      // Book at J+4 (still open for Alice) — today is outside the future-start window
      const { status, body } = await bookSvcLong({ email, days: 4, hour: 9, promotion_id: IDS.PROMO_DATE });

      expect(status, `API error: ${JSON.stringify(body)}`).toBe(201);
      expect(body.promotion).toBeNull();
      expect(body.booking.promotion_discount_cents || 0).toBe(0);

      const dbRow = await pool.query(
        `SELECT promotion_id, promotion_discount_cents FROM bookings WHERE id = $1`,
        [body.booking.id]
      );
      expect(dbRow.rows[0].promotion_id).toBeNull();
      expect(dbRow.rows[0].promotion_discount_cents).toBe(0);
    } finally {
      await pool.query(
        `UPDATE promotions SET condition_start_date = $2, condition_end_date = $3 WHERE id = $1`,
        [IDS.PROMO_DATE, origStart, origEnd]
      );
    }
  });
});
