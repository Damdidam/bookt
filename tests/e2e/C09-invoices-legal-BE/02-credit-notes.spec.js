/**
 * C09 / spec 02 — Notes de crédit (legal BE AR n°1 art.14).
 *
 * Endpoint:
 *   POST /api/invoices/:id/credit-note
 *
 * Règles:
 *   - invoice status ∈ {sent, paid, overdue} → credit note autorisé
 *   - draft/cancelled → REJET 400
 *   - type='quote' → REJET 400
 *   - existe déjà → REJET 409
 *   - totaux négatifs, related_invoice_id = original
 *
 * 5 tests.
 */
const { test, expect } = require('@playwright/test');
const IDS = require('../fixtures/ids');
const { staffFetch } = require('../fixtures/api-client');
const { resetMutables } = require('../fixtures/reset-mutables');
const { pool } = require('../../../src/services/db');

async function cleanInvoices() {
  await pool.query(`DELETE FROM invoice_items WHERE invoice_id IN (SELECT id FROM invoices WHERE business_id = $1)`, [IDS.BUSINESS]);
  await pool.query(`DELETE FROM invoices WHERE business_id = $1`, [IDS.BUSINESS]);
}

async function createAndTransition(targetStatus) {
  const c = await staffFetch('/api/invoices', {
    method: 'POST',
    body: {
      booking_id: IDS.BK_COMPLETED_1,
      client_id: IDS.CLIENT_MARIE,
      items: [{ description: 'Prestation', quantity: 1, unit_price_cents: 5000, vat_rate: 21 }],
    },
  });
  if (c.status !== 201) throw new Error(`create failed: ${c.status} ${JSON.stringify(c.body)}`);
  const id = c.body.invoice.id;
  if (targetStatus === 'draft') return id;
  await staffFetch(`/api/invoices/${id}/status`, { method: 'PATCH', body: { status: 'sent' } });
  if (targetStatus === 'sent') return id;
  if (targetStatus === 'paid') {
    await staffFetch(`/api/invoices/${id}/status`, { method: 'PATCH', body: { status: 'paid' } });
    return id;
  }
  return id;
}

test.describe('C09 — invoices : notes de crédit', () => {
  let sinceTs;
  test.beforeEach(async () => {
    sinceTs = new Date(Date.now() - 1000).toISOString();
    await resetMutables();
    await cleanInvoices();
  });

  test('1. Credit note from paid invoice → 201 + type=credit_note + totals négatifs + related_invoice_id', async () => {
    const origId = await createAndTransition('paid');

    const res = await staffFetch(`/api/invoices/${origId}/credit-note`, {
      method: 'POST', body: { reason: 'Remboursement client' },
    });
    expect(res.status, `cn from paid: ${JSON.stringify(res.body)}`).toBe(201);
    expect(res.body.credit_note).toBeTruthy();
    expect(res.body.credit_note.type).toBe('credit_note');
    expect(res.body.credit_note.total_cents).toBeLessThan(0);
    expect(res.body.credit_note.related_invoice_id).toBe(origId);
    expect(res.body.credit_note.invoice_number).toMatch(/^NC-\d{4}-\d{6}$/);
  });

  test('2. Credit note from sent invoice → 201', async () => {
    const origId = await createAndTransition('sent');
    const res = await staffFetch(`/api/invoices/${origId}/credit-note`, {
      method: 'POST', body: {},
    });
    expect(res.status, `cn from sent: ${JSON.stringify(res.body)}`).toBe(201);
    expect(res.body.credit_note.related_invoice_id).toBe(origId);
  });

  test('3. Credit note from draft invoice → REJET 400', async () => {
    const origId = await createAndTransition('draft');
    const res = await staffFetch(`/api/invoices/${origId}/credit-note`, {
      method: 'POST', body: {},
    });
    expect(res.status).toBe(400);
    expect(String(res.body.error || '').toLowerCase()).toMatch(/sent\/paid\/overdue|autoris/);
  });

  test('4. Credit note from type=quote → REJET 400', async () => {
    // Create directly an invoice with type='quote' + status='sent'
    const r = await pool.query(
      `INSERT INTO invoices (business_id, client_id, invoice_number, type, status,
        issue_date, client_name, business_name, subtotal_cents, vat_amount_cents, total_cents, vat_rate)
       VALUES ($1, $2, $3, 'quote', 'sent', CURRENT_DATE, 'Test Client', 'TEST Biz', 1000, 210, 1000, 21)
       RETURNING id`,
      [IDS.BUSINESS, IDS.CLIENT_MARIE, `D-${new Date().getFullYear()}-${String(Date.now()).slice(-6)}`]
    );
    const quoteId = r.rows[0].id;

    const res = await staffFetch(`/api/invoices/${quoteId}/credit-note`, {
      method: 'POST', body: {},
    });
    expect(res.status).toBe(400);
    expect(String(res.body.error || '').toLowerCase()).toMatch(/devis|quote/);
  });

  test('5. Double credit note same invoice → 409', async () => {
    const origId = await createAndTransition('paid');

    const first = await staffFetch(`/api/invoices/${origId}/credit-note`, {
      method: 'POST', body: {},
    });
    expect(first.status, `first cn: ${JSON.stringify(first.body)}`).toBe(201);

    const second = await staffFetch(`/api/invoices/${origId}/credit-note`, {
      method: 'POST', body: {},
    });
    expect(second.status).toBe(409);
    expect(String(second.body.error || '').toLowerCase()).toMatch(/existe\s*d[ée]j[àa]/);
  });
});
