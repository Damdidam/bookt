/**
 * Peppol integration via Billit API.
 *
 * Wraps the 3 things we need :
 * 1. buildUBLXml(stripeInvoice, emitter, recipient) — deterministic UBL 2.1 BIS 3.0 XML
 * 2. sendInvoice(subInvoiceRow) — POST Billit with timeout + row update
 * 3. handleWebhook(body, signature) — validate HMAC + UPDATE status
 *
 * Every public function must be safe to call even if Billit is down : INSERT
 * rows in 'pending' state and let the cron retry. No throw that could crash
 * the Stripe webhook handler.
 *
 * See docs/superpowers/specs/2026-04-21-peppol-integration-design.md
 */
const { query } = require('./db');

let _settingsCache = null;
let _settingsCacheAt = 0;
const SETTINGS_TTL_MS = 60 * 60 * 1000; // 1h

async function loadPlatformSettings() {
  if (_settingsCache && Date.now() - _settingsCacheAt < SETTINGS_TTL_MS) {
    return _settingsCache;
  }
  const r = await query(`SELECT * FROM platform_settings WHERE id = 1 LIMIT 1`);
  if (r.rows.length === 0) return null;
  _settingsCache = r.rows[0];
  _settingsCacheAt = Date.now();
  return _settingsCache;
}

function _invalidateSettingsCache() {
  _settingsCache = null;
  _settingsCacheAt = 0;
}

module.exports = {
  loadPlatformSettings,
  _invalidateSettingsCache  // for tests
};
