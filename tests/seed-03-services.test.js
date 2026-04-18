require('dotenv').config();
const assert = require('assert');
const { pool } = require('../src/services/db');
const { seedBusiness } = require('./e2e/fixtures/seeds/01-business');
const { seedPractitioners } = require('./e2e/fixtures/seeds/02-practitioners');
const { seedServices } = require('./e2e/fixtures/seeds/03-services');
const IDS = require('./e2e/fixtures/ids');

(async () => {
  await seedBusiness(); await seedPractitioners(); await seedServices();
  const r = await pool.query(`SELECT id, quote_only, promo_eligible FROM services WHERE business_id = $1`, [IDS.BUSINESS]);
  assert(r.rows.length === 7, `FAIL: expected 7 services (got ${r.rows.length})`);
  const q = r.rows.find(s => s.id === IDS.SVC_QUOTE);
  assert(q?.quote_only === true, 'FAIL: SVC_QUOTE not quote_only');
  const c = r.rows.find(s => s.id === IDS.SVC_CHEAP);
  assert(c?.promo_eligible === false, 'FAIL: SVC_CHEAP promo_eligible !== false');
  console.log('✓ 7 services, quote/promo flags correct');

  const v = await pool.query(`SELECT id FROM service_variants WHERE service_id = $1`, [IDS.SVC_VARIANTS]);
  assert(v.rows.length === 3, `FAIL: expected 3 variants (got ${v.rows.length})`);
  console.log('✓ 3 variants for SVC_VARIANTS');

  // Idempotence
  await seedServices();
  const r2 = await pool.query(`SELECT COUNT(*) AS c FROM services WHERE business_id = $1`, [IDS.BUSINESS]);
  assert(parseInt(r2.rows[0].c) === 7, `FAIL: idempotence services (got ${r2.rows[0].c})`);
  const v2 = await pool.query(`SELECT COUNT(*) AS c FROM service_variants WHERE service_id = $1`, [IDS.SVC_VARIANTS]);
  assert(parseInt(v2.rows[0].c) === 3, `FAIL: idempotence variants (got ${v2.rows[0].c})`);
  const ps = await pool.query(`SELECT COUNT(*) AS c FROM practitioner_services WHERE practitioner_id IN ($1, $2, $3)`, [IDS.PRAC_ALICE, IDS.PRAC_BOB, IDS.PRAC_CAROL]);
  assert(parseInt(ps.rows[0].c) === 13, `FAIL: expected 13 prac_services links (got ${ps.rows[0].c})`);
  console.log('✓ idempotent + 13 prac_services links');
  console.log('\n✓ seed-03 OK');
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
