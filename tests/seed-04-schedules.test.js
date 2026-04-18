require('dotenv').config();
const assert = require('assert');
const { pool } = require('../src/services/db');
const { seedBusiness } = require('./e2e/fixtures/seeds/01-business');
const { seedPractitioners } = require('./e2e/fixtures/seeds/02-practitioners');
const { seedSchedules } = require('./e2e/fixtures/seeds/04-schedules');
const IDS = require('./e2e/fixtures/ids');

(async () => {
  await seedBusiness(); await seedPractitioners(); await seedSchedules();
  const b = await pool.query(`SELECT COUNT(*) AS c FROM business_schedule WHERE business_id = $1`, [IDS.BUSINESS]);
  assert(parseInt(b.rows[0].c) >= 5, `FAIL: expected >=5 biz hours (got ${b.rows[0].c})`);
  const a = await pool.query(`SELECT COUNT(*) AS c FROM availabilities WHERE practitioner_id = $1`, [IDS.PRAC_ALICE]);
  assert(parseInt(a.rows[0].c) >= 5, `FAIL: expected >=5 Alice hours (got ${a.rows[0].c})`);
  console.log('✓ schedules seeded');

  // Idempotence
  await seedSchedules();
  const b2 = await pool.query(`SELECT COUNT(*) AS c FROM business_schedule WHERE business_id = $1`, [IDS.BUSINESS]);
  assert(parseInt(b2.rows[0].c) === 6, `FAIL: idempotence biz (got ${b2.rows[0].c})`);
  const a2 = await pool.query(`SELECT COUNT(*) AS c FROM availabilities WHERE practitioner_id = $1`, [IDS.PRAC_ALICE]);
  assert(parseInt(a2.rows[0].c) === 5, `FAIL: idempotence Alice (got ${a2.rows[0].c})`);
  const bobN = await pool.query(`SELECT COUNT(*) AS c FROM availabilities WHERE practitioner_id = $1`, [IDS.PRAC_BOB]);
  assert(parseInt(bobN.rows[0].c) === 5, `FAIL: Bob hours (got ${bobN.rows[0].c})`);
  const carolN = await pool.query(`SELECT COUNT(*) AS c FROM availabilities WHERE practitioner_id = $1`, [IDS.PRAC_CAROL]);
  assert(parseInt(carolN.rows[0].c) === 4, `FAIL: Carol hours (got ${carolN.rows[0].c})`);
  console.log('✓ idempotent (biz=6, Alice=5, Bob=5, Carol=4)');
  console.log('\n✓ seed-04 OK');
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
