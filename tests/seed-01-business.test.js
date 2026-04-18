require('dotenv').config();
const assert = require('assert');
const { pool } = require('../src/services/db');
const { seedBusiness } = require('./e2e/fixtures/seeds/01-business');
const IDS = require('./e2e/fixtures/ids');

(async () => {
  await seedBusiness();

  const r = await pool.query(`SELECT id, is_test_account, slug FROM businesses WHERE id = $1`, [IDS.BUSINESS]);
  assert(r.rows.length === 1, 'FAIL: business not found');
  assert(r.rows[0].is_test_account === true, 'FAIL: is_test_account !== true');
  assert(r.rows[0].slug === 'test-demo-salon', 'FAIL: slug mismatch');
  console.log('✓ business seed valide');

  await seedBusiness();
  const r2 = await pool.query(`SELECT COUNT(*) AS c FROM businesses WHERE id = $1`, [IDS.BUSINESS]);
  assert(parseInt(r2.rows[0].c) === 1, 'FAIL: idempotence broken');
  console.log('✓ idempotent');

  console.log('\n✓ seed-01 OK');
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
