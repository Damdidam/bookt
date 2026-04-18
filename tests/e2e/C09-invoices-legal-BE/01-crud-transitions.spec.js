/**
 * C09 / spec 01 — Invoices CRUD + transitions de statut (légal BE).
 *
 * Endpoints:
 *   POST   /api/invoices           — create draft (from booking or manual items)
 *   PATCH  /api/invoices/:id/status — transitions draft→sent→paid ; rejette paid→cancelled
 *   DELETE /api/invoices/:id        — delete (draft only)
 *
 * Règles BE (AR n°1 art.14) :
 *   - paid → cancelled INTERDIT (doit passer par credit note)
 *   - cancelled → * INTERDIT (immutable)
 *
 * 6 tests.
 */
const { test, expect } = require('@playwright/test');
const IDS = require('../fixtures/ids');
const { staffFetch } = require('../fixtures/api-client');
const { resetMutables } = require('../fixtures/reset-mutables');
const { pool } = require('../../../src/services/db');

async function cleanInvoices() {
  // Remove any invoice row created by previous tests (not part of seed).
  await pool.query(`DELETE FROM invoice_items WHERE invoice_id IN (SELECT id FROM invoices WHERE business_id = $1)`, [IDS.BUSINESS]);
  await pool.query(`DELETE FROM invoices WHERE business_id = $1`, [IDS.BUSINESS]);
}

