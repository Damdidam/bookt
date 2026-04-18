require('dotenv').config();
process.env.SKIP_EMAIL = '1';
const assert = require('assert');
const { pool } = require('../src/services/db');
const { sendEmail } = require('../src/services/email-utils');

(async () => {
  await pool.query(`DELETE FROM test_mock_log WHERE type='email' AND recipient='mock-test@genda-test.be'`);

  const result = await sendEmail({
    to: 'mock-test@genda-test.be',
    subject: 'Test Mock',
    html: '<p>Hello</p>',
    template: 'smoke_test'
  });

  assert(result.mocked === true, 'FAIL: result.mocked should be true, got: ' + JSON.stringify(result));
  assert(result.success === true, 'FAIL: result.success should be true');
  console.log('✓ sendEmail returned mocked=true');

  const logs = await pool.query(
    `SELECT * FROM test_mock_log WHERE type='email' AND recipient=$1 ORDER BY created_at DESC LIMIT 1`,
    ['mock-test@genda-test.be']
  );
  assert(logs.rows.length === 1, 'FAIL: no log row inserted');
  const payload = typeof logs.rows[0].payload === 'string' ? JSON.parse(logs.rows[0].payload) : logs.rows[0].payload;
  assert(payload.subject === 'Test Mock', 'FAIL: subject not stored correctly');
  console.log('✓ test_mock_log row inserted correctly');

  await pool.query(`DELETE FROM test_mock_log WHERE recipient='mock-test@genda-test.be'`);
  console.log('\n✓ sendEmail mock valide');
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
