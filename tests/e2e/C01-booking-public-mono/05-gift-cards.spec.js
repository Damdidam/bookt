/**
 * C01 / spec 05 — Gift cards on public booking.
 *
 * Seed codes (verified via SELECT code FROM gift_cards):
 *   TESTGC01ACTV — active, balance 10000c (100€), expires +1y
 *   TESTGC02PART — active, balance 5000c (50€),  expires +1y
 *   TESTGC03EXPD — expired, balance 10000c
 *   TESTGC04CNCL — cancelled, balance 5000c
 *
 * GC auto-debit flow (src/routes/public/index.js:1341): runs ONLY when
 * deposit is required. On the TEST business (Stripe Connect active,
 * deposit_percent=50, price_threshold=5000c, duration_threshold=60min):
 *   - SVC_LONG      (9500c, 120min)  → deposit 4750c
 *   - SVC_EXPENSIVE (20000c, 60min)  → deposit 10000c
 *
 * 4 tests :
 *   1. GC partial  — GC_PARTIAL (5000c) on SVC_EXPENSIVE (dep 10000c)  → 5000c GC debit,
 *      5000c remaining via Stripe (booking stays pending_deposit).
 *   2. GC full     — GC_ACTIVE  (10000c) on SVC_LONG (dep 4750c)       → GC covers fully,
 *      booking becomes confirmed (deposit_status=paid).
 *   3. GC expired  — TESTGC03EXPD ignored → booking proceeds to pending_deposit
 *      (API does NOT 400 — invalid GC is silently ignored; documented behavior).
 *   4. GC cancelled— TESTGC04CNCL ignored → booking proceeds to pending_deposit.
 */
const { test, expect } = require('@playwright/test');
const IDS = require('../fixtures/ids');
const { publicFetch } = require('../fixtures/api-client');
const { resetMutables } = require('../fixtures/reset-mutables');
const { pool } = require('../../../src/services/db');

const SLUG = 'test-demo-salon';
const CODE_ACTIVE = 'TESTGC01ACTV';
const CODE_PARTIAL = 'TESTGC02PART';
const CODE_EXPIRED = 'TESTGC03EXPD';
const CODE_CANCELLED = 'TESTGC04CNCL';

function isoPlusDays(days, hour = 10) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  d.setHours(hour, 0, 0, 0);
  return d.toISOString();
}

async function postBooking({ serviceId, startAt, gcCode, email }) {
  return await publicFetch(`/api/public/${SLUG}/bookings`, {
    method: 'POST',
    body: {
      service_id: serviceId,
      practitioner_id: IDS.PRAC_ALICE,
      start_at: startAt,
      appointment_mode: 'cabinet',
      client_name: 'E2E GC Client',
      client_email: email,
      client_phone: `+3249100${String(Math.floor(Math.random()*9000)+1000)}`,
      consent_sms: true,
      consent_email: true,
      consent_marketing: false,
      gift_card_code: gcCode,
    },
  });
}

