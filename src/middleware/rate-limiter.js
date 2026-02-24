const rateLimit = require('express-rate-limit');

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
  legacyHeaders: false
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
  legacyHeaders: false
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
  legacyHeaders: false
});

module.exports = { bookingLimiter, slotsLimiter, authLimiter };
