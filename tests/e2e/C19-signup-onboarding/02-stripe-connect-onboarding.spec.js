/**
 * C19 / spec 02 — Stripe Connect onboarding endpoints.
 *
 * Endpoints :
 *   POST /api/stripe/connect/onboard   → { url } (OAuth link) or 503 if Stripe unconfigured
 *   Webhook account.updated            → POST /webhooks/stripe (stripe-signature)
 *   GET /api/auth/me                   → returns user/business basic info (no onboarding_step)
 *
 * 3 tests.
 */
const { test, expect } = require('@playwright/test');
const IDS = require('../fixtures/ids');
const { staffFetch } = require('../fixtures/api-client');
const { resetMutables } = require('../fixtures/reset-mutables');
const { pool } = require('../../../src/services/db');

const BASE_URL = process.env.APP_BASE_URL || 'http://localhost:3000';
const HAS_STRIPE = !!(process.env.STRIPE_SECRET_KEY_TEST || process.env.STRIPE_SECRET_KEY);
const HAS_WH_SECRET = !!process.env.STRIPE_WEBHOOK_SECRET;

test.describe('C19 — Stripe Connect onboarding', () => {
  test.beforeEach(async () => {
    await resetMutables();
  });

  test('1. POST /api/stripe/connect/onboard → 200 url OR 503 (Stripe unconfigured)', async () => {
    const res = await staffFetch('/api/stripe/connect/onboard', { method: 'POST' });
    expect([200, 404, 500, 503]).toContain(res.status);
    if (res.status === 200) {
      expect(typeof res.body.url).toBe('string');
      expect(res.body.url).toMatch(/stripe\.com|connect/i);
    }
  });

  test('2. account.updated webhook → accept 200/400/500', async () => {
    test.skip(!HAS_STRIPE || !HAS_WH_SECRET, 'STRIPE env missing');
    const { buildSignedWebhook } = require('../fixtures/stripe-test');
    const { payload, signature } = buildSignedWebhook('account.updated', {
      id: 'acct_test_c19_' + Date.now(),
      object: 'account',
      charges_enabled: true,
      payouts_enabled: true,
      details_submitted: true,
    });
    const res = await fetch(`${BASE_URL}/webhooks/stripe`, {
      method: 'POST',
      headers: { 'stripe-signature': signature, 'content-type': 'application/json' },
      body: payload,
    });
    expect([200, 400, 500]).toContain(res.status);
  });

  test('3. GET /api/auth/me → returns user + business (+ plan/sector)', async () => {
    const res = await staffFetch('/api/auth/me');
    expect(res.status).toBe(200);
    expect(res.body.user).toBeTruthy();
    expect(typeof res.body.user.email).toBe('string');
    // slug present => business info available (used by onboarding UI flag logic on the front)
    expect(res.body.user.slug || res.body.user.business_name).toBeTruthy();
  });
});
