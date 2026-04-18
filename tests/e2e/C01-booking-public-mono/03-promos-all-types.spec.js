/**
 * C01 / spec 03 — All 7 promo types on public booking.
 *
 * Tests :
 *   1. PROMO_PCT   (discount_pct 20%, cond=none)      on SVC_LONG (9500c) → 1900c off
 *   2. PROMO_FIXED (discount_fixed 1000c, min=5000c)  on SVC_LONG (9500c ≥ 5000c) → 1000c off
 *   3. PROMO_SVC   (discount_pct 30%, cond=SVC_LONG)  on SVC_LONG (9500c) → 2850c off
 *   4. PROMO_FIRST (discount_pct 15%, first_visit)    on SVC_LONG, NEW client → 1425c off
 *   5. PROMO_DATE  (discount_pct 10%, date_range)     on SVC_LONG, today ∈ range → 950c off
 *   6. PROMO_FREE  (free_service SVC_CHEAP if SVC_LONG in cart)  mono-service → expected
 *      INVALID (free reward needs added cart item). Documented as expected-invalid.
 *   7. PROMO_INFO  (info_only)                        on SVC_LONG → valid, 0c off
 *
 * Price source: booked_price_cents (LM not in play here). Discount vs
 * promotion_discount_cents on booking. Promo label echoed in response body.
 */
const { test, expect } = require('@playwright/test');
const IDS = require('../fixtures/ids');
const { publicFetch } = require('../fixtures/api-client');
const { pool } = require('../../../src/services/db');

const SLUG = 'test-demo-salon';
const SVC_LONG_PRICE = 9500;

function isoPlusDays(days, hour = 10) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  d.setHours(hour, 0, 0, 0);
  return d.toISOString();
}

async function bookSvcLong({ email, days, hour, promotion_id, phone, extra = {} }) {
  // Alice seed availability (DB weekday 2..6 = Wed..Sun in code convention) — only
  // pick days that land on Wed/Thu/Fri/Sat/Sun in Brussels TZ.
  const startAt = isoPlusDays(days, hour);
  return await publicFetch(`/api/public/${SLUG}/bookings`, {
    method: 'POST',
    body: {
      service_id: IDS.SVC_LONG,
      practitioner_id: IDS.PRAC_ALICE,
      start_at: startAt,
      appointment_mode: 'cabinet',
      client_name: 'E2E Promo Client',
      client_email: email,
      client_phone: phone || `+3249100${String(Math.floor(Math.random()*9000)+1000)}`,
      consent_sms: true,
      consent_email: true,
      consent_marketing: false,
      promotion_id,
      ...extra,
    },
  });
}

