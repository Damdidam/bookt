const router = require('express').Router();
const crypto = require('crypto');
const { query, queryWithRLS } = require('../../services/db');
const { requireAuth, requireOwner } = require('../../middleware/auth');
const cal = require('../../services/calendar-sync');

// Store OAuth state tokens temporarily (in production use Redis)
const oauthStates = new Map();

// ============================================================
// OAuth2 CONNECT FLOWS
// ============================================================

/**
 * GET /api/calendar/google/connect
 * Redirects to Google OAuth consent screen
 */
router.get('/google/connect', requireAuth, (req, res) => {
  if (!process.env.GOOGLE_CLIENT_ID) {
    return res.status(501).json({ error: 'Google Calendar non configuré' });
  }
  const state = crypto.randomBytes(24).toString('hex');
  oauthStates.set(state, {
    userId: req.user.id,
    businessId: req.businessId,
    provider: 'google',
    expiresAt: Date.now() + 10 * 60000
  });
  const url = cal.getGoogleAuthUrl(state);
  res.json({ url });
});

/**
 * GET /api/calendar/google/callback
 * Google redirects here after consent
 */
router.get('/google/callback', async (req, res) => {
  const { code, state, error } = req.query;
  if (error) return res.redirect('/dashboard?cal_error=' + error);
  if (!state || !oauthStates.has(state)) return res.redirect('/dashboard?cal_error=invalid_state');

  const session = oauthStates.get(state);
  oauthStates.delete(state);
  if (Date.now() > session.expiresAt) return res.redirect('/dashboard?cal_error=state_expired');

  try {
    const tokens = await cal.exchangeGoogleCode(code);
    const userInfo = await cal.getGoogleUserInfo(tokens.access_token);

    // Upsert connection
    await query(
      `INSERT INTO calendar_connections
        (business_id, user_id, provider, access_token, refresh_token, token_expires_at, scope, calendar_id, email, status)
       VALUES ($1, $2, 'google', $3, $4, $5, $6, 'primary', $7, 'active')
       ON CONFLICT (business_id, user_id, provider) DO UPDATE SET
        access_token = EXCLUDED.access_token,
        refresh_token = COALESCE(EXCLUDED.refresh_token, calendar_connections.refresh_token),
        token_expires_at = EXCLUDED.token_expires_at,
        scope = EXCLUDED.scope,
        email = EXCLUDED.email,
        status = 'active',
        error_message = NULL,
        updated_at = NOW()`,
      [
        session.businessId,
        session.userId,
        tokens.access_token,
        tokens.refresh_token || null,
        new Date(Date.now() + (tokens.expires_in || 3600) * 1000).toISOString(),
        tokens.scope || '',
        userInfo.email || ''
      ]
    );

    res.redirect('/dashboard?cal_connected=google');
  } catch (err) {
    console.error('[CAL] Google callback error:', err);
    res.redirect('/dashboard?cal_error=' + encodeURIComponent(err.message));
  }
});

/**
 * GET /api/calendar/outlook/connect
 */
router.get('/outlook/connect', requireAuth, (req, res) => {
  if (!process.env.OUTLOOK_CLIENT_ID) {
    return res.status(501).json({ error: 'Outlook Calendar non configuré' });
  }
  const state = crypto.randomBytes(24).toString('hex');
  oauthStates.set(state, {
    userId: req.user.id,
    businessId: req.businessId,
    provider: 'outlook',
    expiresAt: Date.now() + 10 * 60000
  });
  const url = cal.getOutlookAuthUrl(state);
  res.json({ url });
});

/**
 * GET /api/calendar/outlook/callback
 */
router.get('/outlook/callback', async (req, res) => {
  const { code, state, error } = req.query;
  if (error) return res.redirect('/dashboard?cal_error=' + error);
  if (!state || !oauthStates.has(state)) return res.redirect('/dashboard?cal_error=invalid_state');

  const session = oauthStates.get(state);
  oauthStates.delete(state);
  if (Date.now() > session.expiresAt) return res.redirect('/dashboard?cal_error=state_expired');

  try {
    const tokens = await cal.exchangeOutlookCode(code);

    // Get user email
    const userRes = await fetch('https://graph.microsoft.com/v1.0/me', {
      headers: { 'Authorization': `Bearer ${tokens.access_token}` }
    });
    const userInfo = userRes.ok ? await userRes.json() : {};

    await query(
      `INSERT INTO calendar_connections
        (business_id, user_id, provider, access_token, refresh_token, token_expires_at, scope, email, status)
       VALUES ($1, $2, 'outlook', $3, $4, $5, $6, $7, 'active')
       ON CONFLICT (business_id, user_id, provider) DO UPDATE SET
        access_token = EXCLUDED.access_token,
        refresh_token = COALESCE(EXCLUDED.refresh_token, calendar_connections.refresh_token),
        token_expires_at = EXCLUDED.token_expires_at,
        email = EXCLUDED.email,
        status = 'active',
        error_message = NULL,
        updated_at = NOW()`,
      [
        session.businessId,
        session.userId,
        tokens.access_token,
        tokens.refresh_token || null,
        new Date(Date.now() + (tokens.expires_in || 3600) * 1000).toISOString(),
        tokens.scope || '',
        userInfo.mail || userInfo.userPrincipalName || ''
      ]
    );

    res.redirect('/dashboard?cal_connected=outlook');
  } catch (err) {
    console.error('[CAL] Outlook callback error:', err);
    res.redirect('/dashboard?cal_error=' + encodeURIComponent(err.message));
  }
});