test.describe('C09 — invoices : CRUD + transitions status', () => {
  let sinceTs;
  test.beforeEach(async () => {
    sinceTs = new Date(Date.now() - 1000).toISOString();
    await resetMutables();
    await cleanInvoices();
  });

  test('1. Create draft from booking → 201 + status=draft en DB', async () => {
    const res = await staffFetch('/api/invoices', {
      method: 'POST',
      body: {
        booking_id: IDS.BK_COMPLETED_1,
        client_id: IDS.CLIENT_MARIE,
        items: [{ description: 'Prestation test', quantity: 1, unit_price_cents: 5000, vat_rate: 21 }],
        vat_rate: 21,
      },
    });
    expect(res.status, `create: ${JSON.stringify(res.body)}`).toBe(201);
    expect(res.body.invoice).toBeTruthy();
    expect(res.body.invoice.status).toBe('draft');
    expect(res.body.invoice.type).toBe('invoice');

    // Verify in DB
    const r = await pool.query(`SELECT status, type FROM invoices WHERE id = $1`, [res.body.invoice.id]);
    expect(r.rows[0].status).toBe('draft');
  });

  test('2. Edit items of draft via re-POST → 201 (nouvelle facture avec items custom)', async () => {
    // The current API doesn't expose a PATCH /:id/items — instead items are provided at create.
    // Fallback: create a draft with specific items and validate they are stored.
    const res = await staffFetch('/api/invoices', {
      method: 'POST',
      body: {
        booking_id: IDS.BK_COMPLETED_1,
        client_id: IDS.CLIENT_MARIE,
        items: [
          { description: 'Coupe', quantity: 1, unit_price_cents: 3000, vat_rate: 21 },
          { description: 'Shampoing', quantity: 2, unit_price_cents: 500, vat_rate: 21 },
        ],
      },
    });
    expect(res.status, `edit-like: ${JSON.stringify(res.body)}`).toBe(201);

    const invoiceId = res.body.invoice.id;
    const items = await pool.query(`SELECT description, quantity, unit_price_cents FROM invoice_items WHERE invoice_id = $1 ORDER BY sort_order`, [invoiceId]);
    expect(items.rows.length).toBe(2);
    expect(items.rows[0].description).toBe('Coupe');
    expect(Number(items.rows[1].quantity)).toBe(2);
  });

  test('3. Transition draft → sent → 200 + invoice_number non null', async () => {
    const create = await staffFetch('/api/invoices', {
      method: 'POST',
      body: {
        booking_id: IDS.BK_COMPLETED_1,
        client_id: IDS.CLIENT_MARIE,
        items: [{ description: 'X', quantity: 1, unit_price_cents: 1000, vat_rate: 21 }],
      },
    });
    expect(create.status).toBe(201);
    const invoiceId = create.body.invoice.id;

    const tr = await staffFetch(`/api/invoices/${invoiceId}/status`, {
      method: 'PATCH', body: { status: 'sent' },
    });
    expect(tr.status, `sent: ${JSON.stringify(tr.body)}`).toBe(200);

    const r = await pool.query(`SELECT status, invoice_number FROM invoices WHERE id = $1`, [invoiceId]);
    expect(r.rows[0].status).toBe('sent');
    expect(r.rows[0].invoice_number).toMatch(/^F-\d{4}-\d{6}$/);
  });

  test('4. Transition sent → paid → 200', async () => {
    const create = await staffFetch('/api/invoices', {
      method: 'POST',
      body: { booking_id: IDS.BK_COMPLETED_1, client_id: IDS.CLIENT_MARIE,
        items: [{ description: 'X', quantity: 1, unit_price_cents: 1000, vat_rate: 21 }] },
    });
    expect(create.status).toBe(201);
    const invoiceId = create.body.invoice.id;

    await staffFetch(`/api/invoices/${invoiceId}/status`, { method: 'PATCH', body: { status: 'sent' } });
    const paid = await staffFetch(`/api/invoices/${invoiceId}/status`, { method: 'PATCH', body: { status: 'paid' } });
    expect(paid.status, `paid: ${JSON.stringify(paid.body)}`).toBe(200);

    const r = await pool.query(`SELECT status, paid_date FROM invoices WHERE id = $1`, [invoiceId]);
    expect(r.rows[0].status).toBe('paid');
    expect(r.rows[0].paid_date).not.toBeNull();
  });

  test('5. Transition paid → cancelled → REJET 400 (legal BE, doit passer par credit note)', async () => {
    const create = await staffFetch('/api/invoices', {
      method: 'POST',
      body: { booking_id: IDS.BK_COMPLETED_1, client_id: IDS.CLIENT_MARIE,
        items: [{ description: 'X', quantity: 1, unit_price_cents: 1000, vat_rate: 21 }] },
    });
    expect(create.status).toBe(201);
    const invoiceId = create.body.invoice.id;

    await staffFetch(`/api/invoices/${invoiceId}/status`, { method: 'PATCH', body: { status: 'sent' } });
    await staffFetch(`/api/invoices/${invoiceId}/status`, { method: 'PATCH', body: { status: 'paid' } });

    const tr = await staffFetch(`/api/invoices/${invoiceId}/status`, { method: 'PATCH', body: { status: 'cancelled' } });
    expect(tr.status).toBe(400);
    expect(String(tr.body.error || '').toLowerCase()).toMatch(/non autoris|transition/);
  });

  test('6. Transition cancelled → draft → REJET 400 (immutable)', async () => {
    const create = await staffFetch('/api/invoices', {
      method: 'POST',
      body: { booking_id: IDS.BK_COMPLETED_1, client_id: IDS.CLIENT_MARIE,
        items: [{ description: 'X', quantity: 1, unit_price_cents: 1000, vat_rate: 21 }] },
    });
    expect(create.status).toBe(201);
    const invoiceId = create.body.invoice.id;

    // draft → cancelled allowed
    const cancel = await staffFetch(`/api/invoices/${invoiceId}/status`, { method: 'PATCH', body: { status: 'cancelled' } });
    expect(cancel.status, `draft→cancelled: ${JSON.stringify(cancel.body)}`).toBe(200);

    // cancelled → draft REJET
    const back = await staffFetch(`/api/invoices/${invoiceId}/status`, { method: 'PATCH', body: { status: 'draft' } });
    expect(back.status).toBe(400);
    expect(String(back.body.error || '').toLowerCase()).toMatch(/non autoris|transition/);
  });
});