test.describe('C01 — booking public mono: gift cards', () => {
  test.beforeEach(async () => { await resetMutables(); });

  test.beforeAll(async () => {
    // Reset partial balance (previous runs may have debited it)
    await pool.query(
      `UPDATE gift_cards SET balance_cents = 5000, status = 'active' WHERE code = $1 AND business_id = $2`,
      [CODE_PARTIAL, IDS.BUSINESS]
    );
    await pool.query(
      `UPDATE gift_cards SET balance_cents = 10000, status = 'active' WHERE code = $1 AND business_id = $2`,
      [CODE_ACTIVE, IDS.BUSINESS]
    );
  });

  test('1. GC partial — 50€ GC on SVC_EXPENSIVE (dep 100€) → 50€ debited, remainder via Stripe', async () => {
    const email = `e2e-gc-partial-${Date.now()}@genda-test.be`;
    const startAt = isoPlusDays(7, 10); // Sat — Alice open
    const { status, body } = await postBooking({
      serviceId: IDS.SVC_EXPENSIVE,
      startAt,
      gcCode: CODE_PARTIAL,
      email,
    });
    expect(status, `API error: ${JSON.stringify(body)}`).toBe(201);

    const bkRow = await pool.query(
      `SELECT status, deposit_amount_cents, deposit_status FROM bookings WHERE id = $1`,
      [body.booking.id]
    );
    expect(bkRow.rows[0].deposit_amount_cents).toBe(10000);
    // Partial: 5000 GC < 10000 deposit → booking still pending_deposit for remaining via Stripe
    expect(bkRow.rows[0].status).toBe('pending_deposit');
    expect(bkRow.rows[0].deposit_status).toBe('pending');

    // Verify GC balance was debited by 5000c (exhausted)
    const gcRow = await pool.query(
      `SELECT balance_cents, status FROM gift_cards WHERE code = $1 AND business_id = $2`,
      [CODE_PARTIAL, IDS.BUSINESS]
    );
    expect(gcRow.rows[0].balance_cents).toBe(0);
    expect(gcRow.rows[0].status).toBe('used');

    // Verify gift_card_transactions row
    const txRow = await pool.query(
      `SELECT amount_cents, type FROM gift_card_transactions WHERE booking_id = $1`,
      [body.booking.id]
    );
    expect(txRow.rows.length).toBe(1);
    expect(txRow.rows[0].amount_cents).toBe(5000);
    expect(txRow.rows[0].type).toBe('debit');
  });

  test('2. GC full coverage — 100€ GC on SVC_LONG (dep 47.50€) → deposit paid, booking confirmed', async () => {
    const email = `e2e-gc-full-${Date.now()}@genda-test.be`;
    const startAt = isoPlusDays(7, 13); // Sat — Alice open, different hour
    const { status, body } = await postBooking({
      serviceId: IDS.SVC_LONG,
      startAt,
      gcCode: CODE_ACTIVE,
      email,
    });
    expect(status, `API error: ${JSON.stringify(body)}`).toBe(201);

    const bkRow = await pool.query(
      `SELECT status, deposit_amount_cents, deposit_status, deposit_payment_intent_id
       FROM bookings WHERE id = $1`,
      [body.booking.id]
    );
    expect(bkRow.rows[0].deposit_amount_cents).toBe(4750);
    expect(bkRow.rows[0].deposit_status).toBe('paid');
    // GC fully covers deposit → booking stays 'confirmed' (not flipped to pending_deposit)
    expect(bkRow.rows[0].status).toBe('confirmed');
    expect(bkRow.rows[0].deposit_payment_intent_id).toBe(`gc_${CODE_ACTIVE}`);

    const gcRow = await pool.query(
      `SELECT balance_cents FROM gift_cards WHERE code = $1 AND business_id = $2`,
      [CODE_ACTIVE, IDS.BUSINESS]
    );
    expect(gcRow.rows[0].balance_cents).toBe(10000 - 4750);
  });

  test('3. GC expired — TESTGC03EXPD rejected with 400 "Carte cadeau expirée"', async () => {
    const email = `e2e-gc-expired-${Date.now()}@genda-test.be`;
    const startAt = isoPlusDays(11, 10);
    const { status, body } = await postBooking({
      serviceId: IDS.SVC_LONG,
      startAt,
      gcCode: CODE_EXPIRED,
      email,
    });
    // Fix: API REJECTS invalid GC codes with 400 (was silently ignored before)
    expect(status).toBe(400);
    expect(body.error).toMatch(/expir|inutilisable/i);
  });

  test('4. GC cancelled — TESTGC04CNCL rejected with 400 "Carte cadeau annulée"', async () => {
    const email = `e2e-gc-cancelled-${Date.now()}@genda-test.be`;
    const startAt = isoPlusDays(11, 13);
    const { status, body } = await postBooking({
      serviceId: IDS.SVC_LONG,
      startAt,
      gcCode: CODE_CANCELLED,
      email,
    });
    // Fix: API REJECTS cancelled GC with 400
    expect(status).toBe(400);
    expect(body.error).toMatch(/annul|inutilisable/i);
  });
});
