/**
 * Minisite test-mode access tokens.
 *
 * Replaces the previous pattern where the test-mode password was stored in
 * plaintext in the `minisite_access_<slug>` cookie. That leaked the password to
 * access logs, backups, Referer headers and any proxy in front of the request.
 *
 * We store an HMAC(slug + password, JWT_SECRET) token instead. The server
 * recomputes the HMAC on each request and compares. If the salon owner rotates
 * the test password, the HMAC changes and existing cookies stop matching —
 * which is the correct behaviour.
 */

const crypto = require('crypto');

function minisiteAccessToken(slug, password) {
  if (!slug || !password) return '';
  const secret = process.env.JWT_SECRET || 'genda-fallback-insecure-secret';
  return crypto.createHmac('sha256', secret)
    .update(`${slug}:${password}`)
    .digest('hex');
}

/**
 * Options for res.cookie / Set-Cookie. httpOnly prevents JS access, sameSite=lax
 * keeps it scoped to top-level navigations, secure gates HTTPS-only in prod.
 */
function minisiteAccessCookieOptions() {
  return {
    maxAge: 24 * 60 * 60 * 1000,
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production'
  };
}

module.exports = { minisiteAccessToken, minisiteAccessCookieOptions };
