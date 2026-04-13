/**
 * AES-256-GCM symmetric encryption for sensitive at-rest data
 * (OAuth refresh/access tokens for calendar connections).
 *
 * Key source: env CALENDAR_TOKEN_KEY (32-byte base64 or 64-char hex).
 * Format:    enc:v1:<base64(iv|authTag|ciphertext)>
 *
 * Backward compat: decryptToken() returns plaintext unchanged if the value
 * does not start with the "enc:v1:" prefix. This lets legacy tokens keep
 * working until they are next refreshed (and re-encrypted on write).
 */
const crypto = require('crypto');

const PREFIX = 'enc:v1:';
const ALG = 'aes-256-gcm';
const IV_LEN = 12;
const TAG_LEN = 16;

let _keyCache = null;
function getKey() {
  if (_keyCache) return _keyCache;
  const raw = process.env.CALENDAR_TOKEN_KEY;
  if (!raw) return null;
  let buf;
  if (/^[0-9a-fA-F]{64}$/.test(raw)) {
    buf = Buffer.from(raw, 'hex');
  } else {
    try { buf = Buffer.from(raw, 'base64'); } catch (_) { buf = null; }
  }
  if (!buf || buf.length !== 32) {
    console.warn('[CRYPTO] CALENDAR_TOKEN_KEY is set but is not a valid 32-byte key (hex64 or base64). Tokens will be stored plaintext.');
    return null;
  }
  _keyCache = buf;
  return buf;
}

function encryptToken(plain) {
  if (plain == null || plain === '') return plain;
  const key = getKey();
  if (!key) return plain; // no key configured — fall back to plaintext (legacy)
  const iv = crypto.randomBytes(IV_LEN);
  const cipher = crypto.createCipheriv(ALG, key, iv);
  const enc = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return PREFIX + Buffer.concat([iv, tag, enc]).toString('base64');
}

function decryptToken(stored) {
  if (stored == null || stored === '') return stored;
  if (typeof stored !== 'string' || !stored.startsWith(PREFIX)) return stored; // legacy plaintext
  const key = getKey();
  if (!key) {
    console.warn('[CRYPTO] Encrypted token found but CALENDAR_TOKEN_KEY missing — cannot decrypt.');
    return null;
  }
  try {
    const buf = Buffer.from(stored.slice(PREFIX.length), 'base64');
    const iv = buf.subarray(0, IV_LEN);
    const tag = buf.subarray(IV_LEN, IV_LEN + TAG_LEN);
    const enc = buf.subarray(IV_LEN + TAG_LEN);
    const decipher = crypto.createDecipheriv(ALG, key, iv);
    decipher.setAuthTag(tag);
    const dec = Buffer.concat([decipher.update(enc), decipher.final()]);
    return dec.toString('utf8');
  } catch (e) {
    console.error('[CRYPTO] Token decryption failed:', e.message);
    return null;
  }
}

module.exports = { encryptToken, decryptToken };
