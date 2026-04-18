/**
 * C06 / spec 04 — Expiry cron + J-7 warning + reactivate cancelled GC.
 *
 * Crons (giftcard-expiry.js) :
 *   - processExpiredGiftCards()       — status 'active' & expires_at < NOW() → 'expired'
 *   - processGiftCardExpiryWarnings() — candidates expire entre NOW et NOW+7d,
 *                                       status='active', balance>0, flag NULL
 *                                       → envoie email + set expiry_warning_sent_at
 *
 * Endpoint :
 *   - PATCH /api/gift-cards/:id  { status:'active' } → réactive carte cancelled
 *
 * 3 tests.
 */
const { test, expect } = require('@playwright/test');
const IDS = require('../fixtures/ids');
const { staffFetch, waitForMockLog } = require('../fixtures/api-client');
const { resetMutables } = require('../fixtures/reset-mutables');
const { pool } = require('../../../src/services/db');
const {
  processExpiredGiftCards,
  processGiftCardExpiryWarnings,
} = require('../../../src/services/giftcard-expiry');

test.describe('C06 — gc expiry + warning + reactivate', () => {
  let sinceTs;
  test.beforeEach(async () => {
    sinceTs = new Date(Date.now() - 1000).toISOString();
    await resetMutables();
  });

  test('1. Expire cron — active GC past expires_at → status=expired', async () => {
    // Force GC_ACTIVE expires_at to past
    await pool.query(
      `UPDATE gift_cards SET expires_at = NOW() - INTERVAL '1 day', status = 'active' WHERE id = $1`,
      [IDS.GC_ACTIVE]
    );

    const result = await processExpiredGiftCards();
    expect(result.processed).toBeGreaterThanOrEqual(1);

    const r = await pool.query(
      `SELECT status FROM gift_cards WHERE id = $1`,
      [IDS.GC_ACTIVE]
    );
    expect(r.rows[0].status).toBe('expired');
  });

  test('2. Warning J-7 — expiry_warning_sent_at set + email logged', async () => {
    // Set GC_PARTIAL to expire in 5 days, reset flag, keep balance > 0
    await pool.query(
      `UPDATE gift_cards SET expires_at = NOW() + INTERVAL '5 days',
              expiry_warning_sent_at = NULL, status = 'active', balance_cents = 5000
       WHERE id = $1`,
      [IDS.GC_PARTIAL]
    );

    // Fetch recipient email (buyer-test / gift-test per seed)
    const gc = await pool.query(
      `SELECT recipient_email FROM gift_cards WHERE id = $1`,
      [IDS.GC_PARTIAL]
    );
    const recipient = gc.rows[0].recipient_email;

    const result = await processGiftCardExpiryWarnings();
    expect(result.processed).toBeGreaterThanOrEqual(1);

    // Flag set
    const r = await pool.query(
      `SELECT expiry_warning_sent_at FROM gift_cards WHERE id = $1`,
      [IDS.GC_PARTIAL]
    );
    expect(r.rows[0].expiry_warning_sent_at).not.toBeNull();

    // Email logged in test_mock_log
    const logs = await waitForMockLog('email', recipient, sinceTs, 3000, 1);
    expect(logs.length).toBeGreaterThanOrEqual(1);
  });

  test('3. Reactivate GC cancelled — PATCH status=active → 200', async () => {
    // GC_CANCELLED seed : no stripe_PI, status=cancelled, balance 5000
    const res = await staffFetch(`/api/gift-cards/${IDS.GC_CANCELLED}`, {
      method: 'PATCH',
      body: { status: 'active' },
    });
    expect(res.status, `Reactivate error: ${JSON.stringify(res.body)}`).toBe(200);
    expect(res.body.status).toBe('active');

    // DB verify
    const r = await pool.query(
      `SELECT status, balance_cents FROM gift_cards WHERE id = $1`,
      [IDS.GC_CANCELLED]
    );
    expect(r.rows[0].status).toBe('active');
    // Reality check: balance is preserved (not zeroed) after reactivation
    expect(r.rows[0].balance_cents).toBe(5000);
  });
});
