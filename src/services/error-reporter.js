/**
 * Error reporter — wrapper pour Sentry.captureException avec fallback no-op
 * si SENTRY_DSN absent. Utilisé dans les catchers critiques (refunds,
 * webhook handlers, bookings creation rollback) qui ne remontent pas via
 * errorHandler express.
 *
 * Avant : `catch (e) { console.warn(...) }` = erreur invisible en prod.
 * Maintenant : `catch (e) { reportError(e, { ctx }) }` = log + Sentry si DSN.
 */
let _sentry = null;
try {
  if (process.env.SENTRY_DSN) {
    _sentry = require('@sentry/node');
  }
} catch (_) { _sentry = null; }

/**
 * Log + capture Sentry si configuré.
 * @param {Error} err
 * @param {Object} [context] - tags/extras pour Sentry (ex: { bookingId, piId })
 */
function reportError(err, context = {}) {
  const msg = err?.message || String(err);
  const tag = context.tag || 'unknown';
  console.error(`[${tag}]`, msg, context);
  if (_sentry && _sentry.captureException) {
    try {
      _sentry.withScope(scope => {
        for (const [k, v] of Object.entries(context)) {
          if (k === 'tag') scope.setTag('tag', v);
          else scope.setExtra(k, v);
        }
        _sentry.captureException(err);
      });
    } catch (_) { /* Sentry failure should never break business flow */ }
  }
}

module.exports = { reportError };
