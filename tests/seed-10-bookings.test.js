require('dotenv').config();
const assert = require('assert');
const { pool } = require('../src/services/db');
const { seedBusiness } = require('./e2e/fixtures/seeds/01-business');
const { seedPractitioners } = require('./e2e/fixtures/seeds/02-practitioners');
const { seedServices } = require('./e2e/fixtures/seeds/03-services');
const { seedClients } = require('./e2e/fixtures/seeds/05-clients');
const { seedBookingsHistorique } = require('./e2e/fixtures/seeds/10-bookings-historique');
const IDS = require('./e2e/fixtures/ids');

(async () => {
  await seedBusiness();
  await seedPractitioners();
  await seedServices();
  await seedClients();
  await seedBookingsHistorique();

  const r = await pool.query(`SELECT id, status FROM bookings WHERE business_id = $1`, [IDS.BUSINESS]);
  assert(r.rows.length === 5, `FAIL: expected 5 (got ${r.rows.length})`);
  const statuses = r.rows.map(b => b.status).sort();
  assert(statuses.includes('completed'), 'FAIL: missing completed');
  assert(statuses.includes('no_show'), 'FAIL: missing no_show');
  assert(statuses.includes('cancelled'), 'FAIL: missing cancelled');
  console.log('✓ 5 bookings historiques seeded');

  await seedBookingsHistorique();
  const r2 = await pool.query(`SELECT COUNT(*) AS c FROM bookings WHERE business_id = $1`, [IDS.BUSINESS]);
  assert(parseInt(r2.rows[0].c) === 5, 'FAIL: idempotence');
  console.log('✓ idempotent');

  console.log('\n✓ seed-10 OK');
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
