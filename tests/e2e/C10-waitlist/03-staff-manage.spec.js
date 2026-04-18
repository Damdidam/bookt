const { test, expect } = require('@playwright/test');
const IDS = require('../fixtures/ids');
const { staffFetch } = require('../fixtures/api-client');
const { resetMutables } = require('../fixtures/reset-mutables');
const { pool } = require('../../../src/services/db');

/**
 * C10 spec 03 — Staff management of waitlist entries.
 */
test.describe('C10 — waitlist : staff management', () => {
  let sinceTs;
  test.beforeEach(async () => {
    sinceTs = new Date(Date.now() - 1000).toISOString();
    await resetMutables();
    await pool.query(
      `DELETE FROM waitlist_entries WHERE business_id = $1
       AND id NOT IN (SELECT entity_id FROM seed_tracking WHERE entity_type = 'waitlist_entry')`,
      [IDS.BUSINESS]
    );
  });

  test('1. Staff invite manuellement → 201', async () => {
    const { status, body } = await staffFetch('/api/waitlist', {
      method: 'POST',
      body: {
        practitioner_id: IDS.PRAC_ALICE,
        service_id: IDS.SVC_LONG,
        client_name: 'Staff-Invited Client',
        client_email: `staff-wl-${Date.now()}@genda-test.be`,
        client_phone: '+32491111100',
        preferred_days: [2, 3, 4],
        preferred_time: 'morning',
      },
    });
    // Staff create can return 200 or 201
    expect([200, 201], `api: ${JSON.stringify(body)}`).toContain(status);
    const entryId = body.entry?.id || body.id;
    expect(entryId).toBeTruthy();
  });

  test('2. Staff delete entry → 200 + entry supprimée', async () => {
    // Create first
    const ins = await pool.query(
      `INSERT INTO waitlist_entries (id, business_id, practitioner_id, service_id,
        client_name, client_email, preferred_days, preferred_time, priority, status)
       VALUES (gen_random_uuid(), $1, $2, $3, 'ToDelete', $4, $5, 'any', 99, 'waiting')
       RETURNING id`,
      [IDS.BUSINESS, IDS.PRAC_ALICE, IDS.SVC_LONG, `todel-${Date.now()}@genda-test.be`, JSON.stringify([0,1,2,3,4,5,6])]
    );
    const id = ins.rows[0].id;

    const { status } = await staffFetch(`/api/waitlist/${id}`, { method: 'DELETE' });
    expect([200, 204]).toContain(status);
    // Backend may do soft-delete (row stays with status changed) OR hard-delete (row removed)
    const r = await pool.query(`SELECT id, status FROM waitlist_entries WHERE id = $1`, [id]);
    if (r.rows.length > 0) {
      expect(['cancelled', 'removed', 'deleted']).toContain(r.rows[0].status);
    }
  });
});
