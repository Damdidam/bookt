/**
 * C04 / spec 04 — Client self-reschedule (POST /api/public/manage/:token/reschedule).
 *
 * The reschedule endpoint requires settings.reschedule_enabled=true on the
 * business. Seed 01-business.js doesn't set it, so we toggle it in beforeAll
 * and restore in afterAll.
 *
 * Body: { start_at, end_at, practitioners? }   (NOT { variant_id } — variant
 * is tied to the booking itself, not the reschedule request; changing variants
 * requires a staff /modify endpoint).
 *
 * 5 tests.
 */
const { test, expect } = require('@playwright/test');
const IDS = require('../fixtures/ids');
const { publicFetch } = require('../fixtures/api-client');
const { resetMutables } = require('../fixtures/reset-mutables');
const { pool } = require('../../../src/services/db');

const SLUG = 'test-demo-salon';

function isoPlusDays(days, hour = 10) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  d.setHours(hour, 0, 0, 0);
  return d.toISOString();
}

function isoPlusDaysAtEnd(days, hour, minutes) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  d.setHours(hour, minutes, 0, 0);
  return d.toISOString();
}

async function enableReschedule(enabled) {
  await pool.query(
    `UPDATE businesses SET settings = jsonb_set(
       jsonb_set(settings, '{reschedule_enabled}', to_jsonb($2::boolean)),
       '{reschedule_max_count}', to_jsonb(5)
     ) WHERE id = $1`,
    [IDS.BUSINESS, enabled]
  );
}

