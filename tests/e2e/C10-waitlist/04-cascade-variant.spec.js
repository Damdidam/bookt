const { test, expect } = require('@playwright/test');
const IDS = require('../fixtures/ids');
const { publicFetch } = require('../fixtures/api-client');
const { resetMutables } = require('../fixtures/reset-mutables');
const { pool } = require('../../../src/services/db');

/**
 * C10 spec 04 — Cascade variant : decline cascade respecte service_variant_id
 * et service_variants.is_active.
 *
 * Scénarios couverts :
 * 1. Entry variant X decline → entry NULL ou variant X reçoit cascade
 * 2. Entry variant X decline → entry variant Y PAS de cascade
 * 3. Entry variant désactivé (sv.is_active=false) en queue → exclu de la cascade
 */
test.describe('C10 — waitlist cascade variant', () => {
  test.beforeEach(async () => {
    await resetMutables();
    await pool.query(
      `DELETE FROM waitlist_entries WHERE business_id = $1
       AND id NOT IN (SELECT entity_id FROM seed_tracking WHERE entity_type = 'waitlist_entry')`,
      [IDS.BUSINESS]
    );
    // Ensure all variants are active by default (some tests deactivate + restore)
    await pool.query(
      `UPDATE service_variants SET is_active = true WHERE service_id = $1`,
      [IDS.SVC_VARIANTS]
    );
  });

  async function createEntry({ email, variantId, priority }) {
    const r = await pool.query(
      `INSERT INTO waitlist_entries (id, business_id, practitioner_id, service_id,
         service_variant_id, client_name, client_email, preferred_days, preferred_time,
         priority, status)
       VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7::jsonb, 'any', $8, 'waiting')
       RETURNING id`,
      [IDS.BUSINESS, IDS.PRAC_ALICE, IDS.SVC_VARIANTS, variantId || null,
       'WL ' + email, email, JSON.stringify([0,1,2,3,4,5,6]), priority]
    );
    return r.rows[0].id;
  }

  async function createOfferedEntry({ email, variantId, priority }) {
    const token = 'c10-variant-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7);
    const start = new Date(Date.now() + 7 * 86400000);
    start.setHours(10, 0, 0, 0);
    const end = new Date(start.getTime() + 120 * 60000);
    const expires = new Date(Date.now() + 2 * 3600000);
    const r = await pool.query(
      `INSERT INTO waitlist_entries (id, business_id, practitioner_id, service_id,
         service_variant_id, client_name, client_email, preferred_days, preferred_time,
         priority, status, offer_token, offer_expires_at, offer_booking_start, offer_booking_end)
       VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7::jsonb, 'any', $8, 'offered',
               $9, $10, $11, $12)
       RETURNING id, offer_token`,
      [IDS.BUSINESS, IDS.PRAC_ALICE, IDS.SVC_VARIANTS, variantId || null,
       'WL ' + email, email, JSON.stringify([0,1,2,3,4,5,6]), priority,
       token, expires.toISOString(), start.toISOString(), end.toISOString()]
    );
    return r.rows[0];
  }

  test('1. decline entry variant X → next entry variant X reçoit cascade', async () => {
    // Offered: variant 60min, priority 1
    const offered = await createOfferedEntry({
      email: `c10var-offered-60-${Date.now()}@genda-test.be`,
      variantId: IDS.VAR_60MIN, priority: 1,
    });
    // Waiting: variant 60min, priority 2 (should be offered next)
    const nextId = await createEntry({
      email: `c10var-next-60-${Date.now()}@genda-test.be`,
      variantId: IDS.VAR_60MIN, priority: 2,
    });
    const { status } = await publicFetch(`/api/public/waitlist/${offered.offer_token}/decline`, {
      method: 'POST', body: {}
    });
    expect([200, 204]).toContain(status);
    const r = await pool.query(`SELECT status FROM waitlist_entries WHERE id = $1`, [nextId]);
    expect(r.rows[0].status).toBe('offered');
  });

  test('2. decline entry variant X → next entry variant Y reste waiting (pas cascade)', async () => {
    const offered = await createOfferedEntry({
      email: `c10var-offered-x-${Date.now()}@genda-test.be`,
      variantId: IDS.VAR_60MIN, priority: 1,
    });
    // Waiting: variant 90min (DIFFERENT), priority 2 → must NOT be cascaded
    const nextWrongId = await createEntry({
      email: `c10var-next-y-${Date.now()}@genda-test.be`,
      variantId: IDS.VAR_90MIN, priority: 2,
    });
    const { status } = await publicFetch(`/api/public/waitlist/${offered.offer_token}/decline`, {
      method: 'POST', body: {}
    });
    expect([200, 204]).toContain(status);
    const r = await pool.query(`SELECT status FROM waitlist_entries WHERE id = $1`, [nextWrongId]);
    expect(r.rows[0].status).toBe('waiting');
  });

  test('3. decline entry variant X → next entry variant désactivé exclu', async () => {
    // Deactivate 90min variant
    await pool.query(`UPDATE service_variants SET is_active = false WHERE id = $1`, [IDS.VAR_90MIN]);

    const offered = await createOfferedEntry({
      email: `c10var-offered-disabled-${Date.now()}@genda-test.be`,
      variantId: IDS.VAR_90MIN, priority: 1,
    });
    // Waiting entry variant 90min (deactivated) — must NOT cascade
    const deactivatedId = await createEntry({
      email: `c10var-disabled-${Date.now()}@genda-test.be`,
      variantId: IDS.VAR_90MIN, priority: 2,
    });
    const { status } = await publicFetch(`/api/public/waitlist/${offered.offer_token}/decline`, {
      method: 'POST', body: {}
    });
    expect([200, 204]).toContain(status);
    const r = await pool.query(`SELECT status FROM waitlist_entries WHERE id = $1`, [deactivatedId]);
    expect(r.rows[0].status).toBe('waiting');

    // Cleanup (beforeEach also handles this, but belt and suspenders)
    await pool.query(`UPDATE service_variants SET is_active = true WHERE id = $1`, [IDS.VAR_90MIN]);
  });

  test('4. decline entry variant NULL → cascade à entry variant NULL uniquement (conservateur)', async () => {
    const offered = await createOfferedEntry({
      email: `c10var-offered-null-${Date.now()}@genda-test.be`,
      variantId: null, priority: 1,
    });
    // Waiting: variant NULL, priority 2 → should cascade
    const nextNullId = await createEntry({
      email: `c10var-next-null-${Date.now()}@genda-test.be`,
      variantId: null, priority: 2,
    });
    // Waiting: variant X, priority 3 → should NOT cascade (proxy rule: slot variant unknown)
    const nextXId = await createEntry({
      email: `c10var-next-x-${Date.now()}@genda-test.be`,
      variantId: IDS.VAR_60MIN, priority: 3,
    });
    const { status } = await publicFetch(`/api/public/waitlist/${offered.offer_token}/decline`, {
      method: 'POST', body: {}
    });
    expect([200, 204]).toContain(status);
    const rNull = await pool.query(`SELECT status FROM waitlist_entries WHERE id = $1`, [nextNullId]);
    const rX = await pool.query(`SELECT status FROM waitlist_entries WHERE id = $1`, [nextXId]);
    expect(rNull.rows[0].status).toBe('offered');
    expect(rX.rows[0].status).toBe('waiting');
  });
});
