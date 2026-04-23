const assert = require('node:assert/strict');
const test = require('node:test');

// Mock db BEFORE requiring peppol
const _mockRows = [];
require.cache[require.resolve('../src/services/db')] = {
  exports: {
    query: async (sql, params) => {
      if (/FROM platform_settings/.test(sql)) return { rows: _mockRows };
      return { rows: [] };
    },
    pool: {}
  }
};

const peppol = require('../src/services/peppol');

test('loadPlatformSettings returns null when no row', async () => {
  _mockRows.length = 0;
  peppol._invalidateSettingsCache();
  const res = await peppol.loadPlatformSettings();
  assert.equal(res, null);
});

test('loadPlatformSettings returns row when seeded', async () => {
  peppol._invalidateSettingsCache();
  _mockRows.splice(0, _mockRows.length, {
    id: 1,
    company_name: 'H3001 SRL',
    vat_number: 'BE0775599330',
    bce_number: '0775599330',
    address_street: '183 rue de la Montagne',
    address_zip: '6110',
    address_city: 'Montigny Le Tilleul',
    address_country: 'BE',
    contact_email: 'info@genda.be'
  });
  const res = await peppol.loadPlatformSettings();
  assert.equal(res.company_name, 'H3001 SRL');
  assert.equal(res.vat_number, 'BE0775599330');
});

