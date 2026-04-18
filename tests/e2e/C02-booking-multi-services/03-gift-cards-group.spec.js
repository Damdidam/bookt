/**
 * C02 / spec 03 — Gift cards on multi-service group booking.
 *
 * Deposit trigger: TEST business settings threshold_mode='any' with price>=5000c OR duration>=60min.
 * Multi-service totals:
 *   - SHORT (15€/15min) + LONG (95€/120min) → 110€/135min → deposit 50% = 55€
 *   - 2× CHEAP (10€/20min each) → 20€/40min → below thresholds → NO deposit (stays confirmed)
 *
 * Gift-card auto-debit (src/routes/public/index.js:748-808): only runs when deposit is required.
 *
 * Tests (2):
 *   1. GC_PARTIAL (50€ balance) on SHORT+LONG group (deposit 55€) → GC debits 50€, still
 *      pending_deposit for remaining 5€ via Stripe. Booking[0] marked deposit_amount_cents=5500.
 *   2. 2× CHEAP + GC_ACTIVE (100€) → below threshold, NO deposit triggered → GC NOT debited
 *      (GC auto-debit branch is gated by depResult.required). Booking stays confirmed.
 *
 * NOTE on test 2: the task description said "GC full coverage sur group" — but since the group
 * is below deposit threshold, GC auto-debit does not run at all. This is the documented backend
 * behavior (GC runs only inside the deposit savepoint). Assertions match reality.
 */
const { test, expect } = require('@playwright/test');
const IDS = require('../fixtures/ids');
const { publicFetch } = require('../fixtures/api-client');
const { resetMutables } = require('../fixtures/reset-mutables');
const { pool } = require('../../../src/services/db');

const SLUG = 'test-demo-salon';
const GC_PARTIAL_CODE = 'TESTGC02PART';
const GC_ACTIVE_CODE = 'TESTGC01ACTV';

function nextWeekdayUTC(weekdayUTC, hourUTC = 8) {
  const d = new Date();
  d.setUTCHours(hourUTC, 0, 0, 0);
  while (d.getUTCDay() !== weekdayUTC || d <= new Date()) {
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return d.toISOString();
}

test.describe('C02 — booking multi-services: gift cards on group', () => {
  let sinceTs;
  test.beforeEach(async () => {
    sinceTs = new Date(Date.now() - 1000).toISOString();
    await resetMutables();
  });

  test('1. GC_PARTIAL (50€) on SHORT+LONG group (dep 55€) → GC debits 50€, 5€ remaining via Stripe', async () => {
    const email = `e2e-c02-gc-partial-${Date.now()}@genda-test.be`;
    const startAt = nextWeekdayUTC(3, 8);

    const { status, body } = await publicFetch(`/api/public/${SLUG}/bookings`, {
      method: 'POST',
      body: {
        service_ids: [IDS.SVC_SHORT, IDS.SVC_LONG],
        practitioner_id: IDS.PRAC_ALICE,
        start_at: startAt,
        appointment_mode: 'cabinet',
        client_name: 'E2E GC Partial',
        client_email: email,
        client_phone: '+32491000301',
        consent_sms: true,
        consent_email: true,
        gift_card_code: GC_PARTIAL_CODE,
      },
    });

    expect(status, `API error: ${JSON.stringify(body)}`).toBe(201);
    expect(body.bookings.length).toBe(2);

    // Deposit check: primary booking[0] carries the deposit amount
    const bk0 = await pool.query(
      `SELECT status, deposit_required, deposit_amount_cents, deposit_status, deposit_payment_intent_id
       FROM bookings WHERE id = $1`,
      [body.bookings[0].id]
    );
    expect(bk0.rows[0].deposit_required).toBe(true);
    expect(bk0.rows[0].deposit_amount_cents).toBe(5500); // 50% of 11000c total
    // Partial: 5000c GC < 5500c deposit → booking still pending_deposit
    expect(bk0.rows[0].status).toBe('pending_deposit');
    expect(bk0.rows[0].deposit_status).toBe('pending');

    // GC balance debited to 0 (5000c drained)
    const gc = await pool.query(
      `SELECT balance_cents, status FROM gift_cards WHERE code = $1 AND business_id = $2`,
      [GC_PARTIAL_CODE, IDS.BUSINESS]
    );
    expect(gc.rows[0].balance_cents).toBe(0);
    expect(gc.rows[0].status).toBe('used');

    // One debit transaction recorded linked to the primary booking
    const tx = await pool.query(
      `SELECT amount_cents, type FROM gift_card_transactions
       WHERE booking_id = $1 AND type = 'debit'`,
      [body.bookings[0].id]
    );
    expect(tx.rows.length).toBe(1);
    expect(tx.rows[0].amount_cents).toBe(5000);
  });

  test('2. 2× CHEAP (20€ total, 40min) + GC_ACTIVE (100€) → below threshold, NO deposit, GC NOT debited', async () => {
    const email = `e2e-c02-gc-full-${Date.now()}@genda-test.be`;
    const startAt = nextWeekdayUTC(3, 10);

    const gcBefore = await pool.query(
      `SELECT balance_cents FROM gift_cards WHERE code = $1 AND business_id = $2`,
      [GC_ACTIVE_CODE, IDS.BUSINESS]
    );

    const { status, body } = await publicFetch(`/api/public/${SLUG}/bookings`, {
      method: 'POST',
      body: {
        service_ids: [IDS.SVC_CHEAP, IDS.SVC_CHEAP],
        practitioner_id: IDS.PRAC_ALICE,
        start_at: startAt,
        appointment_mode: 'cabinet',
        client_name: 'E2E GC Full',
        client_email: email,
        client_phone: '+32491000302',
        consent_sms: true,
        consent_email: true,
        gift_card_code: GC_ACTIVE_CODE,
      },
    });

    expect(status, `API error: ${JSON.stringify(body)}`).toBe(201);
    expect(body.bookings.length).toBe(2);

    // 20€/40min is below both thresholds (5000c OR 60min) → no deposit
    const bk0 = await pool.query(
      `SELECT status, deposit_required, deposit_amount_cents FROM bookings WHERE id = $1`,
      [body.bookings[0].id]
    );
    expect(bk0.rows[0].status).toBe('confirmed');
    expect(bk0.rows[0].deposit_required).toBe(false);
    expect(bk0.rows[0].deposit_amount_cents == null || bk0.rows[0].deposit_amount_cents === 0).toBe(true);

    // GC should NOT have been debited (auto-debit branch is gated on depResult.required)
    const gcAfter = await pool.query(
      `SELECT balance_cents FROM gift_cards WHERE code = $1 AND business_id = $2`,
      [GC_ACTIVE_CODE, IDS.BUSINESS]
    );
    expect(gcAfter.rows[0].balance_cents).toBe(gcBefore.rows[0].balance_cents);

    const tx = await pool.query(
      `SELECT COUNT(*)::int AS cnt FROM gift_card_transactions
       WHERE booking_id = ANY($1) AND type = 'debit'`,
      [body.bookings.map(b => b.id)]
    );
    expect(tx.rows[0].cnt).toBe(0);
    test.info().annotations.push({
      type: 'observed-behavior',
      description: 'GC auto-debit only runs when a deposit is required. Below-threshold groups bypass GC entirely.'
    });
  });
});
