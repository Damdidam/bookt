/**
 * C02 / spec 01 — Mono-prac vs Split-prac multi-service bookings.
 *
 * Tests (2):
 *   1. Mono-prac group: SVC_SHORT (15min/15€) + SVC_LONG (120min/95€) on Alice.
 *      Expect 201 + 2 bookings sharing group_id, sequential start_at (SHORT then LONG),
 *      both assigned to PRAC_ALICE.
 *   2. Split-prac group: SVC_SHORT by Alice + SVC_PASS (45min/50€) by Bob via practitioners[].
 *      Expect 201 + different practitioner_id per booking, shared group_id.
 *
 * Seed availability: Alice weekday 2-6 (Wed..Sun Brussels), Bob weekday 1-5 (Tue..Sat).
 * Use next Wednesday @ 10h Brussels → both practitioners available.
 */
const { test, expect } = require('@playwright/test');
const IDS = require('../fixtures/ids');
const { publicFetch, waitForMockLog } = require('../fixtures/api-client');
const { resetMutables } = require('../fixtures/reset-mutables');
const { pool } = require('../../../src/services/db');

const SLUG = 'test-demo-salon';

/** Returns ISO for next occurrence of given UTC weekday (0=Sun..6=Sat) at `hourUTC`. */
function nextWeekdayUTC(weekdayUTC, hourUTC = 8) {
  const d = new Date();
  d.setUTCHours(hourUTC, 0, 0, 0);
  while (d.getUTCDay() !== weekdayUTC || d <= new Date()) {
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return d.toISOString();
}

test.describe('C02 — booking multi-services: mono vs split prac', () => {
  let sinceTs;
  test.beforeEach(async () => {
    sinceTs = new Date(Date.now() - 1000).toISOString();
    await resetMutables();
  });

  test('1. Mono-prac group — SHORT+LONG on Alice, 2 bookings chained by group_id', async () => {
    const email = `e2e-c02-mono-${Date.now()}@genda-test.be`;
    const startAt = nextWeekdayUTC(3, 8); // Next Wednesday 8h UTC (10h Brussels)

    const { status, body } = await publicFetch(`/api/public/${SLUG}/bookings`, {
      method: 'POST',
      body: {
        service_ids: [IDS.SVC_SHORT, IDS.SVC_LONG],
        practitioner_id: IDS.PRAC_ALICE,
        start_at: startAt,
        appointment_mode: 'cabinet',
        client_name: 'E2E Mono Group',
        client_email: email,
        client_phone: '+32491000201',
        consent_sms: true,
        consent_email: true,
      },
    });

    expect(status, `API error: ${JSON.stringify(body)}`).toBe(201);
    expect(body.group_id).toMatch(/^[0-9a-f-]{36}$/i);
    expect(body.auto_split_assigned).toBe(false);
    expect(Array.isArray(body.bookings)).toBe(true);
    expect(body.bookings.length).toBe(2);

    // DB assertions: both bookings share same group_id
    const dbRows = await pool.query(
      `SELECT id, service_id, practitioner_id, group_id, group_order, start_at, end_at, status
       FROM bookings WHERE group_id = $1 ORDER BY group_order`,
      [body.group_id]
    );
    expect(dbRows.rows.length).toBe(2);
    expect(dbRows.rows[0].group_id).toBe(dbRows.rows[1].group_id);

    // Both assigned to Alice
    expect(dbRows.rows[0].practitioner_id).toBe(IDS.PRAC_ALICE);
    expect(dbRows.rows[1].practitioner_id).toBe(IDS.PRAC_ALICE);

    // Order: SVC_SHORT first (group_order=0), SVC_LONG second (group_order=1)
    expect(dbRows.rows[0].service_id).toBe(IDS.SVC_SHORT);
    expect(dbRows.rows[0].group_order).toBe(0);
    expect(dbRows.rows[1].service_id).toBe(IDS.SVC_LONG);
    expect(dbRows.rows[1].group_order).toBe(1);

    // Start times chained: second booking starts right after first ends
    const firstEnd = new Date(dbRows.rows[0].end_at).getTime();
    const secondStart = new Date(dbRows.rows[1].start_at).getTime();
    expect(secondStart).toBe(firstEnd);
  });

  test('2. Split-prac group — SHORT(Alice) + LONG(Bob) via practitioners[], different prac per booking', async () => {
    // Seed note: Bob offers SVC_SHORT+LONG+CHEAP+VARIANTS (not SVC_PASS). Use SVC_LONG for Bob.
    const email = `e2e-c02-split-${Date.now()}@genda-test.be`;
    const startAt = nextWeekdayUTC(3, 8); // Next Wednesday 8h UTC

    const { status, body } = await publicFetch(`/api/public/${SLUG}/bookings`, {
      method: 'POST',
      body: {
        service_ids: [IDS.SVC_SHORT, IDS.SVC_LONG],
        practitioners: [
          { service_id: IDS.SVC_SHORT, practitioner_id: IDS.PRAC_ALICE },
          { service_id: IDS.SVC_LONG, practitioner_id: IDS.PRAC_BOB },
        ],
        start_at: startAt,
        appointment_mode: 'cabinet',
        client_name: 'E2E Split Group',
        client_email: email,
        client_phone: '+32491000202',
        consent_sms: true,
        consent_email: true,
      },
    });

    expect(status, `API error: ${JSON.stringify(body)}`).toBe(201);
    expect(body.group_id).toMatch(/^[0-9a-f-]{36}$/i);
    expect(body.bookings.length).toBe(2);

    const dbRows = await pool.query(
      `SELECT id, service_id, practitioner_id, group_id, group_order, start_at, end_at
       FROM bookings WHERE group_id = $1 ORDER BY group_order`,
      [body.group_id]
    );
    expect(dbRows.rows.length).toBe(2);

    // Both share group_id
    expect(dbRows.rows[0].group_id).toBe(body.group_id);
    expect(dbRows.rows[1].group_id).toBe(body.group_id);

    // Different practitioners
    expect(dbRows.rows[0].practitioner_id).toBe(IDS.PRAC_ALICE);
    expect(dbRows.rows[0].service_id).toBe(IDS.SVC_SHORT);
    expect(dbRows.rows[1].practitioner_id).toBe(IDS.PRAC_BOB);
    expect(dbRows.rows[1].service_id).toBe(IDS.SVC_LONG);

    // Chained start_at (sequential regardless of split-prac)
    const firstEnd = new Date(dbRows.rows[0].end_at).getTime();
    const secondStart = new Date(dbRows.rows[1].start_at).getTime();
    expect(secondStart).toBe(firstEnd);
  });
});