// ============================================================
// MANAGEMENT (auth required)
// ============================================================

/**
 * GET /api/calendar/connections — list connected calendars
 */
router.get('/connections', requireAuth, async (req, res, next) => {
  try {
    const result = await queryWithRLS(req.businessId,
      `SELECT id, provider, email, calendar_name, sync_direction, sync_enabled,
              last_sync_at, status, error_message, created_at
       FROM calendar_connections
       WHERE business_id = $1 AND user_id = $2`,
      [req.businessId, req.user.id]
    );
    res.json({ connections: result.rows });
  } catch (err) { next(err); }
});

/**
 * PATCH /api/calendar/connections/:id — update sync settings
 */
router.patch('/connections/:id', requireAuth, async (req, res, next) => {
  try {
    const { sync_direction, sync_enabled, practitioner_id } = req.body;
    await queryWithRLS(req.businessId,
      `UPDATE calendar_connections SET
        sync_direction = COALESCE($1, sync_direction),
        sync_enabled = COALESCE($2, sync_enabled),
        practitioner_id = $3,
        updated_at = NOW()
       WHERE id = $4 AND business_id = $5 AND user_id = $6`,
      [sync_direction, sync_enabled, practitioner_id || null,
       req.params.id, req.businessId, req.user.id]
    );
    res.json({ updated: true });
  } catch (err) { next(err); }
});

/**
 * DELETE /api/calendar/connections/:id — disconnect calendar
 */
router.delete('/connections/:id', requireAuth, async (req, res, next) => {
  try {
    // Delete events first
    await queryWithRLS(req.businessId,
      `DELETE FROM calendar_events WHERE connection_id = $1`, [req.params.id]
    );
    await queryWithRLS(req.businessId,
      `DELETE FROM calendar_connections WHERE id = $1 AND business_id = $2 AND user_id = $3`,
      [req.params.id, req.businessId, req.user.id]
    );
    res.json({ disconnected: true });
  } catch (err) { next(err); }
});

/**
 * POST /api/calendar/connections/:id/sync — trigger manual sync
 */
router.post('/connections/:id/sync', requireAuth, async (req, res, next) => {
  try {
    const connResult = await queryWithRLS(req.businessId,
      `SELECT * FROM calendar_connections WHERE id = $1 AND business_id = $2`,
      [req.params.id, req.businessId]
    );
    if (connResult.rows.length === 0) return res.status(404).json({ error: 'Connexion introuvable' });

    const conn = connResult.rows[0];
    const qFn = (sql, params) => query(sql, params);

    // Pull busy times (next 60 days)
    const now = new Date();
    const end = new Date(now.getTime() + 60 * 24 * 3600000);
    let pulled = 0;

    if (conn.sync_direction === 'pull' || conn.sync_direction === 'both') {
      const events = await cal.pullBusyTimes(conn, now, end, qFn);
      pulled = events.length;
    }

    // Push unsynced bookings
    let pushed = 0;
    if (conn.sync_direction === 'push' || conn.sync_direction === 'both') {
      const bookings = await queryWithRLS(req.businessId,
        `SELECT b.*, s.name AS service_name, s.duration_min, s.color AS service_color,
                c.full_name AS client_name, c.phone AS client_phone, c.email AS client_email
         FROM bookings b
         JOIN services s ON s.id = b.service_id
         JOIN clients c ON c.id = b.client_id
         LEFT JOIN calendar_events ce ON ce.booking_id = b.id AND ce.connection_id = $1
         WHERE b.business_id = $2
           AND b.status IN ('confirmed', 'pending')
           AND b.start_at > NOW()
           AND ce.id IS NULL`,
        [conn.id, req.businessId]
      );

      for (const bk of bookings.rows) {
        try {
          await cal.pushBookingToCalendar(conn, bk, qFn);
          pushed++;
        } catch (err) {
          console.warn('[CAL-SYNC] Push failed for booking', bk.id, err.message);
        }
      }
    }

    res.json({ synced: true, pulled, pushed });
  } catch (err) { next(err); }
});

/**
 * GET /api/calendar/busy — get busy blocks for slot engine
 * Public-ish (used internally by booking flow)
 */
router.get('/busy', async (req, res, next) => {
  try {
    const { business_id, practitioner_id, start, end } = req.query;
    if (!business_id || !start || !end) {
      return res.status(400).json({ error: 'business_id, start, end required' });
    }
    const qFn = (sql, params) => query(sql, params);
    const blocks = await cal.getBusyBlocks(qFn, business_id, practitioner_id || null,
      new Date(start), new Date(end));
    res.json({ busy: blocks });
  } catch (err) { next(err); }
});

// Cleanup expired states periodically
setInterval(() => {
  const now = Date.now();
  for (const [key, val] of oauthStates) {
    if (now > val.expiresAt) oauthStates.delete(key);
  }
}, 60000);

module.exports = router;
