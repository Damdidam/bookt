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
