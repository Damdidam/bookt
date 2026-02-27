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

// ============================================================
// iCal FEED — Apple Calendar / any CalDAV client
// ============================================================

/**
 * GET /api/calendar/ical/:token — iCal subscription feed
 * Token = base64(businessId:practitionerId:secret)
 * Add as webcal:// URL in Apple Calendar, Thunderbird, etc.
 */
router.get('/ical/:token', async (req, res) => {
  try {
    const decoded = Buffer.from(req.params.token, 'base64url').toString();
    const [businessId, practitionerId, secret] = decoded.split(':');

    if (!businessId || !secret) return res.status(400).send('Invalid token');

    // Verify token
    const conn = await query(
      `SELECT cc.*, b.name AS business_name
       FROM calendar_connections cc
       JOIN businesses b ON b.id = cc.business_id
       WHERE cc.business_id = $1 AND cc.provider = 'ical' AND cc.access_token = $2 AND cc.status = 'active'`,
      [businessId, secret]
    );
    if (conn.rows.length === 0) return res.status(403).send('Invalid or expired feed');

    // Get bookings (past 30 days + next 90 days)
    const startRange = new Date(Date.now() - 30 * 86400000);
    const endRange = new Date(Date.now() + 90 * 86400000);

    let bkSql = `SELECT b.id, b.start_at, b.end_at, b.status, b.appointment_mode,
                        s.name AS service_name, s.duration_min,
                        c.full_name AS client_name, c.phone AS client_phone,
                        p.display_name AS practitioner_name
                 FROM bookings b
                 JOIN services s ON s.id = b.service_id
                 JOIN clients c ON c.id = b.client_id
                 JOIN practitioners p ON p.id = b.practitioner_id
                 WHERE b.business_id = $1 AND b.status IN ('confirmed','pending','modified_pending','completed')
                 AND b.start_at >= $2 AND b.start_at <= $3`;
    const bkParams = [businessId, startRange.toISOString(), endRange.toISOString()];

    if (practitionerId && practitionerId !== 'all') {
      bkSql += ` AND b.practitioner_id = $4`;
      bkParams.push(practitionerId);
    }
    bkSql += ' ORDER BY b.start_at';

    const bookings = await query(bkSql, bkParams);
    const bizName = conn.rows[0].business_name || 'Genda';

    // Build iCal
    let ical = `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Genda//Genda Calendar//FR\r\nCALSCALE:GREGORIAN\r\nMETHOD:PUBLISH\r\nX-WR-CALNAME:${bizName}\r\nX-WR-TIMEZONE:Europe/Brussels\r\n`;

    for (const bk of bookings.rows) {
      const uid = `${bk.id}@genda.be`;
      const dtStart = icalDate(bk.start_at);
      const dtEnd = icalDate(bk.end_at);
      const summary = `${bk.client_name} — ${bk.service_name}`;
      const desc = [bk.service_name, bk.practitioner_name, bk.client_phone ? `Tel: ${bk.client_phone}` : ''].filter(Boolean).join('\\n');
      const status = bk.status === 'confirmed' ? 'CONFIRMED' : bk.status === 'cancelled' ? 'CANCELLED' : 'TENTATIVE';

      ical += `BEGIN:VEVENT\r\nUID:${uid}\r\nDTSTART;TZID=Europe/Brussels:${dtStart}\r\nDTEND;TZID=Europe/Brussels:${dtEnd}\r\nSUMMARY:${icalEscape(summary)}\r\nDESCRIPTION:${icalEscape(desc)}\r\nSTATUS:${status}\r\nEND:VEVENT\r\n`;
    }

    ical += 'END:VCALENDAR\r\n';

    res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
    res.setHeader('Content-Disposition', `inline; filename="${bizName}.ics"`);
    res.send(ical);
  } catch (err) {
    console.error('[ICAL] Feed error:', err);
    res.status(500).send('Calendar feed error');
  }
});

/**
 * POST /api/calendar/ical/generate — generate iCal feed URL
 * Creates a persistent "ical" connection with a secret token
 */
router.post('/ical/generate', requireAuth, async (req, res, next) => {
  try {
    const bid = req.businessId;
    const { practitioner_id } = req.body; // null = all practitioners
    const secret = crypto.randomBytes(24).toString('hex');

    // Upsert ical connection
    const result = await query(
      `INSERT INTO calendar_connections
        (business_id, user_id, provider, access_token, practitioner_id, status, sync_direction, sync_enabled)
       VALUES ($1, $2, 'ical', $3, $4, 'active', 'push', true)
       ON CONFLICT (business_id, user_id, provider) DO UPDATE SET
        access_token = EXCLUDED.access_token,
        practitioner_id = EXCLUDED.practitioner_id,
        status = 'active',
        updated_at = NOW()
       RETURNING id, access_token`,
      [bid, req.user.id, secret, practitioner_id || null]
    );

    const token = Buffer.from(`${bid}:${practitioner_id || 'all'}:${result.rows[0].access_token}`).toString('base64url');
    const baseUrl = process.env.BASE_URL || 'https://genda-qgm2.onrender.com';

    res.json({
      ical_url: `${baseUrl}/api/calendar/ical/${token}`,
      webcal_url: `webcal://${baseUrl.replace(/^https?:\/\//, '')}/api/calendar/ical/${token}`,
      token
    });
  } catch (err) { next(err); }
});

function icalDate(dt) {
  const d = new Date(dt);
  return d.getFullYear() +
    String(d.getMonth() + 1).padStart(2, '0') +
    String(d.getDate()).padStart(2, '0') + 'T' +
    String(d.getHours()).padStart(2, '0') +
    String(d.getMinutes()).padStart(2, '0') +
    String(d.getSeconds()).padStart(2, '0');
}

function icalEscape(str) {
  return (str || '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');
}

module.exports = router;
