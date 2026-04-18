/**
 * C12 / spec 02 — Emails cancel / modification / reschedule.
 *
 * 6 tests.
 * Assertions via test_mock_log with SKIP_EMAIL=1.
 *
 * Mapping kind (subject[0..50]) :
 *   - 'Rendez-vous annulé — …'          → cancel client (sendCancellationEmail)
 *   - 'Annulation — …'                  → cancellation_pro (notification-processor)
 *   - 'Rendez-vous déplacé — …'         → reschedule client (sendRescheduleConfirmationEmail)
 *   - 'Modification confirmée — …'       → modification_confirmed pro
 *   - 'Modification refusée — …'         → modification_rejected pro
 *   - '⚠ Litige Stripe — …'              → dispute_alert
 */
const { test, expect } = require('@playwright/test');
const IDS = require('../fixtures/ids');
const { publicFetch, staffFetch, waitForMockLog } = require('../fixtures/api-client');
const { resetMutables } = require('../fixtures/reset-mutables');
const { pool } = require('../../../src/services/db');

const SLUG = 'test-demo-salon';
const BIZ_EMAIL = 'test-bookt@genda.be';

function isoPlusDays(days, hour = 10) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  d.setHours(hour, 0, 0, 0);
  return d.toISOString();
}

test.describe('C12 — cancel / modif emails', () => {
  let sinceTs;

  test.beforeEach(async () => {
    sinceTs = new Date(Date.now() - 1000).toISOString();
    await resetMutables();
    await pool.query(`DELETE FROM test_mock_log WHERE created_at < NOW() - INTERVAL '1 minute'`);
  });

  test('1. Email cancel client — POST /booking/:token/cancel', async () => {
    const uniqueEmail = `e2e-c12-cx-${Date.now()}@genda-test.be`;
    const startAt = isoPlusDays(7, 10);

    // Create booking
    const created = await publicFetch(`/api/public/${SLUG}/bookings`, {
      method: 'POST',
      body: {
        service_id: IDS.SVC_SHORT,
        practitioner_id: IDS.PRAC_ALICE,
        start_at: startAt,
        appointment_mode: 'cabinet',
        client_name: 'C12 Cancel Client',
        client_email: uniqueEmail,
        client_phone: '+32491000910',
        consent_sms: true, consent_email: true, consent_marketing: false,
      },
    });
    expect(created.status).toBe(201);
    const token = created.body.booking.token || created.body.booking.public_token;
    expect(token, `no token in response: ${JSON.stringify(created.body.booking)}`).toBeTruthy();

    // Reset sinceTs *after* the confirm email fires so we don't match it
    sinceTs = new Date(Date.now() + 500).toISOString();
    await new Promise(r => setTimeout(r, 600));

    const cx = await publicFetch(`/api/public/booking/${token}/cancel`, {
      method: 'POST', body: { reason: 'test cancel' },
    });
    expect(cx.status).toBe(200);

    const emails = await waitForMockLog('email', uniqueEmail, sinceTs, 6000, 1);
    const hit = emails.find(e => /annulé/i.test(e.payload.subject));
    expect(hit, `No cancel email. got=${emails.map(e => e.payload.subject).join(' | ')}`).toBeTruthy();
    expect(hit.payload.subject).toMatch(/Rendez-vous annulé/i);
  });

  test('2. Email cancel pro avec raison — PATCH /bookings/:id/status staff', async () => {
    const uniqueEmail = `e2e-c12-cx-pro-${Date.now()}@genda-test.be`;
    const startAt = isoPlusDays(7, 11);

    const created = await publicFetch(`/api/public/${SLUG}/bookings`, {
      method: 'POST',
      body: {
        service_id: IDS.SVC_SHORT,
        practitioner_id: IDS.PRAC_ALICE,
        start_at: startAt,
        appointment_mode: 'cabinet',
        client_name: 'C12 Staff Cancel',
        client_email: uniqueEmail,
        client_phone: '+32491000911',
        consent_sms: true, consent_email: true, consent_marketing: false,
      },
    });
    expect(created.status).toBe(201);
    const bookingId = created.body.booking.id;

    sinceTs = new Date(Date.now() + 500).toISOString();
    await new Promise(r => setTimeout(r, 600));

    const cx = await staffFetch(`/api/bookings/${bookingId}/status`, {
      method: 'PATCH', body: { status: 'cancelled', cancel_reason: 'Motif test C12' },
    });
    expect(cx.status).toBe(200);

    // Drain notification queue for email_cancellation_pro
    const { processNotifications } = require('../../../src/services/notification-processor');
    await processNotifications();

    const emails = await waitForMockLog('email', BIZ_EMAIL, sinceTs, 6000, 1);
    const hit = emails.find(e => /Annulation/i.test(e.payload.subject));
    expect(hit, `No "Annulation" pro email. got=${emails.map(e => e.payload.subject).join(' | ')}`).toBeTruthy();
  });

  test('3. Email reschedule — POST /manage/:token/reschedule', async () => {
    // Ensure reschedule_enabled=true
    await pool.query(
      `UPDATE businesses SET settings = settings || '{"reschedule_enabled":true, "reschedule_max_count":3}'::jsonb WHERE id = $1`,
      [IDS.BUSINESS]
    );

    const uniqueEmail = `e2e-c12-rs-${Date.now()}@genda-test.be`;
    const startAt = isoPlusDays(7, 10);
    const newStart = isoPlusDays(8, 14);
    const newEnd = isoPlusDays(8, 14);
    // newEnd = +15 min
    const newEndDate = new Date(newStart);
    newEndDate.setMinutes(newEndDate.getMinutes() + 15);

    const created = await publicFetch(`/api/public/${SLUG}/bookings`, {
      method: 'POST',
      body: {
        service_id: IDS.SVC_SHORT,
        practitioner_id: IDS.PRAC_ALICE,
        start_at: startAt,
        appointment_mode: 'cabinet',
        client_name: 'C12 Reschedule',
        client_email: uniqueEmail,
        client_phone: '+32491000912',
        consent_sms: true, consent_email: true, consent_marketing: false,
      },
    });
    expect(created.status).toBe(201);
    const token = created.body.booking.token || created.body.booking.public_token;
    expect(token).toBeTruthy();

    // Wait for the initial confirmation email to fire (fire-and-forget may race)
    await waitForMockLog('email', uniqueEmail, sinceTs, 6000, 1);
    // Reset sinceTs so we only see the NEW reschedule email
    sinceTs = new Date().toISOString();
    await new Promise(r => setTimeout(r, 500));

    const rs = await publicFetch(`/api/public/manage/${token}/reschedule`, {
      method: 'POST',
      body: { start_at: newStart, end_at: newEndDate.toISOString() },
    });
    expect(rs.status, `reschedule failed: ${JSON.stringify(rs.body)}`).toBe(200);

    // Longer wait — reschedule fetches booking + group then sends, takes a beat
    const emails = await waitForMockLog('email', uniqueEmail, sinceTs, 12000, 1);
    const hit = emails.find(e => /déplacé/i.test(e.payload.subject));
    expect(hit, `No "Rendez-vous déplacé" email. got=${emails.map(e => e.payload.subject).join(' | ')}`).toBeTruthy();
  });

  test('4. Email modification_confirmed — client confirme une modif', async () => {
    // Create a booking manually in 'modified_pending' state, confirm via POST /booking/:token/confirm
    const uniqueEmail = `e2e-c12-modc-${Date.now()}@genda-test.be`;
    const startAt = isoPlusDays(8, 15);
    const token = `c12-modc-${Date.now()}`;
    const client = await pool.query(
      `INSERT INTO clients (business_id, full_name, email, phone, consent_sms, consent_email)
       VALUES ($1, 'C12 ModConfirm', $2, '+32491000913', true, true)
       ON CONFLICT DO NOTHING RETURNING id`,
      [IDS.BUSINESS, uniqueEmail]
    );
    const clientId = client.rows[0]?.id || (await pool.query(`SELECT id FROM clients WHERE business_id=$1 AND email=$2`, [IDS.BUSINESS, uniqueEmail])).rows[0].id;

    const r = await pool.query(
      `INSERT INTO bookings (business_id, client_id, service_id, practitioner_id,
         start_at, end_at, status, appointment_mode, public_token, booked_price_cents)
       VALUES ($1, $2, $3, $4, $5, $5::timestamptz + INTERVAL '15 min',
               'modified_pending', 'cabinet', $6, 1500)
       RETURNING id`,
      [IDS.BUSINESS, clientId, IDS.SVC_SHORT, IDS.PRAC_ALICE, startAt, token]
    );
    const bookingId = r.rows[0].id;

    try {
      sinceTs = new Date(Date.now() + 200).toISOString();
      await new Promise(s => setTimeout(s, 300));

      const confirm = await publicFetch(`/api/public/booking/${token}/confirm`, { method: 'POST' });
      expect(confirm.status).toBe(200);

      const { processNotifications } = require('../../../src/services/notification-processor');
      await processNotifications();

      const emails = await waitForMockLog('email', BIZ_EMAIL, sinceTs, 6000, 1);
      const hit = emails.find(e => /Modification confirmée/i.test(e.payload.subject));
      expect(hit, `No "Modification confirmée" pro email. got=${emails.map(e => e.payload.subject).join(' | ')}`).toBeTruthy();
    } finally {
      await pool.query(`DELETE FROM notifications WHERE booking_id = $1`, [bookingId]);
      await pool.query(`DELETE FROM bookings WHERE id = $1`, [bookingId]);
    }
  });

  test('5. Email modification_rejected — client refuse une modif', async () => {
    const uniqueEmail = `e2e-c12-modr-${Date.now()}@genda-test.be`;
    const startAt = isoPlusDays(8, 16);
    const token = `c12-modr-${Date.now()}`;
    await pool.query(
      `INSERT INTO clients (business_id, full_name, email, phone, consent_sms, consent_email)
       VALUES ($1, 'C12 ModReject', $2, '+32491000914', true, true)
       ON CONFLICT DO NOTHING`,
      [IDS.BUSINESS, uniqueEmail]
    );
    const clientId = (await pool.query(`SELECT id FROM clients WHERE business_id=$1 AND email=$2`, [IDS.BUSINESS, uniqueEmail])).rows[0].id;

    const r = await pool.query(
      `INSERT INTO bookings (business_id, client_id, service_id, practitioner_id,
         start_at, end_at, status, appointment_mode, public_token, booked_price_cents)
       VALUES ($1, $2, $3, $4, $5, $5::timestamptz + INTERVAL '15 min',
               'modified_pending', 'cabinet', $6, 1500)
       RETURNING id`,
      [IDS.BUSINESS, clientId, IDS.SVC_SHORT, IDS.PRAC_ALICE, startAt, token]
    );
    const bookingId = r.rows[0].id;

    try {
      sinceTs = new Date(Date.now() + 200).toISOString();
      await new Promise(s => setTimeout(s, 300));

      const reject = await publicFetch(`/api/public/booking/${token}/reject`, { method: 'POST' });
      expect(reject.status).toBe(200);

      const { processNotifications } = require('../../../src/services/notification-processor');
      await processNotifications();

      const emails = await waitForMockLog('email', BIZ_EMAIL, sinceTs, 6000, 1);
      const hit = emails.find(e => /Modification refusée/i.test(e.payload.subject));
      expect(hit, `No "Modification refusée" pro email. got=${emails.map(e => e.payload.subject).join(' | ')}`).toBeTruthy();
    } finally {
      await pool.query(`DELETE FROM notifications WHERE booking_id = $1`, [bookingId]);
      await pool.query(`DELETE FROM bookings WHERE id = $1`, [bookingId]);
    }
  });

  test('6. Email dispute_alert — notification processor avec metadata', async () => {
    // Dispute_alert is triggered via a queued notification of type 'email_dispute_alert'
    // with metadata.amount + metadata.reason. Create a fake booking + queue the notification.
    const startAt = isoPlusDays(7, 17);
    const r = await pool.query(
      `INSERT INTO bookings (business_id, client_id, service_id, practitioner_id,
         start_at, end_at, status, appointment_mode)
       VALUES ($1, $2, $3, $4, $5, $5::timestamptz + INTERVAL '15 min',
               'confirmed', 'cabinet')
       RETURNING id`,
      [IDS.BUSINESS, IDS.CLIENT_JEAN, IDS.SVC_SHORT, IDS.PRAC_ALICE, startAt]
    );
    const bookingId = r.rows[0].id;

    try {
      await pool.query(
        `INSERT INTO notifications (business_id, booking_id, type, status, metadata)
         VALUES ($1, $2, 'email_dispute_alert', 'queued', $3)`,
        [IDS.BUSINESS, bookingId, JSON.stringify({ amount: 5000, reason: 'fraudulent' })]
      );

      const { processNotifications } = require('../../../src/services/notification-processor');
      await processNotifications();

      const emails = await waitForMockLog('email', BIZ_EMAIL, sinceTs, 6000, 1);
      const hit = emails.find(e => /Litige Stripe/i.test(e.payload.subject));
      expect(hit, `No dispute_alert email. got=${emails.map(e => e.payload.subject).join(' | ')}`).toBeTruthy();
    } finally {
      await pool.query(`DELETE FROM notifications WHERE booking_id = $1`, [bookingId]);
      await pool.query(`DELETE FROM bookings WHERE id = $1`, [bookingId]);
    }
  });
});
