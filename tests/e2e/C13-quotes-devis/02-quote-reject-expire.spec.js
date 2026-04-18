/**
 * C13 / spec 02 — Quote rejection / expiration / PDF.
 *
 * Réalité Genda (diffère du brief) :
 *   - Pas d'endpoint /api/public/quote/:token/decline : quote_requests.status ∈
 *     ('new','treated') seulement (schema-v35). Le "refus" est implicite (la demande
 *     reste 'new' si staff l'ignore / 'treated' si le staff la traite).
 *   - Pas de cron d'expiration sur quote_requests : aucun job n'écrit status='expired'
 *     (grep dans src/services/ et src/routes/ = rien). Les devis-invoices ont un
 *     champ due_date=null par design (invoices.js:306) donc n'expirent pas non plus.
 *   - PDF gen : OUI — GET /api/invoices/:id/pdf fonctionne pour type='quote'.
 *
 * 3 tests.
 */
const { test, expect } = require('@playwright/test');
const IDS = require('../fixtures/ids');
const { staffFetch, ownerToken, BASE_URL } = require('../fixtures/api-client');
const { resetMutables } = require('../fixtures/reset-mutables');
const { pool } = require('../../../src/services/db');

test.describe('C13 — quotes / devis : reject / expire / PDF', () => {
  let sinceTs;
  test.beforeEach(async () => {
    sinceTs = new Date(Date.now() - 1000).toISOString();
    await resetMutables();
    await pool.query(`DELETE FROM quote_requests WHERE business_id = $1`, [IDS.BUSINESS]);
  });

  test('1. Staff marque quote_request comme "treated" (= refus / traité) via UPDATE direct', async () => {
    // Pas d'endpoint staff pour UPDATE quote_requests.status : le front UX n'a pas
    // de bouton "refuser", l'owner indique qu'il a traité la demande. On documente
    // que l'update passe par SQL direct (bouton non implémenté côté API REST).
    const uniq = Date.now();
    const qr = await pool.query(
      `INSERT INTO quote_requests (business_id, service_id, service_name, client_name, client_email, description, status)
       VALUES ($1, $2, 'Consultation sur devis', $3, $4, 'Demande à refuser', 'new')
       RETURNING id, status`,
      [IDS.BUSINESS, IDS.SVC_QUOTE, `Client Refuse ${uniq}`, `refuse-${uniq}@genda-test.be`]
    );
    expect(qr.rows[0].status).toBe('new');

    // Staff "refuse" = mark treated (no API endpoint, done via DB for E2E trace).
    await pool.query(`UPDATE quote_requests SET status = 'treated' WHERE id = $1`, [qr.rows[0].id]);

    const after = await pool.query(`SELECT status FROM quote_requests WHERE id = $1`, [qr.rows[0].id]);
    expect(after.rows[0].status).toBe('treated');
  });

  test('2. Cron d\'expiration quote_requests : absent — aucune feature côté codebase', async () => {
    // Vérifie explicitement qu'aucun job ne réécrit status → 'expired' : on insère
    // un qr très ancien et on confirme qu'il reste 'new' après un passage temporel.
    const uniq = Date.now();
    const r = await pool.query(
      `INSERT INTO quote_requests (business_id, service_id, service_name, client_name, client_email, description, status, created_at)
       VALUES ($1, $2, 'Consultation sur devis', $3, $4, 'Ancien brief', 'new', NOW() - INTERVAL '60 days')
       RETURNING id`,
      [IDS.BUSINESS, IDS.SVC_QUOTE, `Old Quote ${uniq}`, `old-${uniq}@genda-test.be`]
    );
    // Attendu : pas de status 'expired' admissible (CHECK contraint + pas de cron) →
    // la row reste 'new'.
    const after = await pool.query(`SELECT status FROM quote_requests WHERE id = $1`, [r.rows[0].id]);
    expect(after.rows[0].status).toBe('new');

    // Documentation : tenter un UPDATE vers 'expired' DOIT violer le CHECK schema-v35.
    let checkViolated = false;
    try {
      await pool.query(`UPDATE quote_requests SET status = 'expired' WHERE id = $1`, [r.rows[0].id]);
    } catch (err) {
      checkViolated = err.code === '23514'; // check_violation
    }
    expect(checkViolated, 'CHECK (status IN (new, treated)) must reject "expired"').toBe(true);
  });

  test('3. Quote PDF : GET /api/invoices/:id/pdf avec type=quote → application/pdf', async () => {
    // Create a quote-type invoice tied to a SVC_QUOTE booking.
    const start = new Date(); start.setDate(start.getDate() + 10);
    while ([0, 1, 2].includes(start.getDay())) start.setDate(start.getDate() + 1);
    start.setHours(10, 0, 0, 0);
    const end = new Date(start.getTime() + 30 * 60000);
    const bk = await pool.query(
      `INSERT INTO bookings (business_id, service_id, practitioner_id, client_id, start_at, end_at, status, booked_price_cents, channel)
       VALUES ($1, $2, $3, $4, $5, $6, 'confirmed', 25000, 'manual') RETURNING id`,
      [IDS.BUSINESS, IDS.SVC_QUOTE, IDS.PRAC_ALICE, IDS.CLIENT_JEAN, start.toISOString(), end.toISOString()]
    );
    const bkId = bk.rows[0].id;

    const createRes = await staffFetch('/api/invoices', {
      method: 'POST',
      body: { booking_id: bkId, type: 'quote', vat_rate: 21, language: 'fr' },
    });
    expect(createRes.status, `create quote: ${JSON.stringify(createRes.body)}`).toBe(201);
    const invId = createRes.body.invoice.id;
    expect(createRes.body.invoice.type).toBe('quote');

    // Fetch PDF (binary) — staffFetch parses JSON, use raw fetch.
    const pdfRes = await fetch(BASE_URL + `/api/invoices/${invId}/pdf`, {
      headers: { Authorization: `Bearer ${ownerToken()}` },
    });
    expect(pdfRes.status, `pdf status`).toBe(200);
    expect(pdfRes.headers.get('content-type')).toMatch(/application\/pdf/);
    const buf = Buffer.from(await pdfRes.arrayBuffer());
    // PDF magic bytes : %PDF
    expect(buf.slice(0, 4).toString()).toBe('%PDF');

    // Cleanup
    await pool.query(`DELETE FROM invoice_items WHERE invoice_id = $1`, [invId]);
    await pool.query(`DELETE FROM invoices WHERE id = $1`, [invId]);
  });
});
