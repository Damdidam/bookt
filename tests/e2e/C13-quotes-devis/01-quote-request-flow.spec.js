/**
 * C13 / spec 01 — Quote request flow (client → staff → devis-invoice).
 *
 * Le flow Genda réel (diffère du brief) :
 *   1. Client soumet POST /api/public/:slug/quote-request      (quote_requests.status='new')
 *   2. Staff liste en joignant clients (pas de GET /api/quotes) — on SELECT la table.
 *      Ou staff voit le quote_request attaché au booking via GET /api/bookings/:id.
 *   3. Staff répond = émettre une facture-devis : POST /api/invoices type='quote'.
 *   4. Staff ou client peut ensuite créer un booking normal — pas de flow d'acceptation automatique.
 *
 * Il n'y a PAS d'endpoint /api/quotes respond/accept/decline dans la base de code.
 * La table `quote_requests` n'a que status IN ('new', 'treated') (schema-v35).
 *
 * 4 tests.
 */
const { test, expect } = require('@playwright/test');
const IDS = require('../fixtures/ids');
const { publicFetch, staffFetch } = require('../fixtures/api-client');
const { resetMutables } = require('../fixtures/reset-mutables');
const { pool } = require('../../../src/services/db');

const BIZ_SLUG = 'test-demo-salon';

