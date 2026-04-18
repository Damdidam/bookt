require('dotenv').config();
const { pool } = require('../src/services/db');

(async () => {
  const col = await pool.query(`
    SELECT column_name, data_type, column_default
    FROM information_schema.columns
    WHERE table_name = 'businesses' AND column_name = 'is_test_account'
  `);
  if (col.rows.length === 0) throw new Error('FAIL: is_test_account col missing');
  if (col.rows[0].data_type !== 'boolean') throw new Error('FAIL: wrong type');
  if (col.rows[0].column_default !== 'false') throw new Error('FAIL: wrong default');
  console.log('✓ businesses.is_test_account OK');

  const t1 = await pool.query(`SELECT to_regclass('seed_tracking') AS tbl`);
  if (!t1.rows[0].tbl) throw new Error('FAIL: seed_tracking table missing');
  console.log('✓ seed_tracking table OK');

  const t2 = await pool.query(`SELECT to_regclass('test_mock_log') AS tbl`);
  if (!t2.rows[0].tbl) throw new Error('FAIL: test_mock_log table missing');
  console.log('✓ test_mock_log table OK');

  const idx = await pool.query(`
    SELECT indexname FROM pg_indexes
    WHERE tablename = 'businesses' AND indexname = 'idx_businesses_test'
  `);
  if (idx.rows.length === 0) throw new Error('FAIL: idx_businesses_test missing');
  console.log('✓ idx_businesses_test OK');

  console.log('\n✓ Migration v73 valide');
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
