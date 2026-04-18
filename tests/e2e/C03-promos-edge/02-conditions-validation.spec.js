/**
 * C03 / spec 02 — Promo conditions validation edge cases.
 *
 * Covers conditions that validateAndCalcPromo (src/routes/public/helpers.js:164)
 * must reject :
 *   1. first_visit rejected when client already has active (non-cancelled) bookings.
 *   2. first_visit ACCEPTED when the existing client only has cancelled bookings
 *      (per helpers.js:210 — COUNT excludes status='cancelled').
 *   3. promo rejected when the single-service cart contains a service with
 *      promo_eligible=false (condition_type=none → falls to generic eligibility check).
 *   4. Same eligibility check via specific_service promo whose target service is
 *      promo_eligible=false (SVC_CHEAP) → rejected.
 *
 * SVC_LONG (9500c, promo_eligible=true) is used as the "target" service where
 * eligibility MUST allow the promo; SVC_CHEAP (1000c, promo_eligible=false) is
 * the "blocker" service.
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

async function bookPublic({ service_id, days, hour, promotion_id, email, phone }) {
  return await publicFetch(`/api/public/${SLUG}/bookings`, {
    method: 'POST',
    body: {
      service_id,
      practitioner_id: IDS.PRAC_ALICE,
      start_at: isoPlusDays(days, hour),
      appointment_mode: 'cabinet',
      client_name: 'E2E C03 Conditions',
      client_email: email,
      client_phone: phone || `+3249100${String(Math.floor(Math.random() * 9000) + 1000)}`,
      consent_sms: true,
      consent_email: true,
      consent_marketing: false,
      promotion_id,
    },
  });
}

test.describe('C03 — promos edge: conditions validation', () => {
  let sinceTs;
  test.beforeEach(async () => {
    sinceTs = new Date(Date.now() - 1000).toISOString();
    await resetMutables();
  });

  test('1. first_visit sur client existant avec bookings actifs → promo rejetée', async () => {
    // Marie has BK_COMPLETED_1, BK_COMPLETED_2 (completed) + BK_CANCELLED_1.
    // first_visit check counts non-cancelled bookings → cnt=2 > 0 → reject.
    const email = 'marie-test@genda-test.be';
    const { status, body } = await bookPublic({
      service_id: IDS.SVC_LONG,
      days: 7, hour: 9,
      promotion_id: IDS.PROMO_FIRST,
      email,
      phone: '+32491000002', // Marie's phone
    });

    expect(status, `API error: ${JSON.stringify(body)}`).toBe(201);
    expect(body.promotion).toBeNull();
    expect(body.booking.promotion_discount_cents || 0).toBe(0);

    const dbRow = await pool.query(
      `SELECT promotion_id, promotion_discount_cents, client_id FROM bookings WHERE id = $1`,
      [body.booking.id]
    );
    expect(dbRow.rows[0].promotion_id).toBeNull();
    expect(dbRow.rows[0].promotion_discount_cents).toBe(0);
    // Booking was linked to Marie's existing client id
    expect(dbRow.rows[0].client_id).toBe(IDS.CLIENT_MARIE);
  });

  test('2. first_visit sur client avec bookings cancelled uniquement → promo appliquée', async () => {
    // Temporarily cancel Marie's 2 completed bookings so her non-cancelled count = 0.
    // The first_visit check (helpers.js:210) then passes → promo applies.
    await pool.query(
      `UPDATE bookings SET status = 'cancelled' WHERE client_id = $1 AND status != 'cancelled'`,
      [IDS.CLIENT_MARIE]
    );
    try {
      const { status, body } = await bookPublic({
        service_id: IDS.SVC_LONG,
        days: 7, hour: 12,
        promotion_id: IDS.PROMO_FIRST,
        email: 'marie-test@genda-test.be',
        phone: '+32491000002',
      });

      expect(status, `API error: ${JSON.stringify(body)}`).toBe(201);
      expect(body.promotion).toBeTruthy();
      expect(body.promotion.label).toBe('Bienvenue -15%');
      expect(body.promotion.discount_cents).toBe(Math.round(9500 * 15 / 100)); // 1425

      const dbRow = await pool.query(
        `SELECT promotion_id, promotion_discount_cents, client_id FROM bookings WHERE id = $1`,
        [body.booking.id]
      );
      expect(dbRow.rows[0].promotion_id).toBe(IDS.PROMO_FIRST);
      expect(dbRow.rows[0].promotion_discount_cents).toBe(1425);
      expect(dbRow.rows[0].client_id).toBe(IDS.CLIENT_MARIE);
    } finally {
      // Restore Marie's completed bookings (BK_COMPLETED_1 + BK_COMPLETED_2 are the original 'completed').
      // Reseed by re-running the historique seed minimally: just restore the 3 status values we touched.
      await pool.query(
        `UPDATE bookings SET status = 'completed' WHERE id IN ($1, $2)`,
        [IDS.BK_COMPLETED_1, IDS.BK_COMPLETED_2]
      );
      // BK_CANCELLED_1 stays cancelled (already was); no-op is fine.
    }
  });

  test('3. promo (condition=none) sur service promo_eligible=false → rejetée', async () => {
    // SVC_CHEAP has promo_eligible=false (seed). PROMO_PCT condition_type=none.
    // helpers.js:192-195 — since condition_type != specific_service and reward_type != info_only,
    // at least one service in cart must be promo_eligible. Cart = [SVC_CHEAP] only → reject.
    const email = `e2e-c03-ineligible-${Date.now()}@genda-test.be`;
    const { status, body } = await bookPublic({
      service_id: IDS.SVC_CHEAP,
      days: 7, hour: 15,
      promotion_id: IDS.PROMO_PCT,
      email,
    });

    expect(status, `API error: ${JSON.stringify(body)}`).toBe(201);
    expect(body.promotion).toBeNull();
    expect(body.booking.promotion_discount_cents || 0).toBe(0);

    const dbRow = await pool.query(
      `SELECT promotion_id, promotion_discount_cents FROM bookings WHERE id = $1`,
      [body.booking.id]
    );
    expect(dbRow.rows[0].promotion_id).toBeNull();
    expect(dbRow.rows[0].promotion_discount_cents).toBe(0);
  });

  test('4. specific_service promo ciblant un service promo_eligible=false → rejetée', async () => {
    // Temporarily point PROMO_SVC condition at SVC_CHEAP (promo_eligible=false).
    // helpers.js:190-191 — specific_service promos reject when promoEligibleMap[condition_service_id]===false.
    const snap = await pool.query(
      `SELECT condition_service_id FROM promotions WHERE id = $1`,
      [IDS.PROMO_SVC]
    );
    const orig = snap.rows[0].condition_service_id;
    await pool.query(
      `UPDATE promotions SET condition_service_id = $2 WHERE id = $1`,
      [IDS.PROMO_SVC, IDS.SVC_CHEAP]
    );
    try {
      const email = `e2e-c03-specsvc-inel-${Date.now()}@genda-test.be`;
      const { status, body } = await bookPublic({
        service_id: IDS.SVC_CHEAP,
        days: 7, hour: 9,
        promotion_id: IDS.PROMO_SVC,
        email,
      });

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
        `UPDATE promotions SET condition_service_id = $2 WHERE id = $1`,
        [IDS.PROMO_SVC, orig]
      );
    }
  });
});
