require('dotenv').config();
process.env.SKIP_SMS = '1';
const assert = require('assert');
const { pool } = require('../src/services/db');
const { sendSMS } = require('../src/services/sms');

(async () => {
  await pool.query(`DELETE FROM test_mock_log WHERE type='sms' AND recipient='+32491000001'`);

  const result = await sendSMS({
    to: '+32491000001',
    body: 'Test Mock SMS',
    businessId: null
  });

  assert(result.mocked === true, 'FAIL: result.mocked should be true, got: ' + JSON.stringify(result));
  assert(result.success === true, 'FAIL: result.success should be true');
  console.log('✓ sendSMS returned mocked=true');

  const logs = await pool.query(
    `SELECT * FROM test_mock_log WHERE type='sms' AND recipient=$1 ORDER BY created_at DESC LIMIT 1`,
    ['+32491000001']
  );
  assert(logs.rows.length === 1, 'FAIL: no log row inserted');
  const payload = typeof logs.rows[0].payload === 'string' ? JSON.parse(logs.rows[0].payload) : logs.rows[0].payload;
  assert(payload.body === 'Test Mock SMS', 'FAIL: body not stored');
  console.log('✓ test_mock_log row inserted');

  await pool.query(`DELETE FROM test_mock_log WHERE recipient='+32491000001'`);
  console.log('\n✓ sendSMS mock valide');
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
