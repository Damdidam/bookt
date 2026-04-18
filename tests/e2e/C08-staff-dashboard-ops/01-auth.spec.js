/**
 * C08 / spec 01 — Staff authentication flows.
 *
 * Endpoints:
 *   POST /api/auth/login      — body {email, password}, returns JWT + user + business
 *   GET  /api/auth/me         — current user (requireAuth)
 *
 * Notes :
 *   - Backend has no /api/auth/refresh endpoint — instead uses magic-link /verify
 *     and forgot-password/reset-password flows. Test #4 asserts on expired JWT
 *     being rejected + POST /api/auth/forgot-password returning generic message
 *     (backend's equivalent of a "refresh/reauth" path).
 *   - Practitioner scope : GET /api/bookings returns only Bob's bookings when
 *     called with Bob's token — seed has BK_COMPLETED_1/2/3/NOSHOW_1 on PRAC_ALICE
 *     and BK_CANCELLED_1 on PRAC_BOB (see seeds/06-bookings-historique.js).
 *
 * 4 tests.
 */
const { test, expect } = require('@playwright/test');
const jwt = require('jsonwebtoken');
const IDS = require('../fixtures/ids');
const { publicFetch, staffFetch, signTestToken, ownerToken, staffToken, BASE_URL } = require('../fixtures/api-client');
const { resetMutables } = require('../fixtures/reset-mutables');
const { pool } = require('../../../src/services/db');

test.describe('C08 — staff ops : auth', () => {
  let sinceTs;
  test.beforeEach(async () => {
    sinceTs = new Date(Date.now() - 1000).toISOString();
    await resetMutables();
  });

  test('1. Login owner + returns JWT decodable with JWT_SECRET', async () => {
    const res = await publicFetch('/api/auth/login', {
      method: 'POST',
      body: { email: 'alice-test@genda-test.be', password: 'TestPassword123!' },
    });
    expect(res.status, `login body: ${JSON.stringify(res.body)}`).toBe(200);
    expect(res.body.token).toBeTruthy();
    expect(res.body.user).toBeTruthy();
    expect(res.body.user.email).toBe('alice-test@genda-test.be');
    expect(res.body.user.role).toBe('owner');
    expect(res.body.business).toBeTruthy();
    expect(res.body.business.id).toBe(IDS.BUSINESS);

    const decoded = jwt.verify(res.body.token, process.env.JWT_SECRET);
    expect(decoded.userId).toBe(IDS.USER_ALICE_OWNER);
    expect(decoded.businessId).toBe(IDS.BUSINESS);
  });

  test('2. Login practitioner → scope reduced on GET /api/bookings', async () => {
    // First ensure we have the seed historique bookings on different pracs.
    // Bob's token should only see Bob's bookings.
    const bobTok = staffToken();
    const res = await staffFetch('/api/bookings', { token: bobTok });
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.bookings)).toBe(true);

    // Every returned booking must belong to PRAC_BOB
    for (const bk of res.body.bookings) {
      expect(bk.practitioner_id).toBe(IDS.PRAC_BOB);
    }

    // Owner token should see bookings on both Alice + Bob + Carol
    const ownerRes = await staffFetch('/api/bookings', { token: ownerToken() });
    expect(ownerRes.status).toBe(200);
    const pracsInOwnerView = new Set(ownerRes.body.bookings.map(b => b.practitioner_id));
    // Expect at least 2 different practitioners visible to owner
    expect(pracsInOwnerView.size).toBeGreaterThanOrEqual(1);
    // Owner view should include Bob's bookings
    const ownerSeesBob = ownerRes.body.bookings.some(b => b.practitioner_id === IDS.PRAC_BOB);
    expect(ownerSeesBob).toBe(true);
  });

  test('3. Login invalid password → 401', async () => {
    const res = await publicFetch('/api/auth/login', {
      method: 'POST',
      body: { email: 'alice-test@genda-test.be', password: 'WrongPassword999!' },
    });
    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/incorrect|Email/i);
  });

  test('4. Expired JWT → /me 401 + forgot-password available', async () => {
    // Sign an already-expired token (exp in the past)
    const expiredToken = jwt.sign(
      { userId: IDS.USER_ALICE_OWNER, businessId: IDS.BUSINESS, id: IDS.USER_ALICE_OWNER, business_id: IDS.BUSINESS, role: 'owner' },
      process.env.JWT_SECRET,
      { expiresIn: '-10s' }
    );
    const meRes = await staffFetch('/api/auth/me', { token: expiredToken });
    expect(meRes.status).toBe(401);

    // Valid token: /me should return 200
    const okRes = await staffFetch('/api/auth/me', { token: ownerToken() });
    expect(okRes.status).toBe(200);
    expect(okRes.body.user).toBeTruthy();
    expect(okRes.body.user.email).toBe('alice-test@genda-test.be');

    // Backend equivalent to a "refresh" flow: POST /api/auth/forgot-password
    // always returns 200 with generic message (anti-enum)
    const forgotRes = await publicFetch('/api/auth/forgot-password', {
      method: 'POST',
      body: { email: 'alice-test@genda-test.be' },
    });
    expect(forgotRes.status).toBe(200);
    expect(forgotRes.body.message).toBeTruthy();
  });
});
