/**
 * C01 / spec 06 — Passes (multi-session packs) on public booking.
 *
 * Seed codes (verified):
 *   TESTPASS01AC — active, 5 sessions remaining (out of 10), SVC_PASS, expires +90d
 *   TESTPASS02EX — active but expires_at in the past → query excludes → silently ignored
 *   TESTPASS03EM — status='used', sessions_remaining=0 → query excludes → silently ignored
 *
 * Pass auto-debit (src/routes/public/index.js:1270) runs regardless of deposit.
 * When matched to booking service, it decrements sessions_remaining by 1 and
 * inserts a pass_transactions row of type='debit' (-1 session).
 *
 * Deposit interaction: when a pass covers the service, the pre-match path
 * (index.js:1257-1266) zeros the deposit base — `depResult.required` flips
 * to false, `deposit_amount_cents` stays NULL. The booking remains 'confirmed'
 * with no `deposit_payment_intent_id = 'pass_<CODE>'` marker. (That marker is
 * only set in the alternative branch where depResult had already cleared a
 * non-zero residual deposit — which doesn't apply when the pass covers 100%
 * of the eligible price.)
 *
 * SVC_PASS (5000c, 45min) hits price threshold (5000c) — but pass coverage
 * waives the deposit entirely.
 *
 * 4 tests :
 *   1. PASS_ACTIVE on SVC_PASS → pass_transactions debited, sessions decrements,
 *      booking=confirmed, deposit covered by pass.
 *   2. PASS_EXPIRED ignored → no debit, booking goes to pending_deposit.
 *   3. PASS_EMPTY (0 sessions, used) ignored → no debit, pending_deposit.
 *   4. Pass + promo — pass covers the session; promo applies on a zero-price slot
 *      → validateAndCalcPromo returns valid=false (discount_cents <= 0), no promo
 *      applied on the booking. Pass debited normally.
 */
const { test, expect } = require('@playwright/test');
const IDS = require('../fixtures/ids');
const { publicFetch } = require('../fixtures/api-client');
const { pool } = require('../../../src/services/db');

const SLUG = 'test-demo-salon';
const PASS_ACTIVE = 'TESTPASS01AC';
const PASS_EXPIRED = 'TESTPASS02EX';
const PASS_EMPTY = 'TESTPASS03EM';

function isoPlusDays(days, hour = 10) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  d.setHours(hour, 0, 0, 0);
  return d.toISOString();
}

async function postBooking({ startAt, passCode, promoId, email }) {
  return await publicFetch(`/api/public/${SLUG}/bookings`, {
    method: 'POST',
    body: {
      service_id: IDS.SVC_PASS,
      practitioner_id: IDS.PRAC_ALICE,
      start_at: startAt,
      appointment_mode: 'cabinet',
      client_name: 'E2E Pass Client',
      client_email: email,
      client_phone: `+3249100${String(Math.floor(Math.random()*9000)+1000)}`,
      consent_sms: true,
      consent_email: true,
      consent_marketing: false,
      pass_code: passCode,
      promotion_id: promoId,
    },
  });
}

