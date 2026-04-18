require('dotenv').config();
const assert = require('assert');
const { pool } = require('../src/services/db');
const { seedAll } = require('./e2e/fixtures/seed');
const IDS = require('./e2e/fixtures/ids');

(async () => {
  const t0 = Date.now();
  await seedAll();
  console.log(`✓ full seed in ${Date.now() - t0}ms`);

  const checks = [
    { sql: `SELECT 1 FROM businesses WHERE id = $1 AND is_test_account = true`, id: IDS.BUSINESS, name: 'business' },
    { sql: `SELECT 1 FROM practitioners WHERE id = $1`, id: IDS.PRAC_ALICE, name: 'Alice' },
    { sql: `SELECT 1 FROM services WHERE id = $1`, id: IDS.SVC_LONG, name: 'SVC_LONG' },
    { sql: `SELECT 1 FROM clients WHERE id = $1`, id: IDS.CLIENT_JEAN, name: 'Jean' },
    { sql: `SELECT 1 FROM promotions WHERE id = $1`, id: IDS.PROMO_PCT, name: 'PROMO_PCT' },
    { sql: `SELECT 1 FROM gift_cards WHERE id = $1`, id: IDS.GC_ACTIVE, name: 'GC_ACTIVE' },
    { sql: `SELECT 1 FROM passes WHERE id = $1`, id: IDS.PASS_ACTIVE, name: 'PASS_ACTIVE' },
    { sql: `SELECT 1 FROM waitlist_entries WHERE id = $1`, id: IDS.WL_JEAN, name: 'WL_JEAN' },
    { sql: `SELECT 1 FROM bookings WHERE id = $1`, id: IDS.BK_COMPLETED_1, name: 'BK_COMPLETED_1' },
  ];
  for (const c of checks) {
    const r = await pool.query(c.sql, [c.id]);
    assert(r.rows.length === 1, `FAIL: ${c.name} missing`);
    console.log(`  ✓ ${c.name}`);
  }

  await seedAll();
  console.log('✓ full seed idempotent');
  console.log('\n✓ seed-orchestrator OK');
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
