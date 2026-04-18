const { pool } = require('../../../../src/services/db');
const IDS = require('../ids');

/**
 * 2 entrées waitlist:
 * - WL_JEAN:  prac Alice, svc SVC_LONG, preferred_days=[1..5], preferred_time=afternoon, priority=1
 * - WL_MARIE: prac Bob,   svc SVC_SHORT, preferred_days=[] (any day), preferred_time=any, priority=2
 *
 * Schema-adapted: la table stocke client_name/client_email (pas client_id FK).
 * preferred_days est JSONB.
 */
const ENTRIES = [
  {
    id: IDS.WL_JEAN, practitioner_id: IDS.PRAC_ALICE, service_id: IDS.SVC_LONG,
    client_name: 'Jean Testeur', client_email: 'jean-test@genda-test.be', client_phone: '+32491000001',
    preferred_days: [1, 2, 3, 4, 5], preferred_time: 'afternoon', priority: 1,
  },
  {
    id: IDS.WL_MARIE, practitioner_id: IDS.PRAC_BOB, service_id: IDS.SVC_SHORT,
    client_name: 'Marie Regular', client_email: 'marie-test@genda-test.be', client_phone: '+32491000002',
    preferred_days: [], preferred_time: 'any', priority: 2,
  },
];

async function seedWaitlist() {
  for (const e of ENTRIES) {
    await pool.query(`
      INSERT INTO waitlist_entries (
        id, business_id, practitioner_id, service_id,
        client_name, client_email, client_phone,
        preferred_days, preferred_time, priority, status
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10, 'waiting')
      ON CONFLICT (id) DO UPDATE SET
        practitioner_id = EXCLUDED.practitioner_id,
        service_id = EXCLUDED.service_id,
        client_name = EXCLUDED.client_name,
        client_email = EXCLUDED.client_email,
        client_phone = EXCLUDED.client_phone,
        preferred_days = EXCLUDED.preferred_days,
        preferred_time = EXCLUDED.preferred_time,
        priority = EXCLUDED.priority,
        status = 'waiting',
        updated_at = NOW()
    `, [
      e.id, IDS.BUSINESS, e.practitioner_id, e.service_id,
      e.client_name, e.client_email, e.client_phone,
      JSON.stringify(e.preferred_days), e.preferred_time, e.priority,
    ]);

    await pool.query(`INSERT INTO seed_tracking (entity_type, entity_id) VALUES ('waitlist_entry', $1) ON CONFLICT DO NOTHING`, [e.id]);
  }
}

module.exports = { seedWaitlist, ENTRIES };

if (require.main === module) {
  seedWaitlist().then(() => { console.log('✓ 2 waitlist entries seeded'); process.exit(0); }).catch(e => { console.error(e); process.exit(1); });
}
