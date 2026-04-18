require('dotenv').config();
const assert = require('assert');
const { pool } = require('../src/services/db');
const { seedBusiness } = require('./e2e/fixtures/seeds/01-business');
const { seedServices } = require('./e2e/fixtures/seeds/03-services');
const { seedPromotions } = require('./e2e/fixtures/seeds/06-promotions');
const IDS = require('./e2e/fixtures/ids');

(async () => {
  await seedBusiness();
  await seedServices();
  await seedPromotions();

  const r = await pool.query(`SELECT id, reward_type FROM promotions WHERE business_id = $1`, [IDS.BUSINESS]);
  assert(r.rows.length === 7, `FAIL: expected 7 promos (got ${r.rows.length})`);
  const types = new Set(r.rows.map(p => p.reward_type));
  ['discount_pct','discount_fixed','free_service','info_only'].forEach(t => {
    assert(types.has(t), `FAIL: missing ${t}`);
  });
  console.log('✓ 7 promos seeded, 4 types present');

  await seedPromotions();
  const r2 = await pool.query(`SELECT COUNT(*) AS c FROM promotions WHERE business_id = $1`, [IDS.BUSINESS]);
  assert(parseInt(r2.rows[0].c) === 7, 'FAIL: idempotence');
  console.log('✓ idempotent');

  console.log('\n✓ seed-06 OK');
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
