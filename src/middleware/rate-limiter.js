const rateLimit = require('express-rate-limit');

/**
 * E2E bypass : si DISABLE_RATE_LIMIT=1 (uniquement set dans l'env du serveur local
 * lancé pour tests E2E), tous les limiters sautent. En prod : rate limiters actifs normalement.
 */
const e2eBypass = () => process.env.DISABLE_RATE_LIMIT === '1';

/**
 * Rate limiter for public booking creation.
 * Prevents spam-booking (filling an agenda with fake RDVs).
 * 5 bookings per hour per IP.
 */
const bookingLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 5,
  message: { error: 'Trop de réservations. Réessayez dans une heure.' },
  standardHeaders: true,
  legacyHeaders: false,
  skip: e2eBypass
});

/**
 * Rate limiter for public slot fetching.
 * Prevents scraping availability data.
 * 60 requests per minute per IP.
 */
const slotsLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 60,
  message: { error: 'Trop de requêtes. Réessayez dans une minute.' },
  standardHeaders: true,
  legacyHeaders: false,
  skip: e2eBypass
});

/**
 * Rate limiter for auth (magic link requests).
 * 5 attempts per 15 minutes per IP.
 */
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5,
  message: { error: 'Trop de tentatives. Réessayez dans 15 minutes.' },
  standardHeaders: true,
  legacyHeaders: false,
  skip: e2eBypass
});

/**
 * Rate limiter for client-phone PII lookup.
 * 15 requests per 10 minutes per IP — OAuth flow + form blurs + retries can exceed 5.
 */
const clientPhoneLimiter = rateLimit({
  windowMs: 10 * 60 * 1000, // 10 minutes
  max: 15,
  message: { error: 'Trop de tentatives. Réessayez plus tard.' },
  standardHeaders: true,
  legacyHeaders: false,
  skip: e2eBypass
});

/**
 * Rate limiter for deposit checkout/pay.
 * 10 requests per 15 minutes per IP to prevent abuse.
 */
const depositLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10,
  message: { error: 'Trop de tentatives de paiement. Réessayez plus tard.' },
  standardHeaders: true,
  legacyHeaders: false,
  skip: e2eBypass
});

/**
 * Rate limiter for booking action routes (cancel, confirm, reject).
 * 20 requests per minute per IP to prevent brute-force token guessing.
 */
const bookingActionLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  message: { error: 'Trop de requêtes. Réessayez dans une minute.' },
  standardHeaders: true,
  legacyHeaders: false,
  skip: e2eBypass
});

/**
 * Rate limiter for admin routes.
 * 60 requests per minute per IP.
 */
const adminLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  message: { error: 'Trop de requêtes admin.' },
  standardHeaders: true,
  legacyHeaders: false,
  skip: e2eBypass
});

/**
 * Rate limiter for authenticated staff routes.
 * 120 requests per minute per IP — prevent abuse from compromised tokens.
 */
const staffLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  message: { error: 'Trop de requêtes. Réessayez dans une minute.' },
  standardHeaders: true,
  legacyHeaders: false,
  skip: e2eBypass
});

/**
 * Rate limiter for "retrouver mon RDV" feature (email lookup).
 * 5 requests per 15 minutes per IP — prevent spam relay + email enumeration.
 */
const lookupLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: { error: 'Trop de tentatives. Réessayez dans 15 minutes.' },
  standardHeaders: true,
  legacyHeaders: false,
  skip: e2eBypass
});

/**
 * Rate limiter for admin impersonation (H#9 fix).
 * 10 requests per 15 minutes — impersonation mints a 1h-valid JWT per call,
 * so we keep a stricter cap than `adminLimiter` (60/min → 3600/h of potential
 * tokens). 10 per 15min = 40/h max, plenty for legitimate support work.
 */
const impersonateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { error: 'Trop de tentatives d\'impersonation.' },
  standardHeaders: true,
  legacyHeaders: false,
  skip: e2eBypass
});

/**
 * Rate limiter for iCal subscription feed (H#10 fix).
 * 30 requests per minute per IP — legitimate calendar clients poll the feed
 * on ~15 min intervals, 30/min/IP leaves room for shared-NAT offices while
 * blocking brute-force of the 192-bit secret token.
 */
const icalLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  message: { error: 'Too many feed requests.' },
  standardHeaders: true,
  legacyHeaders: false,
  skip: e2eBypass
});

module.exports = { bookingLimiter, slotsLimiter, authLimiter, clientPhoneLimiter, depositLimiter, bookingActionLimiter, adminLimiter, staffLimiter, lookupLimiter, impersonateLimiter, icalLimiter };
