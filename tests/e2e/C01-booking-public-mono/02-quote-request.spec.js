/**
 * C01 / spec 02 — Quote-only service booking.
 *
 * 1 test:
 *   - Client books SVC_QUOTE (quote_only=true, price=NULL) via POST /bookings.
 *     Quote-only services follow a special path: booking is inserted with
 *     status='pending' (see src/routes/public/index.js:1086, _isQuoteOnlyBooking
 *     branch). Confirmation flows via the merchant quote response (deposit flow),
 *     no client confirmation deadline, no deposit upfront.
 */
const { test, expect } = require('@playwright/test');
const IDS = require('../fixtures/ids');
const { publicFetch } = require('../fixtures/api-client');
const { pool } = require('../../../src/services/db');

const SLUG = 'test-demo-salon';

function isoPlusDays(days, hour = 10) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  d.setHours(hour, 0, 0, 0);
  return d.toISOString();
}

test.describe('C01 — booking public mono: quote-only service', () => {
  test('Quote request for SVC_QUOTE creates pending booking, no deposit', async () => {
    const uniqueEmail = `e2e-quote-${Date.now()}@genda-test.be`;
    const startAt = isoPlusDays(8, 11);

    const { status, body } = await publicFetch(`/api/public/${SLUG}/bookings`, {
      method: 'POST',
      body: {
        service_id: IDS.SVC_QUOTE,
        practitioner_id: IDS.PRAC_ALICE,
        start_at: startAt,
        appointment_mode: 'cabinet',
        client_name: 'E2E Quote Client',
        client_email: uniqueEmail,
        client_phone: '+32491000777',
        consent_sms: true,
        consent_email: true,
        consent_marketing: false,
        client_comment: 'Devis souhaité SVP',
      },
    });

    expect(status, `API error: ${JSON.stringify(body)}`).toBe(201);
    expect(body.booking).toBeTruthy();
    expect(body.booking.id).toMatch(/^[0-9a-f-]{36}$/i);

    // Quote-only: status pending, NO deposit, NO confirmation_expires_at
    expect(body.booking.status).toBe('pending');
    expect(body.booking.deposit_amount_cents == null || body.booking.deposit_amount_cents === 0).toBe(true);
    // needs_confirmation = false for quote_only (merchant confirms via quote response)
    expect(body.needs_confirmation).toBe(false);

    const dbRow = await pool.query(
      `SELECT b.status, b.deposit_required, b.deposit_amount_cents, b.confirmation_expires_at,
              b.service_id, b.booked_price_cents, b.locked,
              s.quote_only, s.price_cents AS svc_price
       FROM bookings b JOIN services s ON s.id = b.service_id
       WHERE b.id = $1`,
      [body.booking.id]
    );
    expect(dbRow.rows.length).toBe(1);
    const row = dbRow.rows[0];
    expect(row.status).toBe('pending');
    expect(row.deposit_required).toBe(false);
    expect(row.deposit_amount_cents).toBeNull();
    // Quote-only path leaves confirmation_expires_at NULL (merchant controls)
    expect(row.confirmation_expires_at).toBeNull();
    expect(row.quote_only).toBe(true);
    // Service has NULL price → booked_price_cents stored as 0 (COALESCE)
    expect(row.svc_price).toBeNull();
  });
});
