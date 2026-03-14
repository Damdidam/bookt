const router = require('express').Router();
const crypto = require('crypto');
const { query, queryWithRLS, transactionWithRLS } = require('../../services/db');
const { requireAuth, requireOwner } = require('../../middleware/auth');
const cal = require('../../services/calendar-sync');

// Store OAuth state tokens in DB (survives restarts, multi-instance safe)
const oauthStates = {
  async set(key, val) {
    await query(
      `INSERT INTO oauth_states (state_key, data, expires_at) VALUES ($1, $2, $3)
       ON CONFLICT (state_key) DO UPDATE SET data = $2, expires_at = $3`,
      [key, JSON.stringify(val), new Date(val.expiresAt).toISOString()]
    );
  },
  async get(key) {
    const r = await query(`SELECT data FROM oauth_states WHERE state_key = $1 AND expires_at > NOW()`, [key]);
    if (r.rows.length === 0) return null;
    const d = r.rows[0].data;
    return typeof d === 'string' ? JSON.parse(d) : d; // JSONB columns are auto-parsed by pg
  },
  async delete(key) {
    await query(`DELETE FROM oauth_states WHERE state_key = $1`, [key]);
  }
};

// ============================================================
// OAuth2 CONNECT FLOWS
// ============================================================

/**
 * GET /api/calendar/google/connect
 * Redirects to Google OAuth consent screen
 */
