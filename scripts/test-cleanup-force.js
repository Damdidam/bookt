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
  if (check.rows.length === 0) { console.error('TEST business not found'); process.exit(1); }
  if (!check.rows[0].is_test_account) { console.error('ABORT: not a test account'); process.exit(1); }

  console.log(`\nBusiness: ${check.rows[0].name}`);
  console.log('This will DELETE ALL bookings/invoices/GCs/passes/waitlist data EXCEPT the seed.');
  const ans = await ask('\nConfirm [yes/no]: ');
  if (ans.trim().toLowerCase() !== 'yes') { console.log('Cancelled.'); process.exit(0); }

  const queries = [
    `DELETE FROM gift_card_transactions WHERE business_id = $1`,
    `DELETE FROM pass_transactions WHERE business_id = $1`,
    `DELETE FROM invoice_items WHERE invoice_id IN (SELECT id FROM invoices WHERE business_id = $1 AND id NOT IN (SELECT entity_id FROM seed_tracking WHERE entity_id IS NOT NULL))`,
    `DELETE FROM invoices WHERE business_id = $1 AND id NOT IN (SELECT entity_id FROM seed_tracking WHERE entity_id IS NOT NULL)`,
    `DELETE FROM notifications WHERE business_id = $1`,
    `DELETE FROM bookings WHERE business_id = $1 AND id NOT IN (SELECT entity_id FROM seed_tracking WHERE entity_id IS NOT NULL)`,
    `DELETE FROM waitlist_entries WHERE business_id = $1 AND id NOT IN (SELECT entity_id FROM seed_tracking WHERE entity_id IS NOT NULL)`,
    `DELETE FROM gift_cards WHERE business_id = $1 AND id NOT IN (SELECT entity_id FROM seed_tracking WHERE entity_id IS NOT NULL)`,
    `DELETE FROM passes WHERE business_id = $1 AND id NOT IN (SELECT entity_id FROM seed_tracking WHERE entity_id IS NOT NULL)`,
    `DELETE FROM audit_logs WHERE business_id = $1`,
  ];
  for (const q of queries) {
    await pool.query(q, [bid]);
    console.log(`  ✓ ${q.slice(0, 60)}...`);
  }
  await pool.query(`DELETE FROM test_mock_log`);
  console.log('  ✓ test_mock_log cleared');

  console.log('\n✓ Cleanup complete. Seed preserved.');
  await pool.end();
})();
