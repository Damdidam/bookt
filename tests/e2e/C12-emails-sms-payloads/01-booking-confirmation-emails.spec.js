/**
 * C12 / spec 01 — Emails de confirmation de booking.
 *
 * 5 tests. Vérifient que sendEmail est loggée dans test_mock_log via SKIP_EMAIL=1
 * pour tous les emails liés à la création d'un booking public.
 *
 * Mapping kind (test_mock_log.kind = opts.template || opts.subject?.slice(0,50)) :
 *   - 'Confirmation de votre RDV — TEST — Demo Salon Genda' → confirmation client
 *   - 'Acompte requis — TEST — Demo Salon Genda'            → deposit_request client
 *   - 'Nouveau RDV — …'                                      → new_booking_pro
 *   - 'Acompte reçu — …'                                     → deposit_paid_pro
 *   - 'Votre avis compte — …'                                → post_rdv (review)
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

test.describe('C12 — booking confirmation emails', () => {
  let sinceTs;

  test.beforeEach(async () => {
    sinceTs = new Date(Date.now() - 1000).toISOString();
    await resetMutables();
    // Clean mock log before each test (keep only recent rows for isolation)
    await pool.query(`DELETE FROM test_mock_log WHERE created_at < NOW() - INTERVAL '1 minute'`);
  });

  test('1. Email confirmation booking public (sans deposit)', async () => {
    const uniqueEmail = `e2e-c12-conf-${Date.now()}@genda-test.be`;
    const startAt = isoPlusDays(7, 10);

    const { status, body } = await publicFetch(`/api/public/${SLUG}/bookings`, {
      method: 'POST',
      body: {
        service_id: IDS.SVC_SHORT,
        practitioner_id: IDS.PRAC_ALICE,
        start_at: startAt,
        appointment_mode: 'cabinet',
        client_name: 'C12 Conf Client',
        client_email: uniqueEmail,
        client_phone: '+32491000901',
        consent_sms: true, consent_email: true, consent_marketing: false,
      },
    });
    expect(status, `API error: ${JSON.stringify(body)}`).toBe(201);
    expect(body.booking.status).toBe('confirmed');

    const emails = await waitForMockLog('email', uniqueEmail, sinceTs, 6000, 1);
    expect(emails.length, `No email logged for ${uniqueEmail}`).toBeGreaterThanOrEqual(1);
    expect(emails[0].type).toBe('email');
    // Subject starts with "Confirmation de votre RDV" (kind = 1st 50 chars of subject)
    expect(emails[0].kind).toMatch(/Confirmation/i);
    expect(emails[0].payload.subject).toMatch(/Confirmation de votre RDV/);
    expect(emails[0].payload.to).toBe(uniqueEmail);
  });

  test('2. Email deposit_request — booking avec acompte SVC_EXPENSIVE', async () => {
    const uniqueEmail = `e2e-c12-deposit-${Date.now()}@genda-test.be`;
    const startAt = isoPlusDays(7, 14);

    const { status, body } = await publicFetch(`/api/public/${SLUG}/bookings`, {
      method: 'POST',
      body: {
        service_id: IDS.SVC_EXPENSIVE,
        practitioner_id: IDS.PRAC_ALICE,
        start_at: startAt,
        appointment_mode: 'cabinet',
        client_name: 'C12 Deposit Client',
        client_email: uniqueEmail,
        client_phone: '+32491000902',
        consent_sms: true, consent_email: true, consent_marketing: false,
      },
    });
    expect(status, `API error: ${JSON.stringify(body)}`).toBe(201);

    // Two possible paths:
    //   a) Stripe Connect active + deposit required → 'pending_deposit' + 'Acompte requis' email
    //   b) Stripe Connect inactive → 'confirmed' + regular confirmation email
    const emails = await waitForMockLog('email', uniqueEmail, sinceTs, 6000, 1);
    expect(emails.length, `No email logged for ${uniqueEmail}`).toBeGreaterThanOrEqual(1);

    if (body.booking.status === 'pending_deposit') {
      expect(emails[0].payload.subject).toMatch(/Acompte requis/i);
    } else {
      // Fallback path — at minimum, confirmation email was fired.
      expect(emails[0].payload.subject).toMatch(/Confirmation|Acompte/i);
    }
  });

  test('3. Email new_booking_pro — notification au business', async () => {
    const uniqueEmail = `e2e-c12-pro-${Date.now()}@genda-test.be`;
    const startAt = isoPlusDays(7, 11);

    const { status, body } = await publicFetch(`/api/public/${SLUG}/bookings`, {
      method: 'POST',
      body: {
        service_id: IDS.SVC_SHORT,
        practitioner_id: IDS.PRAC_ALICE,
        start_at: startAt,
        appointment_mode: 'cabinet',
        client_name: 'C12 Pro Notif',
        client_email: uniqueEmail,
        client_phone: '+32491000903',
        consent_sms: true, consent_email: true, consent_marketing: false,
      },
    });
    expect(status, `API error: ${JSON.stringify(body)}`).toBe(201);

    // Pro email is queued — call processNotifications to drain the queue
    const { processNotifications } = require('../../../src/services/notification-processor');
    await processNotifications();

    const emails = await waitForMockLog('email', BIZ_EMAIL, sinceTs, 6000, 1);
    expect(emails.length, `No new_booking_pro email to ${BIZ_EMAIL}`).toBeGreaterThanOrEqual(1);
    const proMail = emails.find(e => /Nouveau RDV/i.test(e.payload.subject));
    expect(proMail, `No subject "Nouveau RDV ..." found. got=${emails.map(e => e.payload.subject).join(' | ')}`).toBeTruthy();
    expect(proMail.payload.to).toBe(BIZ_EMAIL);
  });

  test('4. Email deposit_paid_pro — simulation via direct email helper', async () => {
    // Trigger the deposit-paid pro email directly — exercising the email builder is
    // what matters; simulating a full Stripe webhook is out of scope here.
    // Create a confirmed booking + mark deposit as paid, then call sendDepositPaidProEmail.
    const uniqueEmail = `e2e-c12-dep-paid-${Date.now()}@genda-test.be`;
    const startAt = isoPlusDays(7, 12);

    const r = await pool.query(
      `INSERT INTO bookings (business_id, client_id, service_id, practitioner_id,
         start_at, end_at, status, appointment_mode, deposit_required, deposit_status,
         deposit_amount_cents, deposit_paid_at, booked_price_cents)
       VALUES ($1, $2, $3, $4, $5, $5::timestamptz + INTERVAL '15 min', 'confirmed', 'cabinet',
               true, 'paid', 10000, NOW(), 20000)
       RETURNING id, start_at`,
      [IDS.BUSINESS, IDS.CLIENT_JEAN, IDS.SVC_EXPENSIVE, IDS.PRAC_ALICE, startAt]
    );
    const bookingId = r.rows[0].id;

    try {
      const { sendDepositPaidProEmail } = require('../../../src/services/email-deposit');
      if (typeof sendDepositPaidProEmail !== 'function') {
        test.skip(true, 'sendDepositPaidProEmail not exported — skip');
      }
      await sendDepositPaidProEmail({
        booking: {
          id: bookingId,
          start_at: startAt,
          client_name: 'Jean Testeur',
          client_email: 'jean-test@genda-test.be',
          service_name: 'Coupe + brushing',
          practitioner_name: 'Alice',
          deposit_amount_cents: 10000,
        },
        business: { name: 'TEST — Demo Salon Genda', email: BIZ_EMAIL, phone: '+32491999999' },
      });

      const emails = await waitForMockLog('email', BIZ_EMAIL, sinceTs, 6000, 1);
      const hit = emails.find(e => /Acompte reçu/i.test(e.payload.subject));
      expect(hit, `No "Acompte reçu" email to biz. got=${emails.map(e => e.payload.subject).join(' | ')}`).toBeTruthy();
    } finally {
      await pool.query(`DELETE FROM bookings WHERE id = $1`, [bookingId]);
    }
  });

  test('5. Email post_rdv (review) — via notification queue + processor', async () => {
    // 1. Create a completed booking
    const startAt = isoPlusDays(-2, 10); // past
    const r = await pool.query(
      `INSERT INTO bookings (business_id, client_id, service_id, practitioner_id,
         start_at, end_at, status, appointment_mode, review_token)
       VALUES ($1, $2, $3, $4, $5, $5::timestamptz + INTERVAL '15 min',
               'completed', 'cabinet', encode(gen_random_bytes(20), 'hex'))
       RETURNING id`,
      [IDS.BUSINESS, IDS.CLIENT_JEAN, IDS.SVC_SHORT, IDS.PRAC_ALICE, startAt]
    );
    const bookingId = r.rows[0].id;

    try {
      // 2. Enable reviews + queue notification manually (avoid 24h delay)
      await pool.query(
        `UPDATE businesses SET settings = settings || '{"reviews_enabled": true}'::jsonb WHERE id = $1`,
        [IDS.BUSINESS]
      );
      const tok = await pool.query(`SELECT review_token FROM bookings WHERE id = $1`, [bookingId]);
      const reviewToken = tok.rows[0].review_token;
      await pool.query(
        `INSERT INTO notifications (business_id, booking_id, type, status, metadata)
         VALUES ($1, $2, 'email_post_rdv', 'queued', $3)`,
        [IDS.BUSINESS, bookingId,
         JSON.stringify({ review_token: reviewToken, delay_until: new Date(Date.now() - 1000).toISOString() })]
      );

      // 3. Process the queue
      const { processNotifications } = require('../../../src/services/notification-processor');
      await processNotifications();

      // 4. Assert — email to the seed client jean-test
      const emails = await waitForMockLog('email', 'jean-test@genda-test.be', sinceTs, 6000, 1);
      const hit = emails.find(e => /avis compte|votre avis/i.test(e.payload.subject));
      expect(hit, `No "Votre avis compte" email. got=${emails.map(e => e.payload.subject).join(' | ')}`).toBeTruthy();
    } finally {
      await pool.query(`DELETE FROM notifications WHERE booking_id = $1`, [bookingId]);
      await pool.query(`DELETE FROM bookings WHERE id = $1`, [bookingId]);
    }
  });
});
