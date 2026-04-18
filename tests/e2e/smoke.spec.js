const { test, expect } = require('@playwright/test');
const IDS = require('./fixtures/ids');
const { staffFetch, getMockLogs } = require('./fixtures/api-client');

test.describe('Smoke — infrastructure', () => {

  test('seed business TEST exists with is_test_account=true', async () => {
    const { pool } = require('../../src/services/db');
    const r = await pool.query(`SELECT is_test_account, slug FROM businesses WHERE id = $1`, [IDS.BUSINESS]);
    expect(r.rows.length).toBe(1);
    expect(r.rows[0].is_test_account).toBe(true);
    expect(r.rows[0].slug).toBe('test-demo-salon');
  });

  test('public minisite loads for TEST business', async ({ request }) => {
    const res = await request.get(`/api/public/test-demo-salon`);
    expect(res.ok()).toBeTruthy();
  });

  test('staff login as Alice returns 200', async () => {
    const { body, status } = await staffFetch('/api/auth/me');
    expect(status).toBe(200);
  });

  test('SKIP_EMAIL=1 writes to test_mock_log (not Brevo)', async () => {
    const { sendEmail } = require('../../src/services/email-utils');
    const since = new Date(Date.now() - 60000).toISOString();
    const before = await getMockLogs('email', since);
    const beforeCount = before.length;

    process.env.SKIP_EMAIL = '1';
    await sendEmail({
      to: 'smoke-test@genda-test.be',
      subject: 'Smoke',
      html: '<p>Smoke test</p>',
      template: 'smoke_test'
    });

    const after = await getMockLogs('email', since);
    expect(after.length).toBeGreaterThanOrEqual(beforeCount + 1);
  });
});
