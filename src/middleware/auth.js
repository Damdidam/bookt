const jwt = require('jsonwebtoken');
const { query } = require('../services/db');

/**
 * Auth middleware for staff API routes.
 * Expects: Authorization: Bearer <jwt>
 * Sets: req.user (id, email, role, practitionerId), req.businessId, req.businessSector
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

    // Fetch user + business + linked practitioner in one query
    const result = await query(
      `SELECT u.id, u.email, u.role, u.business_id,
              b.slug, b.plan, b.sector,
              p.id AS practitioner_id
       FROM users u
       JOIN businesses b ON b.id = u.business_id
       LEFT JOIN practitioners p ON p.user_id = u.id AND p.business_id = u.business_id AND p.is_active = true
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
      role: user.role,
      practitionerId: user.practitioner_id || null
    };
    req.businessId = user.business_id;
    req.businessSlug = user.slug;
    req.businessPlan = user.plan;
    req.businessSector = user.sector || 'autre';

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

/**
 * Require one of the specified roles.
 * Usage: requireRole('owner', 'manager')
 *        requireRole('owner', 'manager', 'receptionist')
 *
 * Role hierarchy (for reference, NOT auto-inherited):
 *   owner        → full access
 *   manager      → agenda all, clients, documents, waitlist
 *   receptionist → agenda all (read/create/modify), clients
 *   practitioner → own agenda, own clients (read only mostly)
 */
function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user || !req.user.role) {
      return res.status(401).json({ error: 'Non authentifié' });
    }
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Accès non autorisé pour votre rôle' });
    }
    next();
  };
}

/**
 * For practitioner role: restrict to their own data.
 * Adds req.practitionerFilter (UUID or null).
 */
function resolvePractitionerScope(req, res, next) {
  if (req.user.role === 'practitioner' && req.user.practitionerId) {
    req.practitionerFilter = req.user.practitionerId;
  } else {
    req.practitionerFilter = null;
  }
  next();
}

module.exports = { requireAuth, requireOwner, requireRole, resolvePractitionerScope };
