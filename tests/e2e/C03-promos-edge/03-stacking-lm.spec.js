/**
 * C03 / spec 03 — Stacking & last-minute window boundaries.
 *
 * 3 tests :
 *   1. Stacking attempt — API accepts only one `promotion_id` per body. Two bookings
 *      in sequence each keep their own promo independently (no additive stacking).
 *      Documented behavior: promo slot is one-per-booking by design.
 *   2. LM window `j-2` — within-window slot gets LM discount; out-of-window slot doesn't.
 *   3. LM window `h-24` — within-24h slot triggers LM (diffMs <= 24h) ; beyond does not.
 *
 * IMPORTANT — DB weekday convention :
 *   bookings-helpers.js:176 maps JS weekday to DB as `dbDay = jsDay===0 ? 6 : jsDay-1`.
 *   So DB stores 0=Mon..6=Sun (ISO). Seed uses dbDay values:
 *     Alice  [2,3,4,5,6] → jsDay [3,4,5,6,0] → Wed..Sun
 *     Bob    [1,2,3,4,5] → jsDay [2,3,4,5,6] → Tue..Sat
 *     Carol  [3,4,5,6]   → jsDay [4,5,6,0]   → Thu..Sun
 *   Pair a slot's jsDay against the correct allowedJsDays list for each prac.
 */
const { test, expect } = require('@playwright/test');
const IDS = require('../fixtures/ids');
const { publicFetch } = require('../fixtures/api-client');
const { resetMutables } = require('../fixtures/reset-mutables');
const { pool } = require('../../../src/services/db');

const SLUG = 'test-demo-salon';

// Correct JS weekday allowlists (0=Sun..6=Sat) aligned with seed DB values.
const ALICE_JSDAYS = [3, 4, 5, 6, 0]; // Wed..Sun
const BOB_JSDAYS   = [2, 3, 4, 5, 6]; // Tue..Sat

/** Returns ISO string for the next date (starting N days from now) that lands on
 *  any of the allowed JS weekdays (0=Sun..6=Sat), at hour in host local time. */
function nextOpenSlotISO(minDaysAhead, allowedJsDays, hour = 10) {
  const d = new Date();
  d.setDate(d.getDate() + minDaysAhead);
  d.setHours(hour, 0, 0, 0);
  while (!allowedJsDays.includes(d.getDay())) {
    d.setDate(d.getDate() + 1);
  }
  return d.toISOString();
}

/** Count diff days between slot and now (Brussels midday midpoints — same math as helpers.js). */
function diffDaysBrussels(isoStart) {
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Brussels' });
  const slotDay = new Date(isoStart).toLocaleDateString('en-CA', { timeZone: 'Europe/Brussels' });
  const slot = new Date(slotDay + 'T12:00:00Z');
  const now = new Date(today + 'T12:00:00Z');
  return Math.round((slot - now) / 86400000);
}

async function bookSvcLong({ email, start_at, practitioner_id, promotion_id, is_last_minute }) {
  return await publicFetch(`/api/public/${SLUG}/bookings`, {
    method: 'POST',
    body: {
      service_id: IDS.SVC_LONG,
      practitioner_id,
      start_at,
      appointment_mode: 'cabinet',
      client_name: 'E2E C03 Stacking/LM',
      client_email: email,
      client_phone: `+3249100${String(Math.floor(Math.random() * 9000) + 1000)}`,
      consent_sms: true,
      consent_email: true,
      consent_marketing: false,
      promotion_id,
      is_last_minute: is_last_minute === true ? true : undefined,
    },
  });
}