test.describe('C13 — quotes / devis : request flow', () => {
  let sinceTs;
  test.beforeEach(async () => {
    sinceTs = new Date(Date.now() - 1000).toISOString();
    await resetMutables();
    // Purge quote_requests from previous tests (not part of resetMutables).
    await pool.query(`DELETE FROM quote_requests WHERE business_id = $1`, [IDS.BUSINESS]);
  });

  test('1. Client soumet quote-request (public) → 201 + row en DB status=new', async () => {
    const uniq = Date.now();
    const res = await publicFetch(`/api/public/${BIZ_SLUG}/quote-request`, {
      method: 'POST',
      body: {
        service_id: IDS.SVC_QUOTE,
        client_name: `Client Devis ${uniq}`,
        client_email: `devis-${uniq}@genda-test.be`,
        client_phone: '+32491000111',
        description: 'Demande de devis pour tatouage dragon avant-bras, couleur noir.',
        body_zone: 'Avant-bras',
        approx_size: '15cm x 10cm',
      },
    });
    expect(res.status, `quote-request: ${JSON.stringify(res.body)}`).toBe(201);
    expect(res.body.id).toBeTruthy();

    const r = await pool.query(
      `SELECT id, status, service_id, client_email, description, body_zone, approx_size
       FROM quote_requests WHERE id = $1`,
      [res.body.id]
    );
    expect(r.rows.length).toBe(1);
    expect(r.rows[0].status).toBe('new');
    expect(r.rows[0].service_id).toBe(IDS.SVC_QUOTE);
    expect(r.rows[0].client_email).toBe(`devis-${uniq}@genda-test.be`);
    expect(r.rows[0].body_zone).toBe('Avant-bras');
  });

  test('2. Staff voit la demande : attach au booking via GET /api/bookings/:id', async () => {
    const uniq = Date.now();
    const clientEmail = `devis2-${uniq}@genda-test.be`;
    // Insert quote_request direct (bypass email mocks).
    const qr = await pool.query(
      `INSERT INTO quote_requests (business_id, service_id, service_name, client_name, client_email, description)
       VALUES ($1, $2, 'Consultation sur devis', $3, $4, $5)
       RETURNING id`,
      [IDS.BUSINESS, IDS.SVC_QUOTE, `Client Devis ${uniq}`, clientEmail, 'Projet tatouage demo']
    );
    const qrId = qr.rows[0].id;

    // Create a client + booking tied to same email + service.
    const client = await pool.query(
      `INSERT INTO clients (business_id, full_name, email) VALUES ($1, $2, $3) RETURNING id`,
      [IDS.BUSINESS, `Client Devis ${uniq}`, clientEmail]
    );
    const start = new Date(); start.setDate(start.getDate() + 5);
    while ([0, 1, 2].includes(start.getDay())) start.setDate(start.getDate() + 1);
    start.setHours(10, 0, 0, 0);
    const end = new Date(start.getTime() + 30 * 60000);
    const bk = await pool.query(
      `INSERT INTO bookings (business_id, service_id, practitioner_id, client_id, start_at, end_at, status, booked_price_cents, channel)
       VALUES ($1, $2, $3, $4, $5, $6, 'confirmed', 0, 'manual') RETURNING id`,
      [IDS.BUSINESS, IDS.SVC_QUOTE, IDS.PRAC_ALICE, client.rows[0].id, start.toISOString(), end.toISOString()]
    );
    const bkId = bk.rows[0].id;

    const detail = await staffFetch(`/api/bookings/${bkId}/detail`);
    expect(detail.status, `booking detail: ${JSON.stringify(detail.body)}`).toBe(200);
    // bookings.js:252 exposes quote_request.
    expect(detail.body.quote_request).toBeTruthy();
    expect(detail.body.quote_request.id).toBe(qrId);
    expect(detail.body.quote_request.description).toBe('Projet tatouage demo');
  });

  test('3. Staff répond : POST /api/invoices type=quote → invoice créée', async () => {
    // Create a booking for SVC_QUOTE with explicit price (merchant sets it).
    const start = new Date(); start.setDate(start.getDate() + 6);
    while ([0, 1, 2].includes(start.getDay())) start.setDate(start.getDate() + 1);
    start.setHours(10, 0, 0, 0);
    const end = new Date(start.getTime() + 30 * 60000);
    const bk = await pool.query(
      `INSERT INTO bookings (business_id, service_id, practitioner_id, client_id, start_at, end_at, status, booked_price_cents, channel)
       VALUES ($1, $2, $3, $4, $5, $6, 'confirmed', 15000, 'manual') RETURNING id`,
      [IDS.BUSINESS, IDS.SVC_QUOTE, IDS.PRAC_ALICE, IDS.CLIENT_JEAN, start.toISOString(), end.toISOString()]
    );
    const bkId = bk.rows[0].id;

    const res = await staffFetch('/api/invoices', {
      method: 'POST',
      body: {
        booking_id: bkId,
        type: 'quote',
        vat_rate: 21,
        language: 'fr',
      },
    });
    expect(res.status, `create quote invoice: ${JSON.stringify(res.body)}`).toBe(201);
    expect(res.body.invoice).toBeTruthy();
    expect(res.body.invoice.type).toBe('quote');
    // Quote invoices have no due_date (invoices.js:306).
    expect(res.body.invoice.due_date).toBeFalsy();
    expect(res.body.invoice.status).toBe('draft');

    // Cleanup
    await pool.query(`DELETE FROM invoice_items WHERE invoice_id = $1`, [res.body.invoice.id]);
    await pool.query(`DELETE FROM invoices WHERE id = $1`, [res.body.invoice.id]);
  });

  test('4. Booking créé depuis SVC_QUOTE attaché au quote_request par email (client accepte implicitement)', async () => {
    // In Genda, client "accepts" by booking normally on SVC_QUOTE. The staff
    // then sees the quote_request attached via GET /api/bookings/:id (bookings.js:230 —
    // join qr.client_email = bk.client_email). Test : insert qr + create a booking for
    // that client + verify the quote_request surfaces on the booking detail.
    const uniq = Date.now();
    const email = `accept-${uniq}@genda-test.be`;
    const qr = await pool.query(
      `INSERT INTO quote_requests (business_id, service_id, service_name, client_name, client_email, description)
       VALUES ($1, $2, 'Consultation sur devis', $3, $4, 'Brief du projet')
       RETURNING id`,
      [IDS.BUSINESS, IDS.SVC_QUOTE, `Client Accept ${uniq}`, email]
    );
    const qrId = qr.rows[0].id;

    const client = await pool.query(
      `INSERT INTO clients (business_id, full_name, email) VALUES ($1, $2, $3) RETURNING id`,
      [IDS.BUSINESS, `Client Accept ${uniq}`, email]
    );

    // Create booking via staff /manual endpoint with explicit price (quote service).
    const start = new Date(); start.setDate(start.getDate() + 8);
    while ([0, 1, 2].includes(start.getDay())) start.setDate(start.getDate() + 1);
    start.setHours(11, 0, 0, 0);
    const createRes = await staffFetch('/api/bookings/manual', {
      method: 'POST',
      body: {
        service_id: IDS.SVC_QUOTE,
        practitioner_id: IDS.PRAC_ALICE,
        client_id: client.rows[0].id,
        start_at: start.toISOString(),
        skip_confirmation: true,
        appointment_mode: 'cabinet',
      },
    });
    expect(createRes.status, `booking manual: ${JSON.stringify(createRes.body)}`).toBe(201);
    const bkId = createRes.body.booking.id;

    // Booking detail should surface the quote_request (match on client_email + service_id).
    const detail = await staffFetch(`/api/bookings/${bkId}/detail`);
    expect(detail.status).toBe(200);
    expect(detail.body.quote_request).toBeTruthy();
    expect(detail.body.quote_request.id).toBe(qrId);
  });
});
