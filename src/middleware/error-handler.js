/**
 * Global error handler.
 * Catches all errors from routes and returns a clean JSON response.
 */
function errorHandler(err, req, res, next) {
  console.error(`[ERROR] ${req.method} ${req.path}:`, err.message);

  if (process.env.NODE_ENV === 'development') {
    console.error(err.stack);
  }

  // Known error types
  if (err.type === 'validation') {
    return res.status(400).json({ error: err.message });
  }

  if (err.type === 'not_found') {
    return res.status(404).json({ error: err.message });
  }

  if (err.type === 'conflict') {
    return res.status(409).json({ error: err.message });
  }

  // PostgreSQL unique violation
  if (err.code === '23505') {
    return res.status(409).json({ error: 'Cette entrée existe déjà' });
  }

  // PostgreSQL foreign key violation
  if (err.code === '23503') {
    return res.status(400).json({ error: 'Référence invalide' });
  }

  // P0-01: PostgreSQL exclusion violation (bookings EXCLUDE constraint v81).
  // Retourné si 2 INSERT/UPDATE concurrents créent un chevauchement de créneau
  // sur le même practitioner. Pré-check `checkBookingConflicts` rate ces
  // chevauchements décalés (lock ponctuel par start_at) → DB-level EXCLUDE
  // est la dernière ligne de défense bulletproof.
  if (err.code === '23P01') {
    // `constraint` field expose le nom de la contrainte pour debug/log.
    if (err.constraint === 'bookings_no_overlap_active') {
      return res.status(409).json({ error: 'Ce créneau vient d\'être pris par un autre client. Merci de choisir un autre horaire.' });
    }
    return res.status(409).json({ error: 'Conflit détecté — action impossible sur ce créneau.' });
  }

  // Serve custom error page for browser requests
  const wantsHtml = (req.headers.accept || '').includes('text/html') && !req.path.startsWith('/api/');
  if (wantsHtml) {
    return res.status(500).sendFile(require('path').join(__dirname, '../../public/502.html'));
  }

  // M10: Default safe — only expose error in development mode explicitly
  res.status(500).json({
    error: process.env.NODE_ENV === 'development'
      ? err.message
      : 'Erreur interne du serveur'
  });
}

module.exports = errorHandler;
