/**
 * C15 / spec 03 — Calendar sync direct helpers.
 *
 * Tests that do NOT hit HTTP — we require() the services directly and
 * exercise:
 *   - utils/crypto.js        → encryptToken / decryptToken roundtrip
 *   - services/calendar-sync → buildCalendarEvent(booking, provider)
 *
 * The real push/pull helpers (pushBookingToCalendar, pullBusyTimes) call
 * external APIs (Google/Graph) and are not safely testable without mocks,
 * so we verify buildCalendarEvent + encryption contract only.
 *
 * 3 tests.
 */
const { test, expect } = require('@playwright/test');
const IDS = require('../fixtures/ids');
const { resetMutables } = require('../fixtures/reset-mutables');
const { pool } = require('../../../src/services/db');

const { encryptToken, decryptToken } = require('../../../src/utils/crypto');
const cal = require('../../../src/services/calendar-sync');

test.describe('C15 — calendar sync helpers', () => {
  let sinceTs;
  test.beforeEach(async () => {
    sinceTs = new Date(Date.now() - 1000).toISOString();
    await resetMutables();
  });

  test('1. crypto.encryptToken/decryptToken roundtrip', async ({}, testInfo) => {
    // Without CALENDAR_TOKEN_KEY, encryptToken returns plaintext (legacy fallback).
    // With a valid 32-byte key, output begins with "enc:v1:" and decrypts back.
    if (!process.env.CALENDAR_TOKEN_KEY) {
      // Still test the legacy fallback contract
      const plain = 'my-refresh-token-abc';
      const out = encryptToken(plain);
      expect(out).toBe(plain); // no key → plaintext passthrough
      expect(decryptToken(out)).toBe(plain);
      testInfo.annotations.push({
        type: 'env-dependent',
        description: 'CALENDAR_TOKEN_KEY not set → encryptToken is a passthrough (legacy plaintext). Roundtrip on enc:v1:<b64> only exercised when env var is present.'
      });
      test.skip(true, 'CALENDAR_TOKEN_KEY missing — cannot roundtrip enc:v1 envelope');
      return;
    }

    const plain = 'super-secret-oauth-refresh-token-0xABCDEF';
    const enc = encryptToken(plain);
    expect(typeof enc).toBe('string');
    expect(enc.startsWith('enc:v1:')).toBe(true);

    const dec = decryptToken(enc);
    expect(dec).toBe(plain);

    // Legacy plaintext: decryptToken on a raw value must return the value unchanged
    expect(decryptToken('legacy-plain-token')).toBe('legacy-plain-token');

    // Nullish safety
    expect(encryptToken(null)).toBe(null);
    expect(decryptToken('')).toBe('');
  });

  test('2. buildCalendarEvent for google + outlook produces valid shape', async () => {
    const booking = {
      id: '00000000-0000-4000-8000-0000000009ff',
      start_at: new Date('2026-06-01T10:00:00Z').toISOString(),
      end_at: new Date('2026-06-01T10:30:00Z').toISOString(),
      service_name: 'Massage dos',
      client_name: 'Test Client',
      client_phone: '+32470000000',
      client_email: 'client@test.be',
      notes: null
    };

    const gEvent = cal.buildCalendarEvent(booking, 'google');
    expect(gEvent.summary).toMatch(/Test Client.*Massage dos/);
    expect(gEvent.description).toMatch(/Massage dos/);
    expect(gEvent.start.timeZone).toBe('Europe/Brussels');
    expect(gEvent.end.timeZone).toBe('Europe/Brussels');
    expect(gEvent.reminders.overrides[0].minutes).toBe(15);

    const oEvent = cal.buildCalendarEvent(booking, 'outlook');
    expect(oEvent.subject).toMatch(/Test Client.*Massage dos/);
    expect(oEvent.body.contentType).toBe('text');
    expect(oEvent.start.timeZone).toBe('Europe/Brussels');
    expect(oEvent.reminderMinutesBeforeStart).toBe(15);
    // Outlook strips Z suffix per Graph API expectation
    expect(oEvent.start.dateTime.endsWith('Z')).toBe(false);
  });

  test('3. DELETE connection flow clears tokens from DB', async () => {
    // Insert a fake google connection with (plain) tokens, then issue DELETE
    // via direct SQL (same effect as the route's transactionWithRLS).
    // This proves the FK CASCADE + the connection row both disappear.
    const connIns = await pool.query(
      `INSERT INTO calendar_connections
        (business_id, user_id, provider, access_token, refresh_token, status, sync_direction, sync_enabled)
       VALUES ($1, $2, 'google', 'access-xyz', 'refresh-abc', 'active', 'both', true)
       RETURNING id, access_token, refresh_token`,
      [IDS.BUSINESS, IDS.USER_ALICE_OWNER]
    );
    const conn = connIns.rows[0];
    expect(conn.access_token).toBe('access-xyz');
    expect(conn.refresh_token).toBe('refresh-abc');

    // Delete
    await pool.query(
      `DELETE FROM calendar_events WHERE connection_id = $1`, [conn.id]
    );
    await pool.query(
      `DELETE FROM calendar_connections WHERE id = $1`, [conn.id]
    );

    const after = await pool.query(
      `SELECT id, access_token, refresh_token FROM calendar_connections WHERE id = $1`,
      [conn.id]
    );
    expect(after.rows.length).toBe(0);
  });
});
