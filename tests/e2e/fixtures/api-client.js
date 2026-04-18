/**
 * E2E helpers: fetch authentifié staff/public + DB mock log query.
 */
const jwt = require('jsonwebtoken');
const IDS = require('./ids');
const BASE_URL = process.env.APP_BASE_URL || 'https://genda.be';

function signTestToken(userId, businessId, role = 'owner') {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error('JWT_SECRET missing — cannot sign test token');
  return jwt.sign(
    { id: userId, business_id: businessId, role },
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

module.exports = { BASE_URL, signTestToken, ownerToken, staffToken, staffFetch, publicFetch, getMockLogs };
