/**
 * C09 / spec 04 — Export CSV + communication structurée + numérotation séquentielle.
 *
 * Endpoints:
 *   GET /api/invoices/export  → text/csv
 *
 * Note : endpoint réel = /export (pas /export/csv comme spec initiale).
 *
 * 3 tests.
 */
const { test, expect } = require('@playwright/test');
const IDS = require('../fixtures/ids');
const { staffFetch, ownerToken, BASE_URL } = require('../fixtures/api-client');
const { resetMutables } = require('../fixtures/reset-mutables');
const { pool } = require('../../../src/services/db');

async function cleanInvoices() {
  await pool.query(`DELETE FROM invoice_items WHERE invoice_id IN (SELECT id FROM invoices WHERE business_id = $1)`, [IDS.BUSINESS]);
  await pool.query(`DELETE FROM invoices WHERE business_id = $1`, [IDS.BUSINESS]);
}

async function createDraft(desc = 'Prestation') {
  const c = await staffFetch('/api/invoices', {
    method: 'POST',
    body: {
      booking_id: IDS.BK_COMPLETED_1,
      client_id: IDS.CLIENT_MARIE,
      items: [{ description: desc, quantity: 1, unit_price_cents: 2500, vat_rate: 21 }],
    },
  });
  if (c.status !== 201) throw new Error(`create: ${c.status} ${JSON.stringify(c.body)}`);
  return c.body.invoice;
}

async function createAndSend() {
  const inv = await createDraft();
  const tr = await staffFetch(`/api/invoices/${inv.id}/status`, { method: 'PATCH', body: { status: 'sent' } });
  if (tr.status !== 200) throw new Error(`status sent: ${tr.status} ${JSON.stringify(tr.body)}`);
  const r = await pool.query(`SELECT invoice_number FROM invoices WHERE id = $1`, [inv.id]);
  return { id: inv.id, invoice_number: r.rows[0].invoice_number };
}

test.describe('C09 — invoices : export CSV + structured_comm + numbering', () => {
  let sinceTs;
  test.beforeEach(async () => {
    sinceTs = new Date(Date.now() - 1000).toISOString();
    await resetMutables();
    await cleanInvoices();
  });

  test('1. Export CSV → Content-Type text/csv + header + BOM', async () => {
    // Seed au moins 1 invoice
    await createDraft('Prestation CSV');

    const token = ownerToken();
    const res = await fetch(BASE_URL + `/api/invoices/export`, {
      method: 'GET',
      headers: { 'Authorization': `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type') || '').toMatch(/text\/csv/);
    // Node's fetch auto-strips the UTF-8 BOM from .text(); read raw bytes to verify it.
    const buf = Buffer.from(await res.arrayBuffer());
    // BOM UTF-8 = 0xEF 0xBB 0xBF
    expect(buf[0]).toBe(0xEF);
    expect(buf[1]).toBe(0xBB);
    expect(buf[2]).toBe(0xBF);
    const body = buf.toString('utf-8');
    expect(body).toMatch(/Numéro/);
    expect(body).toMatch(/Prestation CSV/);
  });

  test('2. structured_comm unique par facture (2 invoices → 2 structured_comm différents)', async () => {
    const inv1 = await createDraft('A');
    const inv2 = await createDraft('B');

    const r = await pool.query(
      `SELECT structured_comm FROM invoices WHERE id IN ($1, $2) ORDER BY created_at`,
      [inv1.id, inv2.id]
    );
    expect(r.rows.length).toBe(2);
    expect(r.rows[0].structured_comm).toBeTruthy();
    expect(r.rows[1].structured_comm).toBeTruthy();
    expect(r.rows[0].structured_comm).not.toBe(r.rows[1].structured_comm);
    // format BE +++XXX/XXXX/XXXXX+++
    expect(r.rows[0].structured_comm).toMatch(/^\+\+\+\d{3}\/\d{4}\/\d{5}\+\+\+$/);
  });

  test('3. Numérotation F-YYYY-NNNNNN séquentielle : 2e = 1er+1', async () => {
    const first = await createAndSend();
    const second = await createAndSend();

    // Parse numéros : F-2026-000001, F-2026-000002
    const parseSeq = (num) => parseInt(num.split('-')[2], 10);
    expect(parseSeq(second.invoice_number)).toBe(parseSeq(first.invoice_number) + 1);
    // Same year
    expect(first.invoice_number.split('-')[1]).toBe(second.invoice_number.split('-')[1]);
  });
});