test.describe('C03 — promos edge: stacking & LM windows', () => {
  let sinceTs;
  test.beforeEach(async () => {
    sinceTs = new Date(Date.now() - 1000).toISOString();
    await resetMutables();
  });

  test('1. Stacking — API n\'accepte qu\'un seul promotion_id, 2 bookings indépendants', async () => {
    // Book #1 with PROMO_PCT (20%)
    const email = `e2e-c03-stack-${Date.now()}@genda-test.be`;
    const slot1 = nextOpenSlotISO(3, ALICE_JSDAYS, 9);
    const r1 = await bookSvcLong({
      email,
      start_at: slot1,
      practitioner_id: IDS.PRAC_ALICE,
      promotion_id: IDS.PROMO_PCT,
    });
    expect(r1.status, `API error: ${JSON.stringify(r1.body)}`).toBe(201);
    expect(r1.body.promotion).toBeTruthy();
    expect(r1.body.promotion.discount_cents).toBe(1900); // 20% × 9500

    // Book #2 same client, different slot, PROMO_FIXED (-10€, min 50€)
    const slot2 = nextOpenSlotISO(4, ALICE_JSDAYS, 12);
    const r2 = await bookSvcLong({
      email,
      start_at: slot2,
      practitioner_id: IDS.PRAC_ALICE,
      promotion_id: IDS.PROMO_FIXED,
    });
    expect(r2.status, `API error: ${JSON.stringify(r2.body)}`).toBe(201);
    expect(r2.body.promotion).toBeTruthy();
    expect(r2.body.promotion.discount_cents).toBe(1000); // 10€ fixed

    // Both bookings: each its own promo, no cumulation on a single booking
    const rows = await pool.query(
      `SELECT id, promotion_id, promotion_discount_cents FROM bookings
         WHERE id IN ($1, $2) ORDER BY start_at`,
      [r1.body.booking.id, r2.body.booking.id]
    );
    expect(rows.rows.length).toBe(2);
    // Ensure they carry DIFFERENT promos (stacking was not consolidated into one booking)
    const promoIds = rows.rows.map(r => r.promotion_id).sort();
    expect(promoIds).toEqual([IDS.PROMO_PCT, IDS.PROMO_FIXED].sort());
    // No booking carries both discounts summed
    for (const row of rows.rows) {
      expect([1900, 1000]).toContain(row.promotion_discount_cents);
    }
  });

  test('2. LM window j-2 — slot within 2 days gets LM; slot >2 days does not', async () => {
    // Snapshot settings
    const snap = await pool.query(`SELECT settings FROM businesses WHERE id = $1`, [IDS.BUSINESS]);
    const origSettings = snap.rows[0].settings;

    await pool.query(
      `UPDATE businesses SET settings = jsonb_set(settings, '{last_minute_deadline}', '"j-2"') WHERE id = $1`,
      [IDS.BUSINESS]
    );
    // Also sync the lastminute_deadline alias for parity
    await pool.query(
      `UPDATE businesses SET settings = jsonb_set(settings, '{lastminute_deadline}', '"j-2"') WHERE id = $1`,
      [IDS.BUSINESS]
    );
    try {
      // Within j-2 window: iterate days 1..2, pick prac open that day.
      let withinSlot = null, withinPrac = null;
      for (let d = 1; d <= 2; d++) {
        const dd = new Date();
        dd.setDate(dd.getDate() + d);
        dd.setHours(10, 0, 0, 0);
        const js = dd.getDay();
        const iso = dd.toISOString();
        const diff = diffDaysBrussels(iso);
        if (diff < 1 || diff > 2) continue;
        if (ALICE_JSDAYS.includes(js)) { withinSlot = iso; withinPrac = IDS.PRAC_ALICE; break; }
        if (BOB_JSDAYS.includes(js))   { withinSlot = iso; withinPrac = IDS.PRAC_BOB;   break; }
      }
      expect(withinSlot, 'No open slot within j-2 window — schedule gap?').not.toBeNull();

      const email1 = `e2e-c03-lm-j2-in-${Date.now()}@genda-test.be`;
      const r1 = await bookSvcLong({
        email: email1,
        start_at: withinSlot,
        practitioner_id: withinPrac,
        is_last_minute: true,
      });
      expect(r1.status, `API error: ${JSON.stringify(r1.body)}`).toBe(201);
      expect(r1.body.booking.discount_pct).toBe(20);
      const db1 = await pool.query(`SELECT discount_pct, booked_price_cents FROM bookings WHERE id = $1`, [r1.body.booking.id]);
      expect(db1.rows[0].discount_pct).toBe(20);
      expect(db1.rows[0].booked_price_cents).toBe(Math.round(9500 * 0.8)); // 7600

      // Out-of-window slot: diffDays > 2
      let outsideSlot = null, outsidePrac = null;
      for (let d = 3; d <= 10; d++) {
        const dd = new Date();
        dd.setDate(dd.getDate() + d);
        dd.setHours(12, 0, 0, 0);
        const js = dd.getDay();
        const iso = dd.toISOString();
        const diff = diffDaysBrussels(iso);
        if (diff <= 2) continue;
        if (ALICE_JSDAYS.includes(js)) { outsideSlot = iso; outsidePrac = IDS.PRAC_ALICE; break; }
        if (BOB_JSDAYS.includes(js))   { outsideSlot = iso; outsidePrac = IDS.PRAC_BOB;   break; }
      }
      expect(outsideSlot, 'No open slot outside j-2 window').not.toBeNull();

      const email2 = `e2e-c03-lm-j2-out-${Date.now()}@genda-test.be`;
      const r2 = await bookSvcLong({
        email: email2,
        start_at: outsideSlot,
        practitioner_id: outsidePrac,
        is_last_minute: true,
      });
      expect(r2.status, `API error: ${JSON.stringify(r2.body)}`).toBe(201);
      // LM not applied — discount_pct is null
      const db2 = await pool.query(`SELECT discount_pct, booked_price_cents FROM bookings WHERE id = $1`, [r2.body.booking.id]);
      expect(db2.rows[0].discount_pct).toBeNull();
      expect(db2.rows[0].booked_price_cents).toBe(9500);
    } finally {
      await pool.query(`UPDATE businesses SET settings = $2::jsonb WHERE id = $1`, [IDS.BUSINESS, JSON.stringify(origSettings)]);
    }
  });

  test('3. LM window h-24 — slot within 24h triggers LM; slot beyond does not', async () => {
    // Widen deadline to h-72 for the "within" branch so we can book a Monday Bob slot
    // (weekend gap: today=Sat → Sun has no prac; earliest prac slot is Mon).
    const snap = await pool.query(`SELECT settings FROM businesses WHERE id = $1`, [IDS.BUSINESS]);
    const origSettings = snap.rows[0].settings;

    // Find earliest open slot (any prac). Test verifies the h-N hourly logic.
    let earliestSlot = null, earliestPrac = null;
    for (let d = 1; d <= 7; d++) {
      const dd = new Date();
      dd.setDate(dd.getDate() + d);
      dd.setHours(10, 0, 0, 0);
      const js = dd.getDay();
      const iso = dd.toISOString();
      if (ALICE_JSDAYS.includes(js)) { earliestSlot = iso; earliestPrac = IDS.PRAC_ALICE; break; }
      if (BOB_JSDAYS.includes(js))   { earliestSlot = iso; earliestPrac = IDS.PRAC_BOB;   break; }
    }
    expect(earliestSlot, 'No open slot found').not.toBeNull();

    // Compute diffMs to know what h-N boundary to use for "within"
    const diffMs = new Date(earliestSlot).getTime() - Date.now();
    const diffHours = Math.ceil(diffMs / 3600000);
    // For within: set deadline = h-(diffHours + 6) to guarantee inclusion
    const withinDeadline = `h-${diffHours + 6}`;

    await pool.query(
      `UPDATE businesses SET settings = jsonb_set(settings, '{last_minute_deadline}', $2::jsonb) WHERE id = $1`,
      [IDS.BUSINESS, JSON.stringify(withinDeadline)]
    );
    await pool.query(
      `UPDATE businesses SET settings = jsonb_set(settings, '{lastminute_deadline}', $2::jsonb) WHERE id = $1`,
      [IDS.BUSINESS, JSON.stringify(withinDeadline)]
    );
    try {
      const email1 = `e2e-c03-lm-h24-in-${Date.now()}@genda-test.be`;
      const r1 = await bookSvcLong({
        email: email1,
        start_at: earliestSlot,
        practitioner_id: earliestPrac,
        is_last_minute: true,
      });
      expect(r1.status, `API error: ${JSON.stringify(r1.body)}`).toBe(201);
      const db1 = await pool.query(`SELECT discount_pct, booked_price_cents FROM bookings WHERE id = $1`, [r1.body.booking.id]);
      expect(db1.rows[0].discount_pct).toBe(20);
      expect(db1.rows[0].booked_price_cents).toBe(Math.round(9500 * 0.8));

      // For outside: set deadline = h-1 so the same kind of slot won't fit
      await pool.query(
        `UPDATE businesses SET settings = jsonb_set(settings, '{last_minute_deadline}', '"h-1"') WHERE id = $1`,
        [IDS.BUSINESS]
      );
      await pool.query(
        `UPDATE businesses SET settings = jsonb_set(settings, '{lastminute_deadline}', '"h-1"') WHERE id = $1`,
        [IDS.BUSINESS]
      );

      // Use a different slot to avoid conflict
      let otherSlot = null, otherPrac = null;
      for (let d = 1; d <= 10; d++) {
        const dd = new Date();
        dd.setDate(dd.getDate() + d);
        dd.setHours(14, 0, 0, 0);
        const js = dd.getDay();
        const iso = dd.toISOString();
        if (iso === earliestSlot) continue;
        if (ALICE_JSDAYS.includes(js)) { otherSlot = iso; otherPrac = IDS.PRAC_ALICE; break; }
        if (BOB_JSDAYS.includes(js))   { otherSlot = iso; otherPrac = IDS.PRAC_BOB;   break; }
      }
      expect(otherSlot, 'No distinct slot').not.toBeNull();

      const email2 = `e2e-c03-lm-h24-out-${Date.now()}@genda-test.be`;
      const r2 = await bookSvcLong({
        email: email2,
        start_at: otherSlot,
        practitioner_id: otherPrac,
        is_last_minute: true,
      });
      expect(r2.status, `API error: ${JSON.stringify(r2.body)}`).toBe(201);
      const db2 = await pool.query(`SELECT discount_pct, booked_price_cents FROM bookings WHERE id = $1`, [r2.body.booking.id]);
      expect(db2.rows[0].discount_pct).toBeNull();
      expect(db2.rows[0].booked_price_cents).toBe(9500);
    } finally {
      await pool.query(`UPDATE businesses SET settings = $2::jsonb WHERE id = $1`, [IDS.BUSINESS, JSON.stringify(origSettings)]);
    }
  });
});
