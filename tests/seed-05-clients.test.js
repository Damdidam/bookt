require('dotenv').config();
const assert = require('assert');
const { pool } = require('../src/services/db');
const { seedBusiness } = require('./e2e/fixtures/seeds/01-business');
const { seedClients } = require('./e2e/fixtures/seeds/05-clients');
const IDS = require('./e2e/fixtures/ids');

(async () => {
  await seedBusiness();
  await seedClients();
  const r = await pool.query(`SELECT id, full_name, is_vip FROM clients WHERE business_id = $1`, [IDS.BUSINESS]);
  assert(r.rows.length === 3, `FAIL: expected 3 clients (got ${r.rows.length})`);
  const paul = r.rows.find(c => c.id === IDS.CLIENT_PAUL);
  assert(paul?.is_vip === true, 'FAIL: Paul not VIP');
  console.log('✓ 3 clients seeded, Paul VIP');

  await seedClients();
  const r2 = await pool.query(`SELECT COUNT(*) AS c FROM clients WHERE business_id = $1`, [IDS.BUSINESS]);
  assert(parseInt(r2.rows[0].c) === 3, `FAIL: idempotence (got ${r2.rows[0].c})`);
  console.log('✓ idempotent');

  console.log('\n✓ seed-05 OK');
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
