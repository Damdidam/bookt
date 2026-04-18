/**
 * C12 / spec 04 — Emails transactionnels (GC / passes / waitlist / invoice).
 *
 * 6 tests.
 * Assertions via test_mock_log avec SKIP_EMAIL=1.
 *
 * Mapping kind (subject[0..50]) :
 *   - '🎁 Vous avez reçu une carte cadeau — …' (recipient email)
 *     'Carte cadeau envoyée — …'            (receipt email to buyer)
 *     'Carte cadeau achetée — … € — …'       (pro notif)
 *   - 'Votre pass … — …'                    (pass purchase client)
 *     'Pass acheté — … — …'                  (pass purchase pro)
 *   - 'Votre carte cadeau expire le … — …'   (GC expiry warning)
 *   - 'Votre pass expire le … — …'           (pass expiry warning)
 *   - 'Créneau disponible — …'               (waitlist offer)
 */
const { test, expect } = require('@playwright/test');
const IDS = require('../fixtures/ids');
const { waitForMockLog } = require('../fixtures/api-client');
const { resetMutables } = require('../fixtures/reset-mutables');
const { pool } = require('../../../src/services/db');

const BIZ_EMAIL = 'test-bookt@genda.be';

test.describe('C12 — transactional emails', () => {
  let sinceTs;

  test.beforeEach(async () => {
    sinceTs = new Date(Date.now() - 1000).toISOString();
    await resetMutables();
    await pool.query(`DELETE FROM test_mock_log WHERE created_at < NOW() - INTERVAL '1 minute'`);
  });

  test('1. Email gift card purchase — direct helper call', async () => {
    const buyerEmail = `e2e-gc-buyer-${Date.now()}@genda-test.be`;
    const recipientEmail = `e2e-gc-rcpt-${Date.now()}@genda-test.be`;

    const { sendGiftCardEmail, sendGiftCardReceiptEmail, sendGiftCardPurchaseProEmail } =
      require('../../../src/services/email-misc');

    const giftCard = {
      code: 'E2EGC001TST', amount_cents: 5000, expires_at: new Date(Date.now() + 180 * 86400000),
      buyer_email: buyerEmail, buyer_name: 'GC Buyer',
      recipient_email: recipientEmail, recipient_name: 'GC Recipient',
      message: 'Bon anniversaire'
    };
    const business = { name: 'TEST — Demo Salon Genda', email: BIZ_EMAIL, slug: 'test-demo-salon',
                       theme: {}, address: '1 rue du Test', phone: '+32491999999' };

    await sendGiftCardEmail({ giftCard, business });
    await sendGiftCardReceiptEmail({ giftCard, business });
    await sendGiftCardPurchaseProEmail({ giftCard, business });

    const rcptEmails = await waitForMockLog('email', recipientEmail, sinceTs, 6000, 1);
    expect(rcptEmails.length, `No recipient email`).toBeGreaterThanOrEqual(1);
    expect(rcptEmails[0].payload.subject).toMatch(/carte cadeau/i);

    const buyerEmails = await waitForMockLog('email', buyerEmail, sinceTs, 6000, 1);
    expect(buyerEmails[0].payload.subject).toMatch(/Carte cadeau envoyée/i);

    const proEmails = await waitForMockLog('email', BIZ_EMAIL, sinceTs, 6000, 1);
    const hit = proEmails.find(e => /Carte cadeau achetée/i.test(e.payload.subject));
    expect(hit).toBeTruthy();
  });

  test('2. Email pass purchase — direct helper call', async () => {
    const buyerEmail = `e2e-pass-buyer-${Date.now()}@genda-test.be`;

    const { sendPassPurchaseEmail, sendPassPurchaseProEmail } = require('../../../src/services/email-misc');

    const pass = {
      code: 'E2EPASS01TST', name: 'Pack 5 séances', sessions_total: 5, price_cents: 20000,
      buyer_email: buyerEmail, buyer_name: 'Pass Buyer',
      service_name: 'Coupe', expires_at: new Date(Date.now() + 180 * 86400000)
    };
    const business = { name: 'TEST — Demo Salon Genda', email: BIZ_EMAIL, slug: 'test-demo-salon',
                       theme: {}, phone: '+32491999999' };

    await sendPassPurchaseEmail({ pass, business });
    await sendPassPurchaseProEmail({ pass, business });

    const buyerEmails = await waitForMockLog('email', buyerEmail, sinceTs, 6000, 1);
    expect(buyerEmails[0].payload.subject).toMatch(/Votre pass/i);

    const proEmails = await waitForMockLog('email', BIZ_EMAIL, sinceTs, 6000, 1);
    const hit = proEmails.find(e => /Pass acheté/i.test(e.payload.subject));
    expect(hit).toBeTruthy();
  });

  test('3. Email expiry warning J-7 GC → processGiftCardExpiryWarnings()', async () => {
    const recipientEmail = `e2e-gcexp-${Date.now()}@genda-test.be`;
    // Insert an active GC expiring in 5 days with balance > 0 and expiry_warning_sent_at = NULL
    const expiresAt = new Date(Date.now() + 5 * 86400000).toISOString();
    const r = await pool.query(
      `INSERT INTO gift_cards (business_id, code, amount_cents, balance_cents,
         buyer_email, buyer_name, recipient_email, recipient_name, status, expires_at,
         expiry_warning_sent_at)
       VALUES ($1, $2, 5000, 5000, $3, 'Buyer', $4, 'Rcpt', 'active', $5, NULL)
       RETURNING id`,
      [IDS.BUSINESS, ('GX' + Date.now().toString(36)).slice(0, 12),
       'buyer-' + recipientEmail, recipientEmail, expiresAt]
    );
    const gcId = r.rows[0].id;

    try {
      const { processGiftCardExpiryWarnings } = require('../../../src/services/giftcard-expiry');
      const result = await processGiftCardExpiryWarnings();
      expect(result.processed, `processGiftCardExpiryWarnings=${JSON.stringify(result)}`).toBeGreaterThanOrEqual(1);

      const emails = await waitForMockLog('email', recipientEmail, sinceTs, 6000, 1);
      const hit = emails.find(e => /expire le/i.test(e.payload.subject));
      expect(hit, `No GC expiry warn email. got=${emails.map(e => e.payload.subject).join(' | ')}`).toBeTruthy();

      // Flag set
      const after = await pool.query(`SELECT expiry_warning_sent_at FROM gift_cards WHERE id = $1`, [gcId]);
      expect(after.rows[0].expiry_warning_sent_at).not.toBeNull();
    } finally {
      await pool.query(`DELETE FROM gift_cards WHERE id = $1`, [gcId]);
    }
  });

  test('4. Email expiry warning J-7 pass → processPassExpiryWarnings()', async () => {
    const buyerEmail = `e2e-passexp-${Date.now()}@genda-test.be`;
    const expiresAt = new Date(Date.now() + 5 * 86400000).toISOString();
    const r = await pool.query(
      `INSERT INTO passes (business_id, service_id, code, name, sessions_total, sessions_remaining,
         price_cents, buyer_email, buyer_name, status, expires_at, expiry_warning_sent_at)
       VALUES ($1, $2, $3, 'Test Pass', 5, 3, 15000, $4, 'Buyer Test', 'active', $5, NULL)
       RETURNING id`,
      [IDS.BUSINESS, IDS.SVC_PASS, ('PX' + Date.now().toString(36)).slice(0, 12),
       buyerEmail, expiresAt]
    );
    const passId = r.rows[0].id;

    try {
      const { processPassExpiryWarnings } = require('../../../src/services/pass-expiry');
      const result = await processPassExpiryWarnings();
      expect(result.processed, `processPassExpiryWarnings=${JSON.stringify(result)}`).toBeGreaterThanOrEqual(1);

      const emails = await waitForMockLog('email', buyerEmail, sinceTs, 6000, 1);
      const hit = emails.find(e => /expire le/i.test(e.payload.subject));
      expect(hit, `No pass expiry warn email. got=${emails.map(e => e.payload.subject).join(' | ')}`).toBeTruthy();

      const after = await pool.query(`SELECT expiry_warning_sent_at FROM passes WHERE id = $1`, [passId]);
      expect(after.rows[0].expiry_warning_sent_at).not.toBeNull();
    } finally {
      await pool.query(`DELETE FROM passes WHERE id = $1`, [passId]);
    }
  });

  test('5. Email waitlist offer — cancellation d\'un slot qui matche WL_MARIE', async () => {
    // WL_MARIE has preferred_days=[] preferred_time='any' → matches any slot.
    // Set Bob's waitlist_mode = 'auto' so offer email fires.
    await pool.query(`UPDATE practitioners SET waitlist_mode = 'auto' WHERE id = $1`, [IDS.PRAC_BOB]);
    // Ensure WL_MARIE is 'waiting'
    await pool.query(`UPDATE waitlist_entries SET status = 'waiting', offer_token = NULL WHERE id = $1`, [IDS.WL_MARIE]);

    // Create a confirmed booking for Bob that we'll treat as "cancelled" for waitlist trigger.
    // Slot must be > 2h in the future.
    const startAt = new Date(Date.now() + 48 * 3600000).toISOString(); // +2 days
    const r = await pool.query(
      `INSERT INTO bookings (business_id, client_id, service_id, practitioner_id,
         start_at, end_at, status, appointment_mode)
       VALUES ($1, $2, $3, $4, $5, $5::timestamptz + INTERVAL '15 min',
               'cancelled', 'cabinet')
       RETURNING id`,
      [IDS.BUSINESS, IDS.CLIENT_JEAN, IDS.SVC_SHORT, IDS.PRAC_BOB, startAt]
    );
    const bookingId = r.rows[0].id;

    try {
      const { processWaitlistForCancellation } = require('../../../src/services/waitlist');
      const result = await processWaitlistForCancellation(bookingId, IDS.BUSINESS);
      expect(result.processed, `waitlist result=${JSON.stringify(result)}`).toBe(true);
      expect(result.mode).toBe('auto');

      const emails = await waitForMockLog('email', 'marie-test@genda-test.be', sinceTs, 6000, 1);
      const hit = emails.find(e => /Créneau disponible/i.test(e.payload.subject));
      expect(hit, `No waitlist offer email. got=${emails.map(e => e.payload.subject).join(' | ')}`).toBeTruthy();
    } finally {
      await pool.query(`UPDATE waitlist_entries SET status='waiting', offer_token=NULL, offer_sent_at=NULL, offer_expires_at=NULL WHERE id = $1`, [IDS.WL_MARIE]);
      await pool.query(`DELETE FROM bookings WHERE id = $1`, [bookingId]);
      await pool.query(`UPDATE practitioners SET waitlist_mode = 'off' WHERE id = $1`, [IDS.PRAC_BOB]);
    }
  });

  test('6. Email invoice sent — PATCH status="sent" (DOC/BUG : pas d\'email auto)', async () => {
    // Contract: PATCH /api/invoices/:id/status ne déclenche PAS d'email. Vérifier qu'aucun
    // email n'est loggé, et documenter ce gap. Si un jour l'email est implémenté, ce test
    // devra être étendu.
    test.info().annotations.push({
      type: 'doc',
      description: 'PATCH /api/invoices/:id/status n\'envoie pas d\'email (feature manquante)'
    });
    // Minimal sanity check: the route exists and accepts status transitions
    const { staffFetch } = require('../fixtures/api-client');
    // Create an invoice row to patch — simplest: use the builder endpoint
    const r = await pool.query(
      `INSERT INTO invoices (business_id, invoice_number, type, issue_date, status,
         subtotal_cents, total_cents, client_name, client_email, business_name)
       VALUES ($1, $2, 'invoice', CURRENT_DATE, 'draft', 1000, 1210, 'C12 test',
               'c12-inv@genda-test.be', 'TEST — Demo Salon Genda')
       RETURNING id`,
      [IDS.BUSINESS, ('E2E/' + Date.now().toString().slice(-8)).slice(0, 30)]
    );
    const invId = r.rows[0].id;
    try {
      const resp = await staffFetch(`/api/invoices/${invId}/status`, {
        method: 'PATCH', body: { status: 'sent' },
      });
      expect(resp.status).toBe(200);

      // No email should be fired for the invoice — status change is a DB-only op today.
      const emails = await waitForMockLog('email', 'c12-inv@genda-test.be', sinceTs, 2000, 1);
      expect(emails.length, `Unexpected invoice email — spec needs update. got=${emails.map(e => e.payload.subject).join(' | ')}`).toBe(0);
    } finally {
      await pool.query(`DELETE FROM invoices WHERE id = $1`, [invId]);
    }
  });
});
