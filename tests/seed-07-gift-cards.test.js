require('dotenv').config();
const assert = require('assert');
const { pool } = require('../src/services/db');
const { seedBusiness } = require('./e2e/fixtures/seeds/01-business');
const { seedGiftCards } = require('./e2e/fixtures/seeds/07-gift-cards');
const IDS = require('./e2e/fixtures/ids');

(async () => {
  await seedBusiness();
  await seedGiftCards();

  const r = await pool.query(`SELECT id, status, balance_cents FROM gift_cards WHERE business_id = $1`, [IDS.BUSINESS]);
  assert(r.rows.length === 4, `FAIL: expected 4 GC (got ${r.rows.length})`);

  const expired = r.rows.find(g => g.id === IDS.GC_EXPIRED);
  assert(expired?.status === 'expired', `FAIL: GC_EXPIRED status should be 'expired' (got ${expired?.status})`);
  const cancelled = r.rows.find(g => g.id === IDS.GC_CANCELLED);
  assert(cancelled?.status === 'cancelled', `FAIL: GC_CANCELLED status should be 'cancelled' (got ${cancelled?.status})`);
  const partial = r.rows.find(g => g.id === IDS.GC_PARTIAL);
  assert(partial?.balance_cents === 5000, `FAIL: GC_PARTIAL balance should be 5000 (got ${partial?.balance_cents})`);

  console.log('✓ 4 GC seeded (active/partial/expired/cancelled)');

  await seedGiftCards();
  const r2 = await pool.query(`SELECT COUNT(*) AS c FROM gift_cards WHERE business_id = $1`, [IDS.BUSINESS]);
  assert(parseInt(r2.rows[0].c) === 4, 'FAIL: idempotence');
  console.log('✓ idempotent');

  console.log('\n✓ seed-07 OK');
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