test('buildUBLXml generates valid UBL 2.1 BIS 3.0 XML', () => {
  const emitter = {
    company_name: 'H3001 SRL',
    vat_number: 'BE0775599330',
    bce_number: '0775599330',
    address_street: '183 rue de la Montagne',
    address_zip: '6110',
    address_city: 'Montigny Le Tilleul',
    address_country: 'BE',
    contact_email: 'info@genda.be'
  };
  const recipient = {
    name: 'Acme Salon SRL',
    vat_number: 'BE0123456789',
    address: 'Rue de Test 10, 1000 Bruxelles, BE',
    email: 'boss@acme.be'
  };
  const stripeInvoice = {
    id: 'in_test_123',
    number: 'INV-0001',
    currency: 'eur',
    period_start: 1745107200,
    period_end: 1747699200,
    subtotal: 6000,
    tax: 1260,
    total: 7260,
    lines: {
      data: [{
        description: 'Abonnement Genda PRO — avril 2026',
        amount: 6000,
        currency: 'eur',
        period: { start: 1745107200, end: 1747699200 },
        tax_amounts: [{ amount: 1260, tax_rate: { percentage: 21 } }]
      }]
    }
  };
  const xml = peppol.buildUBLXml(stripeInvoice, emitter, recipient);
  assert.match(xml, /^<\?xml version="1\.0"/);
  assert.match(xml, /urn:cen\.eu:en16931:2017#compliant#urn:fdc:peppol\.eu:2017:poacc:billing:3\.0/);
  assert.match(xml, /<cbc:ID>INV-0001<\/cbc:ID>/);
  assert.match(xml, /<cbc:EndpointID schemeID="0208">0775599330<\/cbc:EndpointID>/);
  assert.match(xml, /<cbc:EndpointID schemeID="0208">0123456789<\/cbc:EndpointID>/);
  assert.match(xml, /<cbc:TaxInclusiveAmount currencyID="EUR">72\.60<\/cbc:TaxInclusiveAmount>/);
  assert.match(xml, /<cbc:TaxAmount currencyID="EUR">12\.60<\/cbc:TaxAmount>/);
  assert.match(xml, /<cbc:ID>S<\/cbc:ID>/);
  assert.match(xml, /<cbc:Percent>21<\/cbc:Percent>/);
});

test('buildUBLXml handles recipient without VAT (fallback scheme 9925)', () => {
  const emitter = {
    company_name: 'H3001 SRL', vat_number: 'BE0775599330', bce_number: '0775599330',
    address_street: 'X', address_zip: '1000', address_city: 'Y', address_country: 'BE',
    contact_email: 'info@genda.be'
  };
  const recipient = { name: 'Particulier', vat_number: null, address: '', email: 'p@x.be' };
  const stripeInvoice = {
    id: 'in_test_2', number: 'INV-0002', currency: 'eur',
    period_start: 1745107200, period_end: 1747699200,
    subtotal: 6000, tax: 1260, total: 7260,
    lines: { data: [{ description: 'Abo', amount: 6000, currency: 'eur',
      period: { start: 1745107200, end: 1747699200 },
      tax_amounts: [{ amount: 1260, tax_rate: { percentage: 21 } }] }] }
  };
  const xml = peppol.buildUBLXml(stripeInvoice, emitter, recipient);
  assert.match(xml, /INV-0002/);
  // Scope strictement à la partie customer — le supplier DOIT avoir son CompanyID BE (BIS 3.0 required)
  const customerBlock = /<cac:AccountingCustomerParty>[\s\S]*?<\/cac:AccountingCustomerParty>/.exec(xml)[0];
  assert.doesNotMatch(customerBlock, /<cbc:CompanyID>BE/);
  // Check positif : fallback scheme 9925 avec email
  assert.match(xml, /<cbc:EndpointID schemeID="9925">p@x\.be<\/cbc:EndpointID>/);
});

test('dispatchFromStripeInvoice inserts row + calls Billit + updates on success', async () => {
  peppol._invalidateSettingsCache();
  _mockRows.splice(0, _mockRows.length, {
    id: 1, company_name: 'H3001 SRL', vat_number: 'BE0775599330', bce_number: '0775599330',
    address_street: 'X', address_zip: '1000', address_city: 'Y', address_country: 'BE',
    contact_email: 'info@genda.be'
  });

  const calls = [];
  const dbMock = require.cache[require.resolve('../src/services/db')].exports;
  const origQuery = dbMock.query;
  dbMock.query = async (sql, params) => {
    calls.push({ sql: sql.replace(/\s+/g, ' ').trim(), params });
    if (/FROM platform_settings/.test(sql)) return { rows: _mockRows };
    if (/INSERT INTO subscription_invoices/.test(sql)) return { rows: [{ id: 'uuid-stub' }] };
    if (/FROM businesses/.test(sql)) return { rows: [{ id: 'biz-uuid' }] };
    return { rows: [] };
  };

  const origFetch = global.fetch;
  process.env.BILLIT_API_URL = 'https://api.sandbox.billit.be/v1';
  process.env.BILLIT_API_KEY = 'fake_test_key';
  global.fetch = async (url, opts) => {
    if (url.includes('billit.be')) {
      return { ok: true, status: 200, json: async () => ({ invoiceId: 'billit_xyz' }) };
    }
    return { ok: false, status: 404 };
  };

  const stripeInvoice = {
    id: 'in_test_999',
    number: 'INV-0099',
    currency: 'eur',
    customer: 'cus_stub',
    subscription: 'sub_stub',
    subtotal: 6000, tax: 1260, total: 7260,
    period_start: 1745107200, period_end: 1747699200,
    invoice_pdf: 'https://stripe.com/pdf',
    customer_address: { line1: 'Rue X 10', postal_code: '1000', city: 'Bruxelles', country: 'BE' },
    customer_email: 'acme@test.be',
    customer_name: 'Acme Salon',
    customer_tax_ids: [{ type: 'eu_vat', value: 'BE0123456789' }],
    lines: {
      data: [{
        description: 'Abo Pro',
        amount: 6000,
        currency: 'eur',
        period: { start: 1745107200, end: 1747699200 },
        tax_amounts: [{ amount: 1260, tax_rate: { percentage: 21 } }]
      }]
    }
  };

  await peppol.dispatchFromStripeInvoice(stripeInvoice);

  const insertCall = calls.find(c => /INSERT INTO subscription_invoices/.test(c.sql));
  assert.ok(insertCall, 'Expected INSERT into subscription_invoices');
  assert.equal(insertCall.params[1], 'in_test_999');
  assert.equal(insertCall.params[2], 'INV-0099');

  // Expected success update
  const updateCall = calls.find(c => /UPDATE subscription_invoices/.test(c.sql) && /peppol_sent/.test(c.sql));
  assert.ok(updateCall, 'Expected UPDATE to peppol_sent');

  dbMock.query = origQuery;
  global.fetch = origFetch;
  delete process.env.BILLIT_API_URL;
  delete process.env.BILLIT_API_KEY;
});

test('dispatchFromStripeInvoice keeps row pending when Billit env missing', async () => {
  peppol._invalidateSettingsCache();
  _mockRows.splice(0, _mockRows.length, {
    id: 1, company_name: 'H3001 SRL', vat_number: 'BE0775599330', bce_number: '0775599330',
    address_street: 'X', address_zip: '1000', address_city: 'Y', address_country: 'BE',
    contact_email: 'info@genda.be'
  });

  const calls = [];
  const dbMock = require.cache[require.resolve('../src/services/db')].exports;
  const origQuery = dbMock.query;
  dbMock.query = async (sql, params) => {
    calls.push({ sql: sql.replace(/\s+/g, ' ').trim(), params });
    if (/FROM platform_settings/.test(sql)) return { rows: _mockRows };
    if (/INSERT INTO subscription_invoices/.test(sql)) return { rows: [{ id: 'uuid-stub' }] };
    if (/FROM businesses/.test(sql)) return { rows: [{ id: 'biz-uuid' }] };
    return { rows: [] };
  };

  delete process.env.BILLIT_API_URL;
  delete process.env.BILLIT_API_KEY;

  const stripeInvoice = {
    id: 'in_test_nokey',
    number: 'INV-0100',
    currency: 'eur',
    customer: 'cus_stub',
    subscription: 'sub_stub',
    subtotal: 6000, tax: 1260, total: 7260,
    period_start: 1745107200, period_end: 1747699200,
    invoice_pdf: null,
    customer_address: { country: 'BE' },
    customer_email: 'x@y.be',
    customer_name: 'Client',
    customer_tax_ids: [],
    lines: { data: [{ amount: 6000, currency: 'eur', period:{start:0,end:0}, tax_amounts: [{amount:1260, tax_rate:{percentage:21}}] }] }
  };

  await peppol.dispatchFromStripeInvoice(stripeInvoice);

  // INSERT toujours fait — row doit exister
  const insertCall = calls.find(c => /INSERT INTO subscription_invoices/.test(c.sql));
  assert.ok(insertCall, 'INSERT doit avoir lieu même sans Billit config');
  // UPDATE status_detail seulement (pas peppol_sent), row reste pending
  const updateStatusDetail = calls.find(c => /UPDATE subscription_invoices/.test(c.sql) && /status_detail/.test(c.sql));
  assert.ok(updateStatusDetail, 'UPDATE status_detail attendu avec reason BILLIT not configured');

  dbMock.query = origQuery;
});

const crypto = require('node:crypto');

test('handleWebhook validates HMAC and updates status', async () => {
  process.env.BILLIT_WEBHOOK_SECRET = 'test_secret_123';
  const calls = [];
  const dbMock = require.cache[require.resolve('../src/services/db')].exports;
  const origQuery = dbMock.query;
  dbMock.query = async (sql, params) => {
    calls.push({ sql: sql.replace(/\s+/g, ' ').trim(), params });
    return { rows: [{ id: 'uuid' }] };
  };

  const payload = JSON.stringify({
    invoiceId: 'billit_abc',
    event: 'delivered',
    detail: 'Received by recipient'
  });
  const signature = crypto.createHmac('sha256', 'test_secret_123').update(payload).digest('hex');

  const result = await peppol.handleWebhook(payload, signature);
  assert.equal(result.ok, true);
  const updateCall = calls.find(c => /UPDATE subscription_invoices/.test(c.sql));
  assert.ok(updateCall, 'UPDATE subscription_invoices attendu');
  assert.equal(updateCall.params[0], 'peppol_delivered');
  assert.equal(updateCall.params[2], 'billit_abc');

  dbMock.query = origQuery;
  delete process.env.BILLIT_WEBHOOK_SECRET;
});

test('handleWebhook rejects invalid signature', async () => {
  process.env.BILLIT_WEBHOOK_SECRET = 'test_secret_123';
  const result = await peppol.handleWebhook('{}', 'not-a-valid-sig');
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'invalid_signature');
  delete process.env.BILLIT_WEBHOOK_SECRET;
});

test('handleWebhook rejects when secret missing', async () => {
  delete process.env.BILLIT_WEBHOOK_SECRET;
  const result = await peppol.handleWebhook('{}', 'any');
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'webhook_secret_missing');
});

test('handleWebhook rejects invalid JSON', async () => {
  process.env.BILLIT_WEBHOOK_SECRET = 'test_secret_123';
  const rawBody = 'not-json';
  const sig = crypto.createHmac('sha256', 'test_secret_123').update(rawBody).digest('hex');
  const result = await peppol.handleWebhook(rawBody, sig);
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'invalid_json');
  delete process.env.BILLIT_WEBHOOK_SECRET;
});

test('handleWebhook rejects unknown event', async () => {
  process.env.BILLIT_WEBHOOK_SECRET = 'test_secret_123';
  const payload = JSON.stringify({ invoiceId: 'x', event: 'unknown_event' });
  const sig = crypto.createHmac('sha256', 'test_secret_123').update(payload).digest('hex');
  const result = await peppol.handleWebhook(payload, sig);
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'unknown_event');
  delete process.env.BILLIT_WEBHOOK_SECRET;
});
