/**
 * E2E helpers: fetch authentifié staff/public + DB mock log query.
 */
const jwt = require('jsonwebtoken');
const IDS = require('./ids');
const BASE_URL = process.env.APP_BASE_URL || 'https://genda.be';

function signTestToken(userId, businessId, role = 'owner') {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error('JWT_SECRET missing — cannot sign test token');
  // Match production JWT shape (auth.js:51 uses userId + businessId) so auth.js:40
  // reads decoded.userId correctly.
  return jwt.sign(
    { userId, businessId, id: userId, business_id: businessId, role },
    secret,
    { expiresIn: '1h' }
  );
}

function ownerToken() {
  return signTestToken(IDS.USER_ALICE_OWNER, IDS.BUSINESS, 'owner');
}
function staffToken() {
  return signTestToken(IDS.USER_BOB_STAFF, IDS.BUSINESS, 'practitioner');
}

async function staffFetch(path, opts = {}) {
  const token = opts.token || ownerToken();
  const headers = { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json', ...(opts.headers || {}) };
  const res = await fetch(BASE_URL + path, {
    method: opts.method || 'GET', headers,
    body: opts.body ? JSON.stringify(opts.body) : undefined
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

async function publicFetch(path, opts = {}) {
  const headers = { 'Content-Type': 'application/json', ...(opts.headers || {}) };
  const res = await fetch(BASE_URL + path, {
    method: opts.method || 'GET', headers,
    body: opts.body ? JSON.stringify(opts.body) : undefined
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

async function getMockLogs(type, sinceTs) {
  const { pool } = require('../../../src/services/db');
  const r = await pool.query(
    `SELECT * FROM test_mock_log WHERE type = $1 AND created_at >= $2 ORDER BY created_at DESC`,
    [type, sinceTs]
  );
  return r.rows;
}

/**
 * Poll test_mock_log until at least N matching rows appear (or timeout).
 * Nécessaire car sendEmail/sendSMS sont fire-and-forget (appelés sans await
 * après le res 201) — le test doit attendre que le handler async termine.
 * @param {'email'|'sms'} type
 * @param {string} recipient - exact match on recipient col
 * @param {string} sinceTs - ISO timestamp
 * @param {number} [timeoutMs=5000]
 * @param {number} [minCount=1]
 * @returns {Promise<object[]>} rows (may be empty on timeout)
 */
async function waitForMockLog(type, recipient, sinceTs, timeoutMs = 5000, minCount = 1) {
  const { pool } = require('../../../src/services/db');
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const r = await pool.query(
      `SELECT * FROM test_mock_log WHERE type = $1 AND recipient = $2 AND created_at >= $3 ORDER BY created_at DESC`,
      [type, recipient, sinceTs]
    );
    if (r.rows.length >= minCount) return r.rows;
    await new Promise(res => setTimeout(res, 250));
  }
  return [];
}

module.exports = { BASE_URL, signTestToken, ownerToken, staffToken, staffFetch, publicFetch, getMockLogs, waitForMockLog };
