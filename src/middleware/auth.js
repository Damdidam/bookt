const jwt = require('jsonwebtoken');
const { query } = require('../services/db');

/**
 * Auth middleware for staff API routes.
 * Expects: Authorization: Bearer <jwt>
 * Sets: req.user (id, email, role), req.businessId
 */
async function requireAuth(req, res, next) {
  try {
    const authHeader = req.headers.authorization;
    const queryToken = req.query.token; // Support ?token= for PDF downloads
    if (!authHeader && !queryToken) {
      return res.status(401).json({ error: 'Token manquant' });
    }

    const token = authHeader ? authHeader.split(' ')[1] : queryToken;

    let decoded;
    try {
      decoded = jwt.verify(token, process.env.JWT_SECRET);
    } catch (err) {
      if (err.name === 'TokenExpiredError') {
        return res.status(401).json({ error: 'Session expirée, reconnectez-vous' });
      }
      return res.status(401).json({ error: 'Token invalide' });
    }

    // Fetch user + business (verify still active)
    const result = await query(
      `SELECT u.id, u.email, u.role, u.business_id, b.slug, b.plan
       FROM users u
       JOIN businesses b ON b.id = u.business_id
       WHERE u.id = $1 AND u.is_active = true AND b.is_active = true`,
      [decoded.userId]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Compte désactivé ou introuvable' });
    }

    const user = result.rows[0];
    req.user = {
      id: user.id,
      email: user.email,
      role: user.role
    };
    req.businessId = user.business_id;
    req.businessSlug = user.slug;
    req.businessPlan = user.plan;

    next();
  } catch (err) {
    next(err);
  }
}

/**
 * Require owner role (for destructive operations)
 */
function requireOwner(req, res, next) {
  if (req.user.role !== 'owner') {
    return res.status(403).json({ error: 'Accès réservé au propriétaire du cabinet' });
  }
  next();
}

module.exports = { requireAuth, requireOwner };
