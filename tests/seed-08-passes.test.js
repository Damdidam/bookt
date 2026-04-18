require('dotenv').config();
const assert = require('assert');
const { pool } = require('../src/services/db');
const { seedBusiness } = require('./e2e/fixtures/seeds/01-business');
const { seedPractitioners } = require('./e2e/fixtures/seeds/02-practitioners');
const { seedServices } = require('./e2e/fixtures/seeds/03-services');
const { seedPasses } = require('./e2e/fixtures/seeds/08-passes');
const IDS = require('./e2e/fixtures/ids');

(async () => {
  await seedBusiness();
  await seedPractitioners();
  await seedServices();
  await seedPasses();

  const r = await pool.query(`SELECT id, status, sessions_remaining FROM passes WHERE business_id = $1`, [IDS.BUSINESS]);
  assert(r.rows.length === 3, `FAIL: expected 3 passes (got ${r.rows.length})`);

  const empty = r.rows.find(p => p.id === IDS.PASS_EMPTY);
  assert(empty?.sessions_remaining === 0, `FAIL: PASS_EMPTY.sessions_remaining should be 0 (got ${empty?.sessions_remaining})`);
  assert(empty?.status === 'used', `FAIL: PASS_EMPTY.status should be 'used' (got ${empty?.status})`);

  const expired = r.rows.find(p => p.id === IDS.PASS_EXPIRED);
  assert(expired?.status === 'active', `FAIL: PASS_EXPIRED.status should be 'active' (got ${expired?.status})`);

  console.log('✓ 3 passes seeded (active/expired/empty)');

  await seedPasses();
  const r2 = await pool.query(`SELECT COUNT(*) AS c FROM passes WHERE business_id = $1`, [IDS.BUSINESS]);
  assert(parseInt(r2.rows[0].c) === 3, 'FAIL: idempotence');
  console.log('✓ idempotent');

  console.log('\n✓ seed-08 OK');
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
