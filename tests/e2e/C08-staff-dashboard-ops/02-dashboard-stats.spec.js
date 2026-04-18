/**
 * C08 / spec 02 — Staff dashboard summary stats.
 *
 * Backend exposes GET /api/dashboard/summary (not /stats). Response is keyed by
 * `today`, `month`, `clients`, `alerts`, `next_booking`, `pending_todos`,
 * `recent_activity`, `prac_hours`, `weekly_booking_count` — not "week/month"
 * literally but contains those rollups.
 *
 * 1 test.
 */
const { test, expect } = require('@playwright/test');
const IDS = require('../fixtures/ids');
const { staffFetch } = require('../fixtures/api-client');
const { resetMutables } = require('../fixtures/reset-mutables');
const { pool } = require('../../../src/services/db');

test.describe('C08 — staff ops : dashboard stats', () => {
  let sinceTs;
  test.beforeEach(async () => {
    sinceTs = new Date(Date.now() - 1000).toISOString();
    await resetMutables();
  });

  test('1. GET /api/dashboard/summary returns today/week/month stats', async () => {
    const res = await staffFetch('/api/dashboard/summary');
    expect(res.status, `summary body: ${JSON.stringify(res.body)}`).toBe(200);

    // today: { date, bookings[], count }
    expect(res.body.today).toBeTruthy();
    expect(res.body.today.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(Array.isArray(res.body.today.bookings)).toBe(true);
    expect(typeof res.body.today.count).toBe('number');

    // month: counts + revenue
    expect(res.body.month).toBeTruthy();
    expect(typeof res.body.month.total_bookings).toBe('number');
    expect(typeof res.body.month.no_shows).toBe('number');
    expect(typeof res.body.month.cancellations).toBe('number');
    expect(typeof res.body.month.revenue_cents).toBe('number');
    expect(res.body.month.revenue_formatted).toMatch(/€/);

    // clients total
    expect(res.body.clients).toBeTruthy();
    expect(typeof res.body.clients.total).toBe('number');

    // alerts bucket
    expect(res.body.alerts).toBeTruthy();
    expect(typeof res.body.alerts.pending_confirmations).toBe('number');
    expect(typeof res.body.alerts.unpaid_deposits).toBe('number');
    expect(typeof res.body.alerts.recent_no_shows).toBe('number');
    expect(Array.isArray(res.body.alerts.upcoming_absences)).toBe(true);

    // week proxy: weekly_booking_count
    expect(typeof res.body.weekly_booking_count).toBe('number');
  });
});
