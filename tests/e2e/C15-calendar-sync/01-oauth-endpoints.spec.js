/**
 * C15 / spec 01 — Calendar OAuth init endpoints + connections list.
 *
 * Endpoints (src/routes/staff/calendar.js):
 *   GET  /api/calendar/google/connect   → returns { url } (Google OAuth URL)
 *                                         or 501 if GOOGLE_CLIENT_ID missing
 *   GET  /api/calendar/outlook/connect  → returns { url } or 501
 *   GET  /api/calendar/connections      → list connected calendars for business
 *
 * Note: the initial spec suggested redirect-style endpoints
 * (/api/calendar/auth/google → 302). The actual implementation uses
 * /api/calendar/{google,outlook}/connect and responds with a JSON {url}
 * — the front-end is expected to window.location.assign(url). Tests adapt.
 *
 * requirePro middleware applies; seed business has plan='pro'.
 *
 * 3 tests.
 */
const { test, expect } = require('@playwright/test');
const IDS = require('../fixtures/ids');
const { staffFetch, ownerToken } = require('../fixtures/api-client');
const { resetMutables } = require('../fixtures/reset-mutables');
const { pool } = require('../../../src/services/db');

test.describe('C15 — calendar OAuth endpoints', () => {
  let sinceTs;
  test.beforeEach(async () => {
    sinceTs = new Date(Date.now() - 1000).toISOString();
    await resetMutables();
  });

  test('1. GET /api/calendar/google/connect returns OAuth URL or 501', async () => {
    const res = await staffFetch('/api/calendar/google/connect');
    // Either:
    //   - 200 with body.url containing accounts.google.com (GOOGLE_CLIENT_ID set)
    //   - 501 with error "Google Calendar non configuré" (env missing)
    expect([200, 501]).toContain(res.status);
    if (res.status === 200) {
      expect(res.body.url).toMatch(/accounts\.google\.com/);
      expect(res.body.url).toMatch(/client_id=/);
      expect(res.body.url).toMatch(/state=[0-9a-f]{40,}/);
    } else {
      expect(res.body.error).toMatch(/Google/i);
    }
  });

  test('2. GET /api/calendar/outlook/connect returns OAuth URL or 501', async () => {
    const res = await staffFetch('/api/calendar/outlook/connect');
    expect([200, 501]).toContain(res.status);
    if (res.status === 200) {
      expect(res.body.url).toMatch(/login\.microsoftonline\.com/);
      expect(res.body.url).toMatch(/client_id=/);
      expect(res.body.url).toMatch(/state=[0-9a-f]{40,}/);
    } else {
      expect(res.body.error).toMatch(/Outlook/i);
    }
  });

  test('3. GET /api/calendar/connections returns the list (empty or populated)', async () => {
    const res = await staffFetch('/api/calendar/connections', { token: ownerToken() });
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.connections)).toBe(true);

    // Each connection has a predictable shape if any exist
    for (const c of res.body.connections) {
      expect(typeof c.id).toBe('string');
      expect(['google', 'outlook', 'ical']).toContain(c.provider);
      expect(['active', 'expired', 'revoked', 'error']).toContain(c.status);
    }
  });
});
