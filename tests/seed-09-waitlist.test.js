require('dotenv').config();
const assert = require('assert');
const { pool } = require('../src/services/db');
const { seedBusiness } = require('./e2e/fixtures/seeds/01-business');
const { seedPractitioners } = require('./e2e/fixtures/seeds/02-practitioners');
const { seedServices } = require('./e2e/fixtures/seeds/03-services');
const { seedWaitlist } = require('./e2e/fixtures/seeds/09-waitlist');
const IDS = require('./e2e/fixtures/ids');

(async () => {
  await seedBusiness();
  await seedPractitioners();
  await seedServices();
  await seedWaitlist();

  const r = await pool.query(`SELECT id, preferred_days, preferred_time, priority FROM waitlist_entries WHERE business_id = $1`, [IDS.BUSINESS]);
  assert(r.rows.length === 2, `FAIL: expected 2 waitlist entries (got ${r.rows.length})`);

  const marie = r.rows.find(w => w.id === IDS.WL_MARIE);
  assert(marie, 'FAIL: WL_MARIE missing');
  assert(Array.isArray(marie.preferred_days) && marie.preferred_days.length === 0,
    `FAIL: WL_MARIE preferred_days should be [] (got ${JSON.stringify(marie.preferred_days)})`);
  assert(marie.preferred_time === 'any', `FAIL: WL_MARIE preferred_time should be 'any' (got ${marie.preferred_time})`);

  const jean = r.rows.find(w => w.id === IDS.WL_JEAN);
  assert(jean, 'FAIL: WL_JEAN missing');
  assert(Array.isArray(jean.preferred_days) && jean.preferred_days.length === 5,
    `FAIL: WL_JEAN preferred_days should have 5 items (got ${JSON.stringify(jean.preferred_days)})`);

  console.log('✓ 2 waitlist entries seeded, WL_MARIE preferred_days=[]');

  await seedWaitlist();
  const r2 = await pool.query(`SELECT COUNT(*) AS c FROM waitlist_entries WHERE business_id = $1`, [IDS.BUSINESS]);
  assert(parseInt(r2.rows[0].c) === 2, 'FAIL: idempotence');
  console.log('✓ idempotent');

  console.log('\n✓ seed-09 OK');
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