test.describe('C01 — booking public mono: passes', () => {
  test.beforeAll(async () => {
    // Reset PASS_ACTIVE to a known state so downstream tests can count transactions deterministically.
    await pool.query(
      `UPDATE passes SET sessions_remaining = 5, status = 'active' WHERE code = $1 AND business_id = $2`,
      [PASS_ACTIVE, IDS.BUSINESS]
    );
  });

  test('1. PASS_ACTIVE on SVC_PASS → debit + confirmed', async () => {
    // Capture current sessions before booking
    const before = await pool.query(
      `SELECT sessions_remaining FROM passes WHERE code = $1 AND business_id = $2`,
      [PASS_ACTIVE, IDS.BUSINESS]
    );
    const sessionsBefore = before.rows[0].sessions_remaining;

    const email = `e2e-pass-active-${Date.now()}@genda-test.be`;
    const startAt = isoPlusDays(7, 9); // Sat — Alice open
    const { status, body } = await postBooking({ startAt, passCode: PASS_ACTIVE, email });
    expect(status, `API error: ${JSON.stringify(body)}`).toBe(201);

    // Pass should decrement by 1
    const after = await pool.query(
      `SELECT sessions_remaining, status FROM passes WHERE code = $1 AND business_id = $2`,
      [PASS_ACTIVE, IDS.BUSINESS]
    );
    expect(after.rows[0].sessions_remaining).toBe(sessionsBefore - 1);

    // pass_transactions: one debit row for this booking
    const tx = await pool.query(
      `SELECT sessions, type FROM pass_transactions WHERE booking_id = $1`,
      [body.booking.id]
    );
    expect(tx.rows.length).toBe(1);
    expect(tx.rows[0].sessions).toBe(-1);
    expect(tx.rows[0].type).toBe('debit');

    // Pass pre-match lowers reducedSvcPrice to 0 BEFORE deposit trigger (index.js:1257-1266),
    // so deposit is waived entirely (not marked "paid via pass"). Booking stays confirmed.
    const bk = await pool.query(
      `SELECT status, deposit_required, deposit_amount_cents, deposit_status, deposit_payment_intent_id
       FROM bookings WHERE id = $1`,
      [body.booking.id]
    );
    expect(bk.rows[0].status).toBe('confirmed');
    expect(bk.rows[0].deposit_required).toBe(false);
    expect(bk.rows[0].deposit_amount_cents).toBeNull();
  });

  test('2. PASS_EXPIRED on SVC_PASS → ignored, booking goes to pending_deposit', async () => {
    const email = `e2e-pass-expired-${Date.now()}@genda-test.be`;
    const startAt = isoPlusDays(7, 11); // Sat — different slot from test 1
    const { status, body } = await postBooking({ startAt, passCode: PASS_EXPIRED, email });
    // API does NOT reject; invalid pass codes are silently ignored.
    expect(status, `API error: ${JSON.stringify(body)}`).toBe(201);

    // No debit recorded
    const tx = await pool.query(
      `SELECT COUNT(*)::int AS cnt FROM pass_transactions WHERE booking_id = $1`,
      [body.booking.id]
    );
    expect(tx.rows[0].cnt).toBe(0);

    const bk = await pool.query(
      `SELECT status, deposit_status, deposit_payment_intent_id FROM bookings WHERE id = $1`,
      [body.booking.id]
    );
    expect(bk.rows[0].status).toBe('pending_deposit');
    expect(bk.rows[0].deposit_status).toBe('pending');
    expect(bk.rows[0].deposit_payment_intent_id).toBeNull();
  });

  test('3. PASS_EMPTY (0 sessions) on SVC_PASS → ignored, booking goes to pending_deposit', async () => {
    const email = `e2e-pass-empty-${Date.now()}@genda-test.be`;
    const startAt = isoPlusDays(7, 13); // Sat — different slot
    const { status, body } = await postBooking({ startAt, passCode: PASS_EMPTY, email });
    expect(status, `API error: ${JSON.stringify(body)}`).toBe(201);

    const tx = await pool.query(
      `SELECT COUNT(*)::int AS cnt FROM pass_transactions WHERE booking_id = $1`,
      [body.booking.id]
    );
    expect(tx.rows[0].cnt).toBe(0);

    const bk = await pool.query(
      `SELECT status, deposit_status FROM bookings WHERE id = $1`,
      [body.booking.id]
    );
    expect(bk.rows[0].status).toBe('pending_deposit');
    expect(bk.rows[0].deposit_status).toBe('pending');
  });

  test('4. PASS_ACTIVE + PROMO_PCT — pass wins, promo does not apply to covered session', async () => {
    // When a pass covers the service, the promo total becomes 0 → validateAndCalcPromo
    // returns valid=false (discount_cents <= 0). Pass still debited.
    const email = `e2e-pass-promo-${Date.now()}@genda-test.be`;
    const startAt = isoPlusDays(7, 15); // Sat — different slot
    const { status, body } = await postBooking({
      startAt,
      passCode: PASS_ACTIVE,
      promoId: IDS.PROMO_PCT,
      email,
    });
    expect(status, `API error: ${JSON.stringify(body)}`).toBe(201);

    // Pass debited (this is now the 2nd debit of PASS_ACTIVE)
    const tx = await pool.query(
      `SELECT sessions FROM pass_transactions WHERE booking_id = $1`,
      [body.booking.id]
    );
    expect(tx.rows.length).toBe(1);
    expect(tx.rows[0].sessions).toBe(-1);

    // Promo NOT applied (would be 0c on the covered session), deposit waived
    // because pass pre-match zeros the deposit base (index.js:1257-1266).
    const bk = await pool.query(
      `SELECT status, deposit_required, promotion_id, promotion_discount_cents
       FROM bookings WHERE id = $1`,
      [body.booking.id]
    );
    expect(bk.rows[0].promotion_id).toBeNull();
    expect(bk.rows[0].promotion_discount_cents).toBe(0);
    expect(bk.rows[0].status).toBe('confirmed');
    expect(bk.rows[0].deposit_required).toBe(false);
  });
});
