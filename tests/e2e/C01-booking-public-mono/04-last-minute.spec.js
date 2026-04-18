/**
 * C01 / spec 04 — Last-minute discount on public booking.
 *
 * Business TEST settings:
 *   last_minute_enabled=true, last_minute_deadline='h-24', last_minute_discount_pct=20.
 *
 * 2 tests :
 *   1. LM alone — SVC_LONG (9500c) within 24h window + is_last_minute=true
 *      → booking.discount_pct=20, booked_price_cents=9500*0.8=7600c
 *   2. LM combo promo — LM + PROMO_PCT (20%): LM applies first on 9500 → 7600,
 *      promo 20% on 7600 → 1520c off. booked_price_cents=7600 (LM only),
 *      promotion_discount_cents=1520.
 */
const { test, expect } = require('@playwright/test');
const IDS = require('../fixtures/ids');
const { publicFetch } = require('../fixtures/api-client');
const { resetMutables } = require('../fixtures/reset-mutables');
const { pool } = require('../../../src/services/db');

const SLUG = 'test-demo-salon';
const SVC_LONG_PRICE = 9500;

/** Book tomorrow at the given hour (Brussels TZ, LOCAL setHours relies on test host TZ = Europe/Brussels). */
function isoTomorrowAt(hourLocal) {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(hourLocal, 0, 0, 0);
  return d.toISOString();
}

test.describe('C01 — booking public mono: last-minute', () => {
  test.beforeEach(async () => { await resetMutables(); });

  test.beforeAll(async () => {
    // Ensure LM settings sont au format canonique last_minute_* (au cas où un seed ancien
    // aurait laissé les clés `lastminute_*`). La migration v71 s'occupe de la normalisation
    // en prod, ce hook garde le test robuste face à d'anciens seeds.
    await pool.query(
      `UPDATE businesses
       SET settings = settings ||
         jsonb_build_object(
           'last_minute_enabled',      true,
           'last_minute_discount_pct', 20,
           'last_minute_deadline',     'h-24'
         )
       WHERE id = $1`,
      [IDS.BUSINESS]
    );
  });

  test('1. LM alone — SVC_LONG within 24h → 20% discount, booked_price_cents=7600c', async () => {
    const email = `e2e-lm-alone-${Date.now()}@genda-test.be`;
    // Tomorrow 10h BXL — ~18h away, well within h-24 window.
    const startAt = isoTomorrowAt(10);

    const { status, body } = await publicFetch(`/api/public/${SLUG}/bookings`, {
      method: 'POST',
      body: {
        service_id: IDS.SVC_LONG,
        practitioner_id: IDS.PRAC_ALICE,
        start_at: startAt,
        appointment_mode: 'cabinet',
        client_name: 'E2E LM Alone',
        client_email: email,
        client_phone: `+3249100${String(Math.floor(Math.random()*9000)+1000)}`,
        consent_sms: true,
        consent_email: true,
        consent_marketing: false,
        is_last_minute: true,
      },
    });

    expect(status, `API error: ${JSON.stringify(body)}`).toBe(201);
    expect(body.booking.discount_pct).toBe(20);

    const dbRow = await pool.query(
      `SELECT discount_pct, booked_price_cents, promotion_id
       FROM bookings WHERE id = $1`,
      [body.booking.id]
    );
    expect(dbRow.rows[0].discount_pct).toBe(20);
    // 9500 * 0.80 = 7600
    expect(dbRow.rows[0].booked_price_cents).toBe(Math.round(SVC_LONG_PRICE * 0.8));
    expect(dbRow.rows[0].promotion_id).toBeNull();
  });

  test('2. LM + PROMO_PCT combo — LM on raw price, then promo on LM-reduced price', async () => {
    const email = `e2e-lm-promo-${Date.now()}@genda-test.be`;
    // Tomorrow 14h BXL — still within h-24 window, different slot from test 1.
    const startAt = isoTomorrowAt(14);

    const { status, body } = await publicFetch(`/api/public/${SLUG}/bookings`, {
      method: 'POST',
      body: {
        service_id: IDS.SVC_LONG,
        practitioner_id: IDS.PRAC_ALICE,
        start_at: startAt,
        appointment_mode: 'cabinet',
        client_name: 'E2E LM+Promo',
        client_email: email,
        client_phone: `+3249100${String(Math.floor(Math.random()*9000)+1000)}`,
        consent_sms: true,
        consent_email: true,
        consent_marketing: false,
        is_last_minute: true,
        promotion_id: IDS.PROMO_PCT, // 20% off
      },
    });

    expect(status, `API error: ${JSON.stringify(body)}`).toBe(201);
    expect(body.booking.discount_pct).toBe(20);
    expect(body.promotion).toBeTruthy();
    expect(body.promotion.discount_pct).toBe(20);

    // LM-adjusted price = 9500 * 0.8 = 7600; promo 20% of 7600 = 1520
    const lmPrice = Math.round(SVC_LONG_PRICE * 0.8);
    const promoDisc = Math.round(lmPrice * 20 / 100);

    const dbRow = await pool.query(
      `SELECT discount_pct, booked_price_cents, promotion_id, promotion_discount_cents
       FROM bookings WHERE id = $1`,
      [body.booking.id]
    );
    expect(dbRow.rows[0].discount_pct).toBe(20);
    expect(dbRow.rows[0].booked_price_cents).toBe(lmPrice);
    expect(dbRow.rows[0].promotion_id).toBe(IDS.PROMO_PCT);
    expect(dbRow.rows[0].promotion_discount_cents).toBe(promoDisc);
    expect(body.promotion.discount_cents).toBe(promoDisc);
  });
});
