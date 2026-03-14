/**
 * OAuth Service — Client authentication for booking
 * Supports Google, Apple, Facebook
 * Reuses the same pattern as calendar-sync.js (native fetch, no passport)
 */

const crypto = require('crypto');
const jwt = require('jsonwebtoken');

// ============================================================
// GOOGLE
// ============================================================

const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_USERINFO_URL = 'https://www.googleapis.com/oauth2/v2/userinfo';

function getGoogleAuthUrl(state, redirectUri) {
  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'openid email profile',
    access_type: 'online',
    prompt: 'select_account',
    state
  });
  return `${GOOGLE_AUTH_URL}?${params}`;
}

async function exchangeGoogleCode(code, redirectUri) {
  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code'
    }),
    signal: AbortSignal.timeout(15000)
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(`Google token exchange failed: ${res.status} ${err.error_description || err.error || ''}`);
  }
  return res.json();
}

async function getGoogleUserInfo(accessToken) {
  const res = await fetch(GOOGLE_USERINFO_URL, {
    headers: { 'Authorization': `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(15000)
  });
  if (!res.ok) throw new Error(`Google userinfo failed: ${res.status}`);
  const data = await res.json();
  return {
    email: data.email,
    name: data.name || data.given_name || '',
    providerId: data.id
  };
}

// ============================================================
// APPLE
// ============================================================

const APPLE_AUTH_URL = 'https://appleid.apple.com/auth/authorize';
const APPLE_TOKEN_URL = 'https://appleid.apple.com/auth/token';

/**
 * Generate Apple client_secret (ES256 JWT)
 * Must be regenerated for each token exchange (max 6 months validity)
 */
function generateAppleClientSecret() {
  const privateKey = process.env.APPLE_PRIVATE_KEY;
  if (!privateKey) throw new Error('APPLE_PRIVATE_KEY not configured');

  const now = Math.floor(Date.now() / 1000);
  return jwt.sign({}, privateKey.replace(/\\n/g, '\n'), {
    algorithm: 'ES256',
    expiresIn: '5m',
    issuer: process.env.APPLE_TEAM_ID,
    subject: process.env.APPLE_CLIENT_ID,
    audience: 'https://appleid.apple.com',
    header: {
      alg: 'ES256',
      kid: process.env.APPLE_KEY_ID
    }
  });
}

function getAppleAuthUrl(state, redirectUri) {
  const params = new URLSearchParams({
    client_id: process.env.APPLE_CLIENT_ID,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'name email',
    response_mode: 'form_post',
    state
  });
  return `${APPLE_AUTH_URL}?${params}`;
}

async function exchangeAppleCode(code, redirectUri) {
  const clientSecret = generateAppleClientSecret();
  const res = await fetch(APPLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: process.env.APPLE_CLIENT_ID,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code'
    }),
    signal: AbortSignal.timeout(15000)
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(`Apple token exchange failed: ${res.status} ${err.error || ''}`);
  }
  return res.json();
}

/**
 * Extract user info from Apple id_token (JWT)
 * Apple doesn't have a userinfo endpoint — info is in the id_token
 * The `user` object (with name) is only sent on first authorization
 */
function getAppleUserInfo(idToken, userObj) {
  // Decode id_token without verifying (we trust Apple's TLS)
  const payload = JSON.parse(Buffer.from(idToken.split('.')[1], 'base64url').toString());
  let name = '';
  if (userObj) {
    try {
      const u = typeof userObj === 'string' ? JSON.parse(userObj) : userObj;
      if (u.name) {
        name = [u.name.firstName, u.name.lastName].filter(Boolean).join(' ');
      }
    } catch (e) { /* ignore */ }
  }
  return {
    email: payload.email || '',
    name,
    providerId: payload.sub
  };
}

// ============================================================
// FACEBOOK
// ============================================================

const FB_AUTH_URL = 'https://www.facebook.com/v19.0/dialog/oauth';
const FB_TOKEN_URL = 'https://graph.facebook.com/v19.0/oauth/access_token';
const FB_USERINFO_URL = 'https://graph.facebook.com/v19.0/me';

function getFacebookAuthUrl(state, redirectUri) {
  const params = new URLSearchParams({
    client_id: process.env.FACEBOOK_APP_ID,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'email,public_profile',
    state
  });
  return `${FB_AUTH_URL}?${params}`;
}

async function exchangeFacebookCode(code, redirectUri) {
  // Facebook token exchange uses GET with query params (not POST body)
  const params = new URLSearchParams({
    code,
    client_id: process.env.FACEBOOK_APP_ID,
    client_secret: process.env.FACEBOOK_APP_SECRET,
    redirect_uri: redirectUri
  });
  const url = `${FB_TOKEN_URL}?${params}`;
  console.log('[OAUTH] Facebook token URL:', url.replace(process.env.FACEBOOK_APP_SECRET, '***'));
  const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
  const text = await res.text();
  console.log('[OAUTH] Facebook token response:', res.status, text.slice(0, 500));
  let data;
  try { data = JSON.parse(text); } catch (e) {
    throw new Error(`Facebook response not JSON (${res.status}): ${text.slice(0, 200)}`);
  }
  if (!res.ok || !data?.access_token) {
    throw new Error(`Facebook token exchange failed: ${res.status} ${data?.error?.message || JSON.stringify(data)}`);
  }
  return data;
}

async function getFacebookUserInfo(accessToken) {
  const res = await fetch(`${FB_USERINFO_URL}?fields=id,email,name&access_token=${encodeURIComponent(accessToken)}`, {
    signal: AbortSignal.timeout(15000)
  });
  if (!res.ok) throw new Error(`Facebook userinfo failed: ${res.status}`);
  const data = await res.json();
  return {
    email: data.email || '',
    name: data.name || '',
    providerId: data.id
  };
}

// ============================================================
// UNIFIED API
// ============================================================

const PROVIDERS = {
  google: {
    configured: () => !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET),
    getAuthUrl: getGoogleAuthUrl,
    exchangeCode: exchangeGoogleCode,
    getUserInfo: (tokens) => getGoogleUserInfo(tokens.access_token)
  },
  apple: {
    configured: () => !!(process.env.APPLE_CLIENT_ID && process.env.APPLE_TEAM_ID && process.env.APPLE_KEY_ID && process.env.APPLE_PRIVATE_KEY),
    getAuthUrl: getAppleAuthUrl,
    exchangeCode: exchangeAppleCode,
    getUserInfo: (tokens, userObj) => Promise.resolve(getAppleUserInfo(tokens.id_token, userObj))
  },
  facebook: {
    configured: () => !!(process.env.FACEBOOK_APP_ID && process.env.FACEBOOK_APP_SECRET),
    getAuthUrl: getFacebookAuthUrl,
    exchangeCode: exchangeFacebookCode,
    getUserInfo: (tokens) => getFacebookUserInfo(tokens.access_token)
  }
};

function isProviderConfigured(provider) {
  return PROVIDERS[provider]?.configured() || false;
}

function getConfiguredProviders() {
  return Object.keys(PROVIDERS).filter(p => PROVIDERS[p].configured());
}

function getAuthUrl(provider, state, redirectUri) {
  const p = PROVIDERS[provider];
  if (!p) throw new Error(`Unknown provider: ${provider}`);
  if (!p.configured()) throw new Error(`Provider ${provider} not configured`);
  return p.getAuthUrl(state, redirectUri);
}

async function exchangeCode(provider, code, redirectUri) {
  const p = PROVIDERS[provider];
  if (!p) throw new Error(`Unknown provider: ${provider}`);
  return p.exchangeCode(code, redirectUri);
}

async function getUserInfo(provider, tokens, extra) {
  const p = PROVIDERS[provider];
  if (!p) throw new Error(`Unknown provider: ${provider}`);
  return p.getUserInfo(tokens, extra);
}

module.exports = {
  isProviderConfigured,
  getConfiguredProviders,
  getAuthUrl,
  exchangeCode,
  getUserInfo
};
