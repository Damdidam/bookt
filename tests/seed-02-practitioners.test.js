require('dotenv').config();
const assert = require('assert');
const { pool } = require('../src/services/db');
const { seedBusiness } = require('./e2e/fixtures/seeds/01-business');
const { seedPractitioners } = require('./e2e/fixtures/seeds/02-practitioners');
const IDS = require('./e2e/fixtures/ids');

(async () => {
  await seedBusiness();
  await seedPractitioners();
  const r = await pool.query(`SELECT id, display_name FROM practitioners WHERE business_id = $1`, [IDS.BUSINESS]);
  assert(r.rows.length === 3, `FAIL: expected 3 pracs (got ${r.rows.length})`);
  const alice = r.rows.find(p => p.id === IDS.PRAC_ALICE);
  assert(alice, 'FAIL: Alice not found');
  console.log('✓ 3 practitioners seeded');

  await seedPractitioners();
  const r2 = await pool.query(`SELECT COUNT(*) AS c FROM practitioners WHERE business_id = $1`, [IDS.BUSINESS]);
  assert(parseInt(r2.rows[0].c) === 3, `FAIL: idempotence (got ${r2.rows[0].c})`);
  console.log('✓ idempotent');
  console.log('\n✓ seed-02 OK');
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