router.get('/google/connect', requireAuth, async (req, res) => {
  if (!process.env.GOOGLE_CLIENT_ID) {
    return res.status(501).json({ error: 'Google Calendar non configuré' });
  }

  // V12-011: Validate practitioner_id ownership
  const pracId = req.query.practitioner_id || null;
  if (pracId) {
    if (req.user.role === 'practitioner' && pracId !== req.user.practitionerId) {
      return res.status(403).json({ error: 'Cannot connect calendar for another practitioner' });
    }
    // V13-021: Verify practitioner belongs to this business
    const pracCheck = await queryWithRLS(req.businessId, `SELECT id FROM practitioners WHERE id = $1 AND business_id = $2`, [pracId, req.businessId]);
    if (pracCheck.rows.length === 0) return res.status(404).json({ error: 'Praticien introuvable' });
  }

  const state = crypto.randomBytes(24).toString('hex');
  await oauthStates.set(state, {
    userId: req.user.id,
    businessId: req.businessId,
    practitionerId: pracId,
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
  if (error) return res.redirect('/dashboard?cal_error=' + encodeURIComponent(error));
  const session = await oauthStates.get(state);
  if (!state || !session) return res.redirect('/dashboard?cal_error=' + encodeURIComponent('invalid_state'));

  await oauthStates.delete(state);
  if (Date.now() > session.expiresAt) return res.redirect('/dashboard?cal_error=' + encodeURIComponent('state_expired'));

  try {
    // Validate that session.userId belongs to session.businessId
    const ownerCheck = await query(`SELECT id FROM users WHERE id = $1 AND business_id = $2`, [session.userId, session.businessId]);
    if (ownerCheck.rows.length === 0) return res.redirect('/dashboard?cal_error=unauthorized');

    const tokens = await cal.exchangeGoogleCode(code);
    const userInfo = await cal.getGoogleUserInfo(tokens.access_token);

    // V13-027: Handle NULL practitioner_id (ON CONFLICT fails with NULL)
    if (!session.practitionerId) {
      const existing = await query(
        `SELECT id FROM calendar_connections WHERE business_id = $1 AND provider = 'google' AND practitioner_id IS NULL`,
        [session.businessId]
      );
      if (existing.rows.length > 0) {
        await query(
          `UPDATE calendar_connections SET
            access_token = $1, refresh_token = COALESCE($2, refresh_token),
            token_expires_at = $3, scope = $4, email = $5, user_id = $6,
            status = 'active', error_message = NULL, updated_at = NOW()
           WHERE id = $7`,
          [tokens.access_token, tokens.refresh_token || null,
           new Date(Date.now() + (tokens.expires_in || 3600) * 1000).toISOString(),
           tokens.scope || '', userInfo.email || '', session.userId,
           existing.rows[0].id]
        );
        res.redirect('/dashboard?cal_connected=google&prac=');
        return;
      }
    }

    // Upsert connection (per practitioner)
    await query(
      `INSERT INTO calendar_connections
        (business_id, user_id, practitioner_id, provider, access_token, refresh_token, token_expires_at, scope, calendar_id, email, status)
       VALUES ($1, $2, $3, 'google', $4, $5, $6, $7, 'primary', $8, 'active')
       ON CONFLICT (business_id, practitioner_id, provider) DO UPDATE SET
        access_token = EXCLUDED.access_token,
        refresh_token = COALESCE(EXCLUDED.refresh_token, calendar_connections.refresh_token),
        token_expires_at = EXCLUDED.token_expires_at,
        scope = EXCLUDED.scope,
        email = EXCLUDED.email,
        user_id = EXCLUDED.user_id,
        status = 'active',
        error_message = NULL,
        updated_at = NOW()`,
      [
        session.businessId,
        session.userId,
        session.practitionerId,
        tokens.access_token,
        tokens.refresh_token || null,
        new Date(Date.now() + (tokens.expires_in || 3600) * 1000).toISOString(),
        tokens.scope || '',
        userInfo.email || ''
      ]
    );

    res.redirect('/dashboard?cal_connected=google&prac=' + (session.practitionerId || ''));
  } catch (err) {
    console.error('[CAL] Google callback error:', err);
    res.redirect('/dashboard?cal_error=' + encodeURIComponent(err.message));
  }
});

/**
 * GET /api/calendar/outlook/connect
 */
router.get('/outlook/connect', requireAuth, async (req, res) => {
  if (!process.env.OUTLOOK_CLIENT_ID) {
    return res.status(501).json({ error: 'Outlook Calendar non configuré' });
  }

  // V12-011: Validate practitioner_id ownership
  const pracId = req.query.practitioner_id || null;
  if (pracId) {
    if (req.user.role === 'practitioner' && pracId !== req.user.practitionerId) {
      return res.status(403).json({ error: 'Cannot connect calendar for another practitioner' });
    }
    // V13-021: Verify practitioner belongs to this business
    const pracCheck = await queryWithRLS(req.businessId, `SELECT id FROM practitioners WHERE id = $1 AND business_id = $2`, [pracId, req.businessId]);
    if (pracCheck.rows.length === 0) return res.status(404).json({ error: 'Praticien introuvable' });
  }

  const state = crypto.randomBytes(24).toString('hex');
  await oauthStates.set(state, {
    userId: req.user.id,
    businessId: req.businessId,
    practitionerId: pracId,
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
  if (error) return res.redirect('/dashboard?cal_error=' + encodeURIComponent(error));
  const session = await oauthStates.get(state);
  if (!state || !session) return res.redirect('/dashboard?cal_error=' + encodeURIComponent('invalid_state'));

  await oauthStates.delete(state);
  if (Date.now() > session.expiresAt) return res.redirect('/dashboard?cal_error=' + encodeURIComponent('state_expired'));

  try {
    // Validate that session.userId belongs to session.businessId
    const ownerCheck = await query(`SELECT id FROM users WHERE id = $1 AND business_id = $2`, [session.userId, session.businessId]);
    if (ownerCheck.rows.length === 0) return res.redirect('/dashboard?cal_error=unauthorized');

    const tokens = await cal.exchangeOutlookCode(code);

    // Get user email
    const userRes = await fetch('https://graph.microsoft.com/v1.0/me', {
      headers: { 'Authorization': `Bearer ${tokens.access_token}` }
    });
    const userInfo = userRes.ok ? await userRes.json() : {};

    // V13-027: Handle NULL practitioner_id (ON CONFLICT fails with NULL)
    if (!session.practitionerId) {
      const existing = await query(
        `SELECT id FROM calendar_connections WHERE business_id = $1 AND provider = 'outlook' AND practitioner_id IS NULL`,
        [session.businessId]
      );
      if (existing.rows.length > 0) {
        await query(
          `UPDATE calendar_connections SET
            access_token = $1, refresh_token = COALESCE($2, refresh_token),
            token_expires_at = $3, scope = $4, email = $5, user_id = $6,
            status = 'active', error_message = NULL, updated_at = NOW()
           WHERE id = $7`,
          [tokens.access_token, tokens.refresh_token || null,
           new Date(Date.now() + (tokens.expires_in || 3600) * 1000).toISOString(),
           tokens.scope || '', userInfo.mail || userInfo.userPrincipalName || '',
           session.userId, existing.rows[0].id]
        );
        res.redirect('/dashboard?cal_connected=outlook&prac=');
        return;
      }
    }

    await query(
      `INSERT INTO calendar_connections
        (business_id, user_id, practitioner_id, provider, access_token, refresh_token, token_expires_at, scope, email, status)
       VALUES ($1, $2, $3, 'outlook', $4, $5, $6, $7, $8, 'active')
       ON CONFLICT (business_id, practitioner_id, provider) DO UPDATE SET
        access_token = EXCLUDED.access_token,
        refresh_token = COALESCE(EXCLUDED.refresh_token, calendar_connections.refresh_token),
        token_expires_at = EXCLUDED.token_expires_at,
        email = EXCLUDED.email,
        user_id = EXCLUDED.user_id,
        status = 'active',
        error_message = NULL,
        updated_at = NOW()`,
      [
        session.businessId,
        session.userId,
        session.practitionerId,
        tokens.access_token,
        tokens.refresh_token || null,
        new Date(Date.now() + (tokens.expires_in || 3600) * 1000).toISOString(),
        tokens.scope || '',
        userInfo.mail || userInfo.userPrincipalName || ''
      ]
    );

    res.redirect('/dashboard?cal_connected=outlook&prac=' + (session.practitionerId || ''));
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
    const { practitioner_id } = req.query;
    let sql = `SELECT id, provider, practitioner_id, email, calendar_name, sync_direction, sync_enabled,
              last_sync_at, status, error_message, created_at
       FROM calendar_connections
       WHERE business_id = $1`;
    const params = [req.businessId];

    if (practitioner_id) {
      sql += ` AND practitioner_id = $2`;
      params.push(practitioner_id);
    }

    const result = await queryWithRLS(req.businessId, sql, params);
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
        practitioner_id = COALESCE($3, practitioner_id),
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
    // V13-003: Wrap in transaction, delete events first (FK order), then connection
    await transactionWithRLS(req.businessId, async (client) => {
      // Verify ownership first
      const connCheck = await client.query(
        `SELECT id FROM calendar_connections WHERE id = $1 AND business_id = $2 AND user_id = $3`,
        [req.params.id, req.businessId, req.user.id]
      );
      if (connCheck.rows.length > 0) {
        await client.query(
          `DELETE FROM calendar_events WHERE connection_id = $1`, [req.params.id]
        );
        await client.query(
          `DELETE FROM calendar_connections WHERE id = $1 AND business_id = $2 AND user_id = $3`,
          [req.params.id, req.businessId, req.user.id]
        );
      }
    });
    res.json({ disconnected: true });
  } catch (err) { next(err); }
});

/**
 * POST /api/calendar/connections/:id/sync — trigger manual sync
 */
router.post('/connections/:id/sync', requireAuth, async (req, res, next) => {
  try {
    const connResult = await queryWithRLS(req.businessId,
      `SELECT * FROM calendar_connections WHERE id = $1 AND business_id = $2 AND user_id = $3`,
      [req.params.id, req.businessId, req.user.id]
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
      let pushSql = `SELECT b.*, s.name AS service_name, s.duration_min, s.color AS service_color,
                c.full_name AS client_name, c.phone AS client_phone, c.email AS client_email
         FROM bookings b
         JOIN services s ON s.id = b.service_id
         JOIN clients c ON c.id = b.client_id
         LEFT JOIN calendar_events ce ON ce.booking_id = b.id AND ce.connection_id = $1
         WHERE b.business_id = $2
           AND b.status IN ('confirmed', 'pending', 'pending_deposit')
           AND b.start_at > NOW()
           AND ce.id IS NULL`;
      const pushParams = [conn.id, req.businessId];
      let paramIdx = 3;
      // V13-022: Filter by connection's practitioner_id if set
      if (conn.practitioner_id) {
        pushSql += ` AND b.practitioner_id = $${paramIdx}`;
        pushParams.push(conn.practitioner_id);
        paramIdx++;
      }
      const bookings = await queryWithRLS(req.businessId, pushSql, pushParams);

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
router.get('/busy', requireAuth, async (req, res, next) => {
  try {
    const { practitioner_id, start, end } = req.query;
    const business_id = req.businessId;
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
setInterval(async () => {
  try { await query(`DELETE FROM oauth_states WHERE expires_at < NOW()`); } catch (e) { /* ignore */ }
}, 300000); // every 5 min

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

    // V12-020: Validate businessId as UUID
    const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!businessId || !UUID_RE.test(businessId) || !secret) return res.status(400).send('Invalid token');

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
                 WHERE b.business_id = $1 AND b.status IN ('confirmed','pending','modified_pending','completed','pending_deposit')
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
      const desc = [bk.service_name, bk.practitioner_name].filter(Boolean).join('\\n');
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

    // Upsert ical connection per practitioner
    const result = await queryWithRLS(bid,
      `INSERT INTO calendar_connections
        (business_id, user_id, practitioner_id, provider, access_token, status, sync_direction, sync_enabled)
       VALUES ($1, $2, $3, 'ical', $4, 'active', 'push', true)
       ON CONFLICT (business_id, practitioner_id, provider) DO UPDATE SET
        access_token = EXCLUDED.access_token,
        user_id = EXCLUDED.user_id,
        status = 'active',
        updated_at = NOW()
       RETURNING id, access_token`,
      [bid, req.user.id, practitioner_id || null, secret]
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
  // Use Brussels timezone for iCal date formatting
  const brusselsStr = d.toLocaleString('sv-SE', { timeZone: 'Europe/Brussels' });
  // brusselsStr format: "YYYY-MM-DD HH:MM:SS"
  const [datePart, timePart] = brusselsStr.split(' ');
  const [year, month, day] = datePart.split('-');
  const [hours, minutes, seconds] = timePart.split(':');
  return year + month + day + 'T' + hours + minutes + seconds;
}

function icalEscape(str) {
  return (str || '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');
}

module.exports = router;
