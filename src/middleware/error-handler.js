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

  // Default
  res.status(500).json({
    error: process.env.NODE_ENV === 'production'
      ? 'Erreur interne du serveur'
      : err.message
  });
}

module.exports = errorHandler;
