/**
 * C01 / spec 08 — Edge cases on public booking.
 *
 * 2 tests :
 *   1. Concurrent double-booking race condition:
 *      Two parallel POSTs targeting the SAME slot → the transaction that
 *      detects the conflict rejects with 409 `{error:"Ce créneau vient
 *      d\'être pris."}` (src/routes/public/index.js:1093, re-thrown and
 *      mapped at :1511). Expected outcome: exactly one 201 and one 409
 *      (or in rare scheduling, one 201 and one 400/429 if rate limiter
 *      intervenes — soft assertion allows any non-201 for the loser).
 *   2. Slot in the past:
 *      start_at = J-1 → 400 "Impossible de réserver dans le passé"
 *      (src/routes/public/index.js:183).
 */
const { test, expect } = require('@playwright/test');
const IDS = require('../fixtures/ids');
const { publicFetch } = require('../fixtures/api-client');
const { pool } = require('../../../src/services/db');

const SLUG = 'test-demo-salon';

function isoPlusDays(days, hour = 10) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  d.setHours(hour, 0, 0, 0);
  return d.toISOString();
}

test.describe('C01 — booking public mono: edge cases', () => {
  test('1. Concurrent double-booking on same slot → one 201, one conflict', async () => {
    // Same exact slot, different clients fired in parallel
    const startAt = isoPlusDays(7, 14); // Sat — Alice open

    const body1 = {
      service_id: IDS.SVC_SHORT,
      practitioner_id: IDS.PRAC_ALICE,
      start_at: startAt,
      appointment_mode: 'cabinet',
      client_name: 'Race Client A',
      client_email: `e2e-race-a-${Date.now()}@genda-test.be`,
      client_phone: `+3249100${String(Math.floor(Math.random()*9000)+1000)}`,
      consent_sms: true,
      consent_email: true,
      consent_marketing: false,
    };
    const body2 = {
      ...body1,
      client_name: 'Race Client B',
      client_email: `e2e-race-b-${Date.now()}@genda-test.be`,
      client_phone: `+3249100${String(Math.floor(Math.random()*9000)+1000)}`,
    };

    const [r1, r2] = await Promise.all([
      publicFetch(`/api/public/${SLUG}/bookings`, { method: 'POST', body: body1 }),
      publicFetch(`/api/public/${SLUG}/bookings`, { method: 'POST', body: body2 }),
    ]);

    const statuses = [r1.status, r2.status].sort();
    // Expect exactly one 201 and one conflict (commonly 409 or possibly 400 if
    // a race-validating path reports differently). Lock contract: not both 201.
    const successes = [r1, r2].filter(r => r.status === 201);
    const failures = [r1, r2].filter(r => r.status !== 201);
    expect(successes.length,
      `Expected exactly one success but got ${successes.length}. statuses=${statuses.join(',')}`
    ).toBe(1);
    expect(failures.length).toBe(1);
    // Preferred: loser is 409. Accept 400/429 soft fallbacks by documenting in annotation.
    const loser = failures[0];
    test.info().annotations.push({
      type: 'race-loser',
      description: `status=${loser.status} error=${JSON.stringify(loser.body?.error)}`,
    });
    expect([400, 409, 429]).toContain(loser.status);

    // Only one booking actually exists for this exact (practitioner, start_at) pair
    const dbRow = await pool.query(
      `SELECT COUNT(*)::int AS cnt FROM bookings
       WHERE business_id = $1 AND practitioner_id = $2 AND start_at = $3
         AND status IN ('confirmed','pending','pending_deposit','modified_pending')`,
      [IDS.BUSINESS, IDS.PRAC_ALICE, startAt]
    );
    expect(dbRow.rows[0].cnt).toBe(1);
  });

  test('2. Past slot (J-1) → 400 "Impossible de réserver dans le passé"', async () => {
    const startAt = isoPlusDays(-1, 10); // Yesterday at 10h

    const { status, body } = await publicFetch(`/api/public/${SLUG}/bookings`, {
      method: 'POST',
      body: {
        service_id: IDS.SVC_SHORT,
        practitioner_id: IDS.PRAC_ALICE,
        start_at: startAt,
        appointment_mode: 'cabinet',
        client_name: 'Past Slot',
        client_email: `e2e-past-${Date.now()}@genda-test.be`,
        client_phone: '+32491000999',
        consent_sms: true,
        consent_email: true,
        consent_marketing: false,
      },
    });
    expect(status).toBe(400);
    expect(body.error).toMatch(/passé/i);
  });
});