test.describe('C01 — booking public mono: promo types', () => {
  test('1. PROMO_PCT (20%, cond=none) → 1900c discount', async () => {
    const email = `e2e-promo-pct-${Date.now()}@genda-test.be`;
    const { status, body } = await bookSvcLong({ email, days: 7, hour: 9, promotion_id: IDS.PROMO_PCT });
    expect(status, `API error: ${JSON.stringify(body)}`).toBe(201);
    expect(body.promotion).toBeTruthy();
    expect(body.promotion.label).toBe('Promo 20%');
    expect(body.promotion.discount_pct).toBe(20);
    expect(body.promotion.discount_cents).toBe(Math.round(SVC_LONG_PRICE * 20 / 100));

    const dbRow = await pool.query(
      `SELECT promotion_id, promotion_label, promotion_discount_pct, promotion_discount_cents, booked_price_cents
       FROM bookings WHERE id = $1`,
      [body.booking.id]
    );
    expect(dbRow.rows[0].promotion_id).toBe(IDS.PROMO_PCT);
    expect(dbRow.rows[0].promotion_discount_cents).toBe(1900);
    expect(dbRow.rows[0].booked_price_cents).toBe(SVC_LONG_PRICE);
  });

  test('2. PROMO_FIXED (10€ fixed, min 50€) → 1000c discount', async () => {
    const email = `e2e-promo-fixed-${Date.now()}@genda-test.be`;
    const { status, body } = await bookSvcLong({ email, days: 7, hour: 12, promotion_id: IDS.PROMO_FIXED });
    expect(status, `API error: ${JSON.stringify(body)}`).toBe(201);
    expect(body.promotion).toBeTruthy();
    expect(body.promotion.label).toBe('Promo 10€');
    expect(body.promotion.discount_cents).toBe(1000);

    const dbRow = await pool.query(
      `SELECT promotion_id, promotion_discount_cents FROM bookings WHERE id = $1`,
      [body.booking.id]
    );
    expect(dbRow.rows[0].promotion_id).toBe(IDS.PROMO_FIXED);
    expect(dbRow.rows[0].promotion_discount_cents).toBe(1000);
  });

  test('3. PROMO_SVC (30% on SVC_LONG) → 2850c discount', async () => {
    const email = `e2e-promo-svc-${Date.now()}@genda-test.be`;
    const { status, body } = await bookSvcLong({ email, days: 7, hour: 15, promotion_id: IDS.PROMO_SVC });
    expect(status, `API error: ${JSON.stringify(body)}`).toBe(201);
    expect(body.promotion).toBeTruthy();
    expect(body.promotion.label).toBe('Coloration -30%');
    expect(body.promotion.discount_pct).toBe(30);
    expect(body.promotion.discount_cents).toBe(Math.round(SVC_LONG_PRICE * 30 / 100)); // 2850

    const dbRow = await pool.query(
      `SELECT promotion_id, promotion_discount_cents FROM bookings WHERE id = $1`,
      [body.booking.id]
    );
    expect(dbRow.rows[0].promotion_id).toBe(IDS.PROMO_SVC);
    expect(dbRow.rows[0].promotion_discount_cents).toBe(2850);
  });

  test('4. PROMO_FIRST (15%, first_visit, NEW client) → 1425c discount', async () => {
    const email = `e2e-promo-first-${Date.now()}@genda-test.be`;
    const { status, body } = await bookSvcLong({ email, days: 11, hour: 9, promotion_id: IDS.PROMO_FIRST });
    expect(status, `API error: ${JSON.stringify(body)}`).toBe(201);
    expect(body.promotion).toBeTruthy();
    expect(body.promotion.label).toBe('Bienvenue -15%');
    expect(body.promotion.discount_cents).toBe(Math.round(SVC_LONG_PRICE * 15 / 100)); // 1425

    const dbRow = await pool.query(
      `SELECT promotion_id, promotion_discount_cents FROM bookings WHERE id = $1`,
      [body.booking.id]
    );
    expect(dbRow.rows[0].promotion_id).toBe(IDS.PROMO_FIRST);
    expect(dbRow.rows[0].promotion_discount_cents).toBe(1425);
  });

  test('5. PROMO_DATE (10%, date_range includes today) → 950c discount', async () => {
    // PROMO_DATE: start=2026-04-18, end=2026-05-18 (seed). Today (2026-04-18+) is in range.
    const promo = await pool.query(
      `SELECT condition_start_date, condition_end_date, is_active
       FROM promotions WHERE id = $1`,
      [IDS.PROMO_DATE]
    );
    const todayBrx = new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Brussels' });
    const toYmd = v => v instanceof Date
      ? v.toLocaleDateString('en-CA', { timeZone: 'Europe/Brussels' })
      : String(v).slice(0, 10);
    const startStr = toYmd(promo.rows[0].condition_start_date);
    const endStr = toYmd(promo.rows[0].condition_end_date);
    // Sanity — promo must be active on today. Otherwise the backend correctly rejects, and the test SHOULD fail.
    expect(todayBrx >= startStr && todayBrx <= endStr, `Today ${todayBrx} not in PROMO_DATE range ${startStr}..${endStr}`).toBe(true);

    const email = `e2e-promo-date-${Date.now()}@genda-test.be`;
    const { status, body } = await bookSvcLong({ email, days: 11, hour: 12, promotion_id: IDS.PROMO_DATE });
    expect(status, `API error: ${JSON.stringify(body)}`).toBe(201);
    expect(body.promotion).toBeTruthy();
    expect(body.promotion.label).toBe('Printemps -10%');
    expect(body.promotion.discount_cents).toBe(Math.round(SVC_LONG_PRICE * 10 / 100)); // 950

    const dbRow = await pool.query(
      `SELECT promotion_discount_cents FROM bookings WHERE id = $1`,
      [body.booking.id]
    );
    expect(dbRow.rows[0].promotion_discount_cents).toBe(950);
  });

  test('6. PROMO_FREE (free SVC_CHEAP if SVC_LONG in cart) mono-service → promo invalid', async () => {
    // Reward = free_service SVC_CHEAP. Rule (helpers.js:274): reward_service_id must be present
    // in the cart. In mono-service flow, cart = [SVC_LONG] only → reward not in cart → invalid.
    // API still returns 201 (booking proceeds without promo), but body.promotion = null.
    const email = `e2e-promo-free-${Date.now()}@genda-test.be`;
    const { status, body } = await bookSvcLong({ email, days: 11, hour: 15, promotion_id: IDS.PROMO_FREE });
    expect(status, `API error: ${JSON.stringify(body)}`).toBe(201);
    // Booking succeeds but no promo applied (free_service reward invalid in mono flow)
    expect(body.promotion).toBeNull();
    expect(body.booking.promotion_discount_cents).toBe(0);

    const dbRow = await pool.query(
      `SELECT promotion_id, promotion_discount_cents FROM bookings WHERE id = $1`,
      [body.booking.id]
    );
    expect(dbRow.rows[0].promotion_id).toBeNull();
    expect(dbRow.rows[0].promotion_discount_cents).toBe(0);
  });

  test('7. PROMO_INFO (info_only) → valid, 0c discount', async () => {
    const email = `e2e-promo-info-${Date.now()}@genda-test.be`;
    const { status, body } = await bookSvcLong({ email, days: 12, hour: 9, promotion_id: IDS.PROMO_INFO });
    expect(status, `API error: ${JSON.stringify(body)}`).toBe(201);
    expect(body.promotion).toBeTruthy();
    expect(body.promotion.label).toBe('Nouveauté');
    expect(body.promotion.discount_cents).toBe(0);

    const dbRow = await pool.query(
      `SELECT promotion_id, promotion_discount_cents, promotion_label FROM bookings WHERE id = $1`,
      [body.booking.id]
    );
    expect(dbRow.rows[0].promotion_id).toBe(IDS.PROMO_INFO);
    expect(dbRow.rows[0].promotion_label).toBe('Nouveauté');
    expect(dbRow.rows[0].promotion_discount_cents).toBe(0);
  });
});
