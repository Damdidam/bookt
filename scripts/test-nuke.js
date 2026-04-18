#!/usr/bin/env node
require('dotenv').config({ path: '.env.test' });
const readline = require('readline');
const { pool } = require('../src/services/db');
const IDS = require('../tests/e2e/fixtures/ids');

function ask(q) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(res => rl.question(q, ans => { rl.close(); res(ans); }));
}

(async () => {
  const bid = IDS.BUSINESS;
  const check = await pool.query(`SELECT name, is_test_account FROM businesses WHERE id = $1`, [bid]);
  if (check.rows.length === 0) { console.log('TEST business already absent.'); process.exit(0); }
  if (!check.rows[0].is_test_account) { console.error('ABORT: not a test account'); process.exit(1); }

  console.log(`\n⚠️  NUCLEAR NUKE: DELETE business "${check.rows[0].name}" + ALL data`);
  const ans1 = await ask('Type "NUKE" to confirm (1/2): ');
  if (ans1.trim() !== 'NUKE') { console.log('Cancelled.'); process.exit(0); }
  const ans2 = await ask('Type "NUKE" again to confirm (2/2): ');
  if (ans2.trim() !== 'NUKE') { console.log('Cancelled.'); process.exit(0); }

  await pool.query('BEGIN');
  try {
    const order = [
      'gift_card_transactions', 'pass_transactions', 'invoice_items', 'invoices',
      'notifications', 'bookings', 'waitlist_entries', 'gift_cards', 'passes',
      'audit_logs', 'clients', 'practitioner_services', 'service_variants', 'services',
      'promotions', 'availabilities', 'business_schedule', 'practitioners'
    ];
    for (const t of order) {
      try {
        await pool.query(`DELETE FROM ${t} WHERE business_id = $1`, [bid]);
      } catch (e) { console.warn(`[NUKE] ${t}: ${e.message}`); }
    }
    await pool.query(`DELETE FROM users WHERE id IN ($1, $2, $3)`,
      [IDS.USER_ALICE_OWNER, IDS.USER_BOB_STAFF, IDS.USER_CAROL_STAFF]);
    await pool.query(`DELETE FROM businesses WHERE id = $1`, [bid]);
    await pool.query(`DELETE FROM seed_tracking`);
    await pool.query(`DELETE FROM test_mock_log`);
    await pool.query('COMMIT');
    console.log('\n✓ Nuke complete. Run `npm run test:e2e:bootstrap` to recreate.');
  } catch (e) {
    await pool.query('ROLLBACK');
    console.error('Nuke failed:', e.message);
    process.exit(1);
  }
  await pool.end();
})();
