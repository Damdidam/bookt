/**
 * C02 / spec 04 — Passes on multi-service group bookings.
 *
 * Seed pass: TESTPASS01AC — 5 sessions remaining, bound to SVC_PASS (5000c/45min).
 * Only PRAC_ALICE offers SVC_PASS (checked in seed).
 *
 * Tests (2):
 *   1. Pass covers 1 service of group — SVC_PASS + SVC_SHORT (on Alice), pass_code sent.
 *      Expect: pass decrements by 1, one pass_transactions debit row linked to the
 *      SVC_PASS booking id (not SVC_SHORT).
 *   2. Pass + other non-covered service — SVC_PASS + SVC_LONG (on Alice). Pass covers
 *      SVC_PASS; SVC_LONG still requires deposit (group still above threshold after
 *      excluding pass-covered service → 95€/120min; 50% deposit on reduced total).
 */
const { test, expect } = require('@playwright/test');
const IDS = require('../fixtures/ids');
const { publicFetch } = require('../fixtures/api-client');
const { resetMutables } = require('../fixtures/reset-mutables');
const { pool } = require('../../../src/services/db');

const SLUG = 'test-demo-salon';
const PASS_ACTIVE = 'TESTPASS01AC';

function nextWeekdayUTC(weekdayUTC, hourUTC = 8) {
  const d = new Date();
  d.setUTCHours(hourUTC, 0, 0, 0);
  while (d.getUTCDay() !== weekdayUTC || d <= new Date()) {
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return d.toISOString();
}

test.describe('C02 — booking multi-services: passes on group', () => {
  let sinceTs;
  test.beforeEach(async () => {
    sinceTs = new Date(Date.now() - 1000).toISOString();
    await resetMutables();
  });

  test('1. Pass couvre 1 service du group (SVC_PASS + SVC_SHORT) — debit 1 session sur SVC_PASS seulement', async () => {
    const before = await pool.query(
      `SELECT sessions_remaining FROM passes WHERE code = $1 AND business_id = $2`,
      [PASS_ACTIVE, IDS.BUSINESS]
    );
    const sessionsBefore = before.rows[0].sessions_remaining;

    const email = `e2e-c02-pass-one-${Date.now()}@genda-test.be`;
    const startAt = nextWeekdayUTC(3, 8);

    const { status, body } = await publicFetch(`/api/public/${SLUG}/bookings`, {
      method: 'POST',
      body: {
        service_ids: [IDS.SVC_PASS, IDS.SVC_SHORT],
        practitioner_id: IDS.PRAC_ALICE,
        start_at: startAt,
        appointment_mode: 'cabinet',
        client_name: 'E2E Pass On Group',
        client_email: email,
        client_phone: '+32491000401',
        consent_sms: true,
        consent_email: true,
        pass_code: PASS_ACTIVE,
      },
    });

    expect(status, `API error: ${JSON.stringify(body)}`).toBe(201);
    expect(body.bookings.length).toBe(2);

    // Pass decremented by 1 only
    const after = await pool.query(
      `SELECT sessions_remaining FROM passes WHERE code = $1 AND business_id = $2`,
      [PASS_ACTIVE, IDS.BUSINESS]
    );
    expect(after.rows[0].sessions_remaining).toBe(sessionsBefore - 1);

    // Debit row is attached to SVC_PASS booking, not SVC_SHORT
    const svcPassBooking = await pool.query(
      `SELECT id FROM bookings WHERE group_id = $1 AND service_id = $2`,
      [body.group_id, IDS.SVC_PASS]
    );
    expect(svcPassBooking.rows.length).toBe(1);
    const passBkId = svcPassBooking.rows[0].id;

    const tx = await pool.query(
      `SELECT booking_id, sessions, type FROM pass_transactions WHERE booking_id = ANY($1) ORDER BY booking_id`,
      [body.bookings.map(b => b.id)]
    );
    expect(tx.rows.length).toBe(1);
    expect(tx.rows[0].booking_id).toBe(passBkId);
    expect(tx.rows[0].sessions).toBe(-1);
    expect(tx.rows[0].type).toBe('debit');
  });

  test('2. Pass + SVC_LONG sans pass → pass couvre SVC_PASS, SVC_LONG paye deposit normal', async () => {
    const before = await pool.query(
      `SELECT sessions_remaining FROM passes WHERE code = $1 AND business_id = $2`,
      [PASS_ACTIVE, IDS.BUSINESS]
    );
    const sessionsBefore = before.rows[0].sessions_remaining;

    const email = `e2e-c02-pass-other-${Date.now()}@genda-test.be`;
    const startAt = nextWeekdayUTC(3, 10);

    const { status, body } = await publicFetch(`/api/public/${SLUG}/bookings`, {
      method: 'POST',
      body: {
        service_ids: [IDS.SVC_PASS, IDS.SVC_LONG],
        practitioner_id: IDS.PRAC_ALICE,
        start_at: startAt,
        appointment_mode: 'cabinet',
        client_name: 'E2E Pass + Paid',
        client_email: email,
        client_phone: '+32491000402',
        consent_sms: true,
        consent_email: true,
        pass_code: PASS_ACTIVE,
      },
    });

    expect(status, `API error: ${JSON.stringify(body)}`).toBe(201);
    expect(body.bookings.length).toBe(2);

    // Pass debit once
    const after = await pool.query(
      `SELECT sessions_remaining FROM passes WHERE code = $1 AND business_id = $2`,
      [PASS_ACTIVE, IDS.BUSINESS]
    );
    expect(after.rows[0].sessions_remaining).toBe(sessionsBefore - 1);

    const tx = await pool.query(
      `SELECT COUNT(*)::int AS cnt FROM pass_transactions
       WHERE booking_id = ANY($1) AND type = 'debit'`,
      [body.bookings.map(b => b.id)]
    );
    expect(tx.rows[0].cnt).toBe(1);

    // SVC_PASS booking: deposit may be 'paid' via pass (pass_${CODE} marker) OR waived entirely.
    // Per C01 spec 06 observation — pre-match path zeros the deposit base → deposit_required stays
    // false for SVC_PASS covered alone. But in multi, we see depResult recomputed AFTER pass debit.
    const svcPassBk = await pool.query(
      `SELECT status, deposit_required, deposit_amount_cents, deposit_status, deposit_payment_intent_id
       FROM bookings WHERE group_id = $1 AND service_id = $2`,
      [body.group_id, IDS.SVC_PASS]
    );
    // SVC_LONG booking: requires real deposit (group total after pass exclusion = 9500c, 50% = 4750c)
    const svcLongBk = await pool.query(
      `SELECT status, deposit_required, deposit_amount_cents, deposit_status, deposit_payment_intent_id
       FROM bookings WHERE group_id = $1 AND service_id = $2`,
      [body.group_id, IDS.SVC_LONG]
    );

    // Pass-covered booking is not in pending_deposit (either confirmed, or paid via pass)
    expect(svcPassBk.rows[0].status).not.toBe('pending_deposit');

    // Non-pass booking must be in pending_deposit with amount > 0
    expect(svcLongBk.rows[0].status).toBe('pending_deposit');
    expect(svcLongBk.rows[0].deposit_required).toBe(true);
    expect(svcLongBk.rows[0].deposit_amount_cents).toBeGreaterThan(0);
    expect(svcLongBk.rows[0].deposit_status).toBe('pending');
  });
});