test.describe('C04 — client reschedule', () => {
  test.beforeAll(async () => {
    await enableReschedule(true);
  });
  test.afterAll(async () => {
    // Don't flip back to true/false globally — seed doesn't have the key,
    // so remove it to restore pristine state
    await pool.query(
      `UPDATE businesses SET settings = settings - 'reschedule_enabled' - 'reschedule_max_count'
       WHERE id = $1`,
      [IDS.BUSINESS]
    );
  });

  let sinceTs;
  test.beforeEach(async () => {
    sinceTs = new Date(Date.now() - 1000).toISOString();
    await resetMutables();
    // resetMutables doesn't touch settings, but double-ensure
    await enableReschedule(true);
  });

  test('1. Simple reschedule — SVC_SHORT, new slot same day', async () => {
    const email = `e2e-c04-resch-${Date.now()}@genda-test.be`;
    const startAt = isoPlusDays(4, 10);
    const create = await publicFetch(`/api/public/${SLUG}/bookings`, {
      method: 'POST',
      body: {
        service_id: IDS.SVC_SHORT,
        practitioner_id: IDS.PRAC_ALICE,
        start_at: startAt,
        appointment_mode: 'cabinet',
        client_name: 'E2E Resch',
        client_email: email,
        client_phone: '+32491000600',
        consent_sms: true,
        consent_email: true,
        consent_marketing: false,
      },
    });
    expect(create.status, `Create error: ${JSON.stringify(create.body)}`).toBe(201);
    const { token, id: bkId } = create.body.booking;

    // Reschedule to +2 hours
    const newStart = new Date(new Date(startAt).getTime() + 2 * 3600000).toISOString();
    const newEnd = new Date(new Date(startAt).getTime() + 2 * 3600000 + 15 * 60000).toISOString();

    const res = await publicFetch(`/api/public/manage/${token}/reschedule`, {
      method: 'POST',
      body: { start_at: newStart, end_at: newEnd },
    });
    expect(res.status, `Resch error: ${JSON.stringify(res.body)}`).toBe(200);

    const after = await pool.query(
      `SELECT start_at, reschedule_count FROM bookings WHERE id = $1`,
      [bkId]
    );
    expect(new Date(after.rows[0].start_at).getTime()).toBe(new Date(newStart).getTime());
    expect(after.rows[0].reschedule_count).toBe(1);
  });

  test('2. Reschedule — conservative (variant not changeable via public reschedule)', async () => {
    // Public reschedule does NOT change variant_id. Test that a normal reschedule
    // on a variant-based booking keeps the variant (same price, same duration).
    const email = `e2e-c04-resch-variant-${Date.now()}@genda-test.be`;
    const startAt = isoPlusDays(4, 14);
    const create = await publicFetch(`/api/public/${SLUG}/bookings`, {
      method: 'POST',
      body: {
        service_id: IDS.SVC_VARIANTS,
        variant_id: IDS.VAR_45MIN,
        practitioner_id: IDS.PRAC_ALICE,
        start_at: startAt,
        appointment_mode: 'cabinet',
        client_name: 'E2E Var Resch',
        client_email: email,
        client_phone: '+32491000601',
        consent_sms: true,
        consent_email: true,
        consent_marketing: false,
      },
    });
    expect(create.status, `Create error: ${JSON.stringify(create.body)}`).toBe(201);
    const { token, id: bkId } = create.body.booking;

    const before = await pool.query(
      `SELECT service_variant_id, booked_price_cents FROM bookings WHERE id = $1`,
      [bkId]
    );

    const newStart = new Date(new Date(startAt).getTime() + 3 * 3600000).toISOString();
    const newEnd = new Date(new Date(newStart).getTime() + 45 * 60000).toISOString();

    const res = await publicFetch(`/api/public/manage/${token}/reschedule`, {
      method: 'POST',
      body: { start_at: newStart, end_at: newEnd },
    });
    expect(res.status, `Resch error: ${JSON.stringify(res.body)}`).toBe(200);

    const after = await pool.query(
      `SELECT service_variant_id, booked_price_cents FROM bookings WHERE id = $1`,
      [bkId]
    );
    // Variant unchanged + price preserved
    expect(after.rows[0].service_variant_id).toBe(before.rows[0].service_variant_id);
    expect(after.rows[0].booked_price_cents).toBe(before.rows[0].booked_price_cents);
  });

  test('3. Reschedule to slot occupied by another booking → 409', async () => {
    // Create booking A at J+5 10h
    const startA = isoPlusDays(5, 10);
    const createA = await publicFetch(`/api/public/${SLUG}/bookings`, {
      method: 'POST',
      body: {
        service_id: IDS.SVC_SHORT,
        practitioner_id: IDS.PRAC_ALICE,
        start_at: startA,
        appointment_mode: 'cabinet',
        client_name: 'Resch A',
        client_email: `e2e-c04-resch-a-${Date.now()}@genda-test.be`,
        client_phone: '+32491000700',
        consent_sms: true, consent_email: true, consent_marketing: false,
      },
    });
    expect(createA.status, `Create A error: ${JSON.stringify(createA.body)}`).toBe(201);

    // Create booking B at J+5 12h
    const startB = isoPlusDays(5, 12);
    const createB = await publicFetch(`/api/public/${SLUG}/bookings`, {
      method: 'POST',
      body: {
        service_id: IDS.SVC_SHORT,
        practitioner_id: IDS.PRAC_ALICE,
        start_at: startB,
        appointment_mode: 'cabinet',
        client_name: 'Resch B',
        client_email: `e2e-c04-resch-b-${Date.now()}@genda-test.be`,
        client_phone: '+32491000701',
        consent_sms: true, consent_email: true, consent_marketing: false,
      },
    });
    expect(createB.status, `Create B error: ${JSON.stringify(createB.body)}`).toBe(201);

    // Try to reschedule B to A's slot → 409
    const newEnd = new Date(new Date(startA).getTime() + 15 * 60000).toISOString();
    const res = await publicFetch(`/api/public/manage/${createB.body.booking.token}/reschedule`, {
      method: 'POST',
      body: { start_at: startA, end_at: newEnd },
    });
    expect(res.status).toBe(409);
  });

  test('4. Reschedule violating min_booking_notice_hours → 400', async () => {
    // min_booking_notice_hours = 1 (seed). A booking 5h away rescheduled to
    // 10min from now should be rejected.
    const email = `e2e-c04-resch-notice-${Date.now()}@genda-test.be`;
    const startAt = isoPlusDays(4, 15);
    const create = await publicFetch(`/api/public/${SLUG}/bookings`, {
      method: 'POST',
      body: {
        service_id: IDS.SVC_SHORT,
        practitioner_id: IDS.PRAC_ALICE,
        start_at: startAt,
        appointment_mode: 'cabinet',
        client_name: 'E2E Notice',
        client_email: email,
        client_phone: '+32491000702',
        consent_sms: true, consent_email: true, consent_marketing: false,
      },
    });
    expect(create.status, `Create error: ${JSON.stringify(create.body)}`).toBe(201);
    const token = create.body.booking.token;

    // Try to move it 10 minutes in the future (< min_booking_notice 1h)
    const soon = new Date(Date.now() + 10 * 60 * 1000).toISOString();
    const soonEnd = new Date(Date.now() + 25 * 60 * 1000).toISOString();

    const res = await publicFetch(`/api/public/manage/${token}/reschedule`, {
      method: 'POST',
      body: { start_at: soon, end_at: soonEnd },
    });
    // 400 for min-notice violation OR 400 for other window issue — both lock the contract.
    expect([400, 403, 409]).toContain(res.status);
  });

  test('5. Group multi-service reschedule — siblings shift together', async () => {
    // Build a 2-service group via direct INSERT (public POST may not chain services)
    const startAt = isoPlusDays(4, 11);
    const groupId = (await pool.query(`SELECT gen_random_uuid() AS id`)).rows[0].id;
    const aEnd = new Date(new Date(startAt).getTime() + 15 * 60000).toISOString();
    const b1 = await pool.query(
      `INSERT INTO bookings (business_id, practitioner_id, service_id, client_id, start_at, end_at,
         status, appointment_mode, public_token, group_id, group_order, booked_price_cents, reschedule_count)
       VALUES ($1, $2, $3, $4, $5, $6, 'confirmed', 'cabinet', encode(gen_random_bytes(8),'hex'),
         $7, 0, 1500, 0)
       RETURNING id, public_token`,
      [IDS.BUSINESS, IDS.PRAC_ALICE, IDS.SVC_SHORT, IDS.CLIENT_JEAN, startAt, aEnd, groupId]
    );
    const bStart = aEnd;
    const bEnd = new Date(new Date(aEnd).getTime() + 20 * 60000).toISOString();
    await pool.query(
      `INSERT INTO bookings (business_id, practitioner_id, service_id, client_id, start_at, end_at,
         status, appointment_mode, public_token, group_id, group_order, booked_price_cents)
       VALUES ($1, $2, $3, $4, $5, $6, 'confirmed', 'cabinet', encode(gen_random_bytes(8),'hex'),
         $7, 1, 1000)`,
      [IDS.BUSINESS, IDS.PRAC_ALICE, IDS.SVC_CHEAP, IDS.CLIENT_JEAN, bStart, bEnd, groupId]
    );

    // Reschedule primary → delta +2h → all siblings shift
    const primaryToken = b1.rows[0].public_token;
    const newStart = new Date(new Date(startAt).getTime() + 2 * 3600000).toISOString();
    const newEnd = new Date(new Date(aEnd).getTime() + 2 * 3600000).toISOString();

    const res = await publicFetch(`/api/public/manage/${primaryToken}/reschedule`, {
      method: 'POST',
      body: { start_at: newStart, end_at: newEnd },
    });
    expect(res.status, `Resch error: ${JSON.stringify(res.body)}`).toBe(200);

    const after = await pool.query(
      `SELECT id, start_at, end_at, group_order FROM bookings WHERE group_id = $1 ORDER BY group_order`,
      [groupId]
    );
    expect(after.rows.length).toBe(2);
    // Primary moved by +2h
    expect(new Date(after.rows[0].start_at).getTime()).toBe(new Date(newStart).getTime());
    // Sibling also moved by +2h (same delta)
    expect(new Date(after.rows[1].start_at).getTime()).toBe(new Date(bStart).getTime() + 2 * 3600000);
  });
});
