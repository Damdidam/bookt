/**
 * C04 / spec 03 — Cancel: gift card + pass coverage restoration + modified_pending
 * group propagation.
 *
 * On cancel, refundGiftCardForBooking + refundPassForBooking run ALWAYS
 * (unconditional refund, not tied to deposit deadline) — GC is a client asset.
 *
 * 3 tests.
 */
const { test, expect } = require('@playwright/test');
const IDS = require('../fixtures/ids');
const { publicFetch } = require('../fixtures/api-client');
const { resetMutables } = require('../fixtures/reset-mutables');
const { pool } = require('../../../src/services/db');

const SLUG = 'test-demo-salon';
const CODE_PARTIAL = 'TESTGC02PART';
const PASS_ACTIVE = 'TESTPASS01AC';

function isoPlusDays(days, hour = 10) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  d.setHours(hour, 0, 0, 0);
  return d.toISOString();
}

test.describe('C04 — cancel gc/pass/group', () => {
  let sinceTs;
  test.beforeEach(async () => {
    sinceTs = new Date(Date.now() - 1000).toISOString();
    await resetMutables();
  });

  test('1. Cancel GC coverage → balance restored + refund transaction', async () => {
    // Capture balance BEFORE booking
    const before = await pool.query(
      `SELECT balance_cents FROM gift_cards WHERE code = $1 AND business_id = $2`,
      [CODE_PARTIAL, IDS.BUSINESS]
    );
    const balanceBefore = before.rows[0].balance_cents;

    // Book SVC_EXPENSIVE w/ GC — triggers GC debit
    const email = `e2e-c04-gc-${Date.now()}@genda-test.be`;
    const create = await publicFetch(`/api/public/${SLUG}/bookings`, {
      method: 'POST',
      body: {
        service_id: IDS.SVC_EXPENSIVE,
        practitioner_id: IDS.PRAC_ALICE,
        start_at: isoPlusDays(5, 10),
        appointment_mode: 'cabinet',
        client_name: 'E2E GC Cancel',
        client_email: email,
        client_phone: '+32491000500',
        consent_sms: true,
        consent_email: true,
        consent_marketing: false,
        gift_card_code: CODE_PARTIAL,
      },
    });
    expect(create.status, `Create error: ${JSON.stringify(create.body)}`).toBe(201);
    const token = create.body.booking.token;
    const bkId = create.body.booking.id;

    // GC should have been debited
    const afterDebit = await pool.query(
      `SELECT balance_cents FROM gift_cards WHERE code = $1 AND business_id = $2`,
      [CODE_PARTIAL, IDS.BUSINESS]
    );
    const balanceAfterDebit = afterDebit.rows[0].balance_cents;
    const debitedAmount = balanceBefore - balanceAfterDebit;
    expect(debitedAmount).toBeGreaterThan(0);

    // Cancel
    const cancel = await publicFetch(`/api/public/booking/${token}/cancel`, {
      method: 'POST',
      body: {},
    });
    expect(cancel.status, `Cancel error: ${JSON.stringify(cancel.body)}`).toBe(200);

    // GC balance restored
    const afterCancel = await pool.query(
      `SELECT balance_cents FROM gift_cards WHERE code = $1 AND business_id = $2`,
      [CODE_PARTIAL, IDS.BUSINESS]
    );
    expect(afterCancel.rows[0].balance_cents).toBe(balanceBefore);

    // Refund transaction logged
    const refunds = await pool.query(
      `SELECT amount_cents, type FROM gift_card_transactions
       WHERE booking_id = $1 AND type = 'refund'`,
      [bkId]
    );
    expect(refunds.rows.length).toBeGreaterThanOrEqual(1);
    expect(refunds.rows[0].amount_cents).toBe(debitedAmount);
  });

  test('2. Cancel pass coverage → session restored + refund transaction', async () => {
    const before = await pool.query(
      `SELECT sessions_remaining FROM passes WHERE code = $1 AND business_id = $2`,
      [PASS_ACTIVE, IDS.BUSINESS]
    );
    const sessionsBefore = before.rows[0].sessions_remaining;

    const email = `e2e-c04-pass-${Date.now()}@genda-test.be`;
    const create = await publicFetch(`/api/public/${SLUG}/bookings`, {
      method: 'POST',
      body: {
        service_id: IDS.SVC_PASS,
        practitioner_id: IDS.PRAC_ALICE,
        start_at: isoPlusDays(5, 11),
        appointment_mode: 'cabinet',
        client_name: 'E2E Pass Cancel',
        client_email: email,
        client_phone: '+32491000501',
        consent_sms: true,
        consent_email: true,
        consent_marketing: false,
        pass_code: PASS_ACTIVE,
      },
    });
    expect(create.status, `Create error: ${JSON.stringify(create.body)}`).toBe(201);
    const token = create.body.booking.token;
    const bkId = create.body.booking.id;

    // Pass should have been debited
    const afterDebit = await pool.query(
      `SELECT sessions_remaining FROM passes WHERE code = $1 AND business_id = $2`,
      [PASS_ACTIVE, IDS.BUSINESS]
    );
    expect(afterDebit.rows[0].sessions_remaining).toBe(sessionsBefore - 1);

    // Cancel
    const cancel = await publicFetch(`/api/public/booking/${token}/cancel`, {
      method: 'POST',
      body: {},
    });
    expect(cancel.status).toBe(200);

    const afterCancel = await pool.query(
      `SELECT sessions_remaining FROM passes WHERE code = $1 AND business_id = $2`,
      [PASS_ACTIVE, IDS.BUSINESS]
    );
    expect(afterCancel.rows[0].sessions_remaining).toBe(sessionsBefore);

    // Refund transaction logged
    const refunds = await pool.query(
      `SELECT sessions, type FROM pass_transactions
       WHERE booking_id = $1 AND type = 'refund'`,
      [bkId]
    );
    expect(refunds.rows.length).toBeGreaterThanOrEqual(1);
  });

  test('3. Cancel modified_pending primary propagates to siblings', async () => {
    // Create a multi-service booking (group) via public POST
    const email = `e2e-c04-group-mp-${Date.now()}@genda-test.be`;
    const startAt = isoPlusDays(4, 14);
    const create = await publicFetch(`/api/public/${SLUG}/bookings`, {
      method: 'POST',
      body: {
        service_ids: [IDS.SVC_SHORT, IDS.SVC_CHEAP],
        practitioner_id: IDS.PRAC_ALICE,
        start_at: startAt,
        appointment_mode: 'cabinet',
        client_name: 'E2E Group MP',
        client_email: email,
        client_phone: '+32491000502',
        consent_sms: true,
        consent_email: true,
        consent_marketing: false,
      },
    });

    if (create.status !== 201) {
      // Multi-service may not be triggered by service_ids[] — adapt to behavior
      test.info().annotations.push({ type: 'adapt', description: `multi-service create failed: ${JSON.stringify(create.body)}` });
      // Fall back to single booking + fake sibling via direct INSERT
      const single = await publicFetch(`/api/public/${SLUG}/bookings`, {
        method: 'POST',
        body: {
          service_id: IDS.SVC_SHORT,
          practitioner_id: IDS.PRAC_ALICE,
          start_at: startAt,
          appointment_mode: 'cabinet',
          client_name: 'E2E Group Fallback',
          client_email: email,
          client_phone: '+32491000502',
          consent_sms: true,
          consent_email: true,
          consent_marketing: false,
        },
      });
      expect(single.status).toBe(201);
      const bkId = single.body.booking.id;
      const token = single.body.booking.token;
      // Create a sibling via direct INSERT with shared group_id
      const grpRes = await pool.query(
        `UPDATE bookings SET group_id = gen_random_uuid(), status = 'modified_pending' WHERE id = $1 RETURNING group_id`,
        [bkId]
      );
      const groupId = grpRes.rows[0].group_id;
      const sib = await pool.query(
        `INSERT INTO bookings (business_id, practitioner_id, service_id, client_id, start_at, end_at,
           status, appointment_mode, public_token, group_id, group_order, booked_price_cents)
         VALUES ($1, $2, $3, $4, $5::timestamptz + INTERVAL '20 minutes', $5::timestamptz + INTERVAL '40 minutes',
           'modified_pending', 'cabinet', encode(gen_random_bytes(8),'hex'), $6, 1, 1000)
         RETURNING id`,
        [IDS.BUSINESS, IDS.PRAC_ALICE, IDS.SVC_CHEAP, IDS.CLIENT_JEAN, startAt, groupId]
      );
      const sibId = sib.rows[0].id;

      // Cancel primary
      const cancel = await publicFetch(`/api/public/booking/${token}/cancel`, {
        method: 'POST',
        body: { reason: 'Group cancel' },
      });
      expect(cancel.status).toBe(200);

      // Both should be cancelled
      const after = await pool.query(
        `SELECT id, status FROM bookings WHERE id = ANY($1::uuid[])`,
        [[bkId, sibId]]
      );
      for (const r of after.rows) {
        expect(r.status).toBe('cancelled');
      }
      return;
    }

    // Multi-service succeeded
    const bkId = create.body.booking.id;
    const token = create.body.booking.token;
    await pool.query(
      `UPDATE bookings SET status = 'modified_pending' WHERE group_id = (SELECT group_id FROM bookings WHERE id = $1)`,
      [bkId]
    );
    const groupId = (await pool.query(`SELECT group_id FROM bookings WHERE id = $1`, [bkId])).rows[0].group_id;

    const cancel = await publicFetch(`/api/public/booking/${token}/cancel`, {
      method: 'POST',
      body: { reason: 'Group cancel' },
    });
    expect(cancel.status).toBe(200);

    const siblings = await pool.query(
      `SELECT id, status FROM bookings WHERE group_id = $1`,
      [groupId]
    );
    for (const r of siblings.rows) {
      expect(r.status).toBe('cancelled');
    }
  });
});
