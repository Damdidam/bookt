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
