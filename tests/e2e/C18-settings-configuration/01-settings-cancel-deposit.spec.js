/**
 * C18 / spec 01 — Settings : cancel policy, deposit, refund, abuse.
 *
 * Endpoint : PATCH /api/business (merges settings_* fields into settings JSONB).
 *
 * 4 tests.
 */
const { test, expect } = require('@playwright/test');
const IDS = require('../fixtures/ids');
const { staffFetch } = require('../fixtures/api-client');
const { resetMutables } = require('../fixtures/reset-mutables');
const { pool } = require('../../../src/services/db');

// Helper: read settings JSONB directly
async function getSettings() {
  const r = await pool.query(`SELECT settings FROM businesses WHERE id = $1`, [IDS.BUSINESS]);
  return r.rows[0]?.settings || {};
}

test.describe('C18 — settings : cancel / deposit / refund', () => {
  let origSettings;

  test.beforeEach(async () => {
    await resetMutables();
    origSettings = await getSettings();
  });

  test.afterEach(async () => {
    // Restore settings to seed state
    await pool.query(
      `UPDATE businesses SET settings = $1, updated_at = NOW() WHERE id = $2`,
      [JSON.stringify(origSettings), IDS.BUSINESS]
    );
  });

  test('1. Save cancel_deadline_hours=48', async () => {
    const r = await staffFetch('/api/business', {
      method: 'PATCH',
      body: { settings_cancel_deadline_hours: 48 },
    });
    expect(r.status).toBe(200);
    const s = await getSettings();
    expect(s.cancel_deadline_hours).toBe(48);
  });

  test('2. Save deposit_percent=75 + deposit_enabled=true', async () => {
    const r = await staffFetch('/api/business', {
      method: 'PATCH',
      body: { settings_deposit_enabled: true, settings_deposit_percent: 75, settings_deposit_type: 'percent' },
    });
    expect(r.status).toBe(200);
    const s = await getSettings();
    expect(s.deposit_enabled).toBe(true);
    expect(s.deposit_percent).toBe(75);
    expect(s.deposit_type).toBe('percent');
  });

  test('3. Save cancel_abuse_max=10', async () => {
    const r = await staffFetch('/api/business', {
      method: 'PATCH',
      body: { settings_cancel_abuse_enabled: true, settings_cancel_abuse_max: 10 },
    });
    expect(r.status).toBe(200);
    const s = await getSettings();
    expect(s.cancel_abuse_enabled).toBe(true);
    expect(s.cancel_abuse_max).toBe(10);
  });

  test('4. Save refund_policy=net', async () => {
    const r = await staffFetch('/api/business', {
      method: 'PATCH',
      body: { settings_refund_policy: 'net' },
    });
    expect(r.status).toBe(200);
    const s = await getSettings();
    expect(s.refund_policy).toBe('net');
  });
});
