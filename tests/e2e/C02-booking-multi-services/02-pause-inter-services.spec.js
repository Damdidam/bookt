/**
 * C02 / spec 02 — Pause / buffer entre services d'un group.
 *
 * Observation from public/index.js (chainedSlots, ~L374-394):
 *   - Multi-service flow adds buffer_before to the FIRST slot only and buffer_after
 *     to the LAST slot only; between services, no buffer/pause is added.
 *   - `processing_time` and `processing_start` are stored on each booking row but
 *     NOT added to end_at calculation in the chain.
 *
 * Seed state (all services of TEST business): buffer_before_min=0, buffer_after_min=0,
 * processing_time=0. So the observable chain contract is simply:
 *     slot[i+1].start_at === slot[i].end_at
 *
 * Test (1):
 *   1. SHORT+LONG on Alice — verify end_at - start_at per service equals duration_min
 *      exactly, and the second slot starts at the first slot's end (no pause).
 */
const { test, expect } = require('@playwright/test');
const IDS = require('../fixtures/ids');
const { publicFetch } = require('../fixtures/api-client');
const { resetMutables } = require('../fixtures/reset-mutables');
const { pool } = require('../../../src/services/db');

const SLUG = 'test-demo-salon';

function nextWeekdayUTC(weekdayUTC, hourUTC = 8) {
  const d = new Date();
  d.setUTCHours(hourUTC, 0, 0, 0);
  while (d.getUTCDay() !== weekdayUTC || d <= new Date()) {
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return d.toISOString();
}

test.describe('C02 — booking multi-services: pause inter-services', () => {
  let sinceTs;
  test.beforeEach(async () => {
    sinceTs = new Date(Date.now() - 1000).toISOString();
    await resetMutables();
  });

  test('1. No pause entre services — contiguous chain (end[i] === start[i+1])', async () => {
    const email = `e2e-c02-pause-${Date.now()}@genda-test.be`;
    const startAt = nextWeekdayUTC(3, 9); // Next Wednesday 9h UTC (11h Brussels)

    const { status, body } = await publicFetch(`/api/public/${SLUG}/bookings`, {
      method: 'POST',
      body: {
        service_ids: [IDS.SVC_SHORT, IDS.SVC_LONG],
        practitioner_id: IDS.PRAC_ALICE,
        start_at: startAt,
        appointment_mode: 'cabinet',
        client_name: 'E2E Pause Test',
        client_email: email,
        client_phone: '+32491000203',
        consent_sms: true,
        consent_email: true,
      },
    });

    expect(status, `API error: ${JSON.stringify(body)}`).toBe(201);

    const dbRows = await pool.query(
      `SELECT service_id, start_at, end_at, processing_time, processing_start
       FROM bookings WHERE group_id = $1 ORDER BY group_order`,
      [body.group_id]
    );
    expect(dbRows.rows.length).toBe(2);

    // Seed services: SVC_SHORT duration_min=15, SVC_LONG duration_min=120
    const durations = { [IDS.SVC_SHORT]: 15, [IDS.SVC_LONG]: 120 };
    for (const r of dbRows.rows) {
      const diffMin = (new Date(r.end_at).getTime() - new Date(r.start_at).getTime()) / 60000;
      expect(diffMin).toBe(durations[r.service_id]);
    }

    // Chain contiguity: second.start_at === first.end_at
    expect(new Date(dbRows.rows[1].start_at).toISOString())
      .toBe(new Date(dbRows.rows[0].end_at).toISOString());

    // processing_time / processing_start stored as 0 (no pause feature active on seed)
    expect(dbRows.rows[0].processing_time || 0).toBe(0);
    expect(dbRows.rows[1].processing_time || 0).toBe(0);
    test.info().annotations.push({
      type: 'observed-behavior',
      description: 'Multi-service chain is contiguous — no inter-service pause added by backend. processing_time=0 seed, no observable gap.'
    });
  });
});
