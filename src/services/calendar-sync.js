/**
 * Calendar Sync Service
 * Google Calendar API + Microsoft Graph (Outlook)
 * Handles: OAuth2 flow, push events, pull busy times, token refresh
 */

// ============================================================
// GOOGLE CALENDAR
// ============================================================

const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_CALENDAR_API = 'https://www.googleapis.com/calendar/v3';
const GOOGLE_SCOPES = 'https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/calendar.readonly';

function getGoogleAuthUrl(state) {
  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID,
    redirect_uri: `${process.env.BASE_URL}/api/calendar/google/callback`,
    response_type: 'code',
    scope: GOOGLE_SCOPES,
    access_type: 'offline',
    prompt: 'consent',
    state
  });
  return `${GOOGLE_AUTH_URL}?${params}`;
}

async function exchangeGoogleCode(code) {
  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      redirect_uri: `${process.env.BASE_URL}/api/calendar/google/callback`,
      grant_type: 'authorization_code'
    })
  });
  if (!res.ok) throw new Error(`Google token exchange failed: ${res.status}`);
  return res.json();
}

async function refreshGoogleToken(refreshToken) {
  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      grant_type: 'refresh_token'
    })
  });
  if (!res.ok) throw new Error('Google token refresh failed');
  return res.json();
}

async function googleApiCall(accessToken, path, method = 'GET', body = null) {
  const opts = {
    method,
    headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' }
  };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(`${GOOGLE_CALENDAR_API}${path}`, opts);
  if (res.status === 204) return null;
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(`Google API ${res.status}: ${err.error?.message || JSON.stringify(err)}`);
  }
  return res.json();
}

async function getGoogleUserInfo(accessToken) {
  const res = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
    headers: { 'Authorization': `Bearer ${accessToken}` }
  });
  if (!res.ok) return {};
  return res.json();
}

// ============================================================
// MICROSOFT OUTLOOK (Graph API)
// ============================================================

const MS_AUTH_URL = 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize';
const MS_TOKEN_URL = 'https://login.microsoftonline.com/common/oauth2/v2.0/token';
const MS_GRAPH_API = 'https://graph.microsoft.com/v1.0';
const MS_SCOPES = 'Calendars.ReadWrite User.Read offline_access';

function getOutlookAuthUrl(state) {
  const params = new URLSearchParams({
    client_id: process.env.OUTLOOK_CLIENT_ID,
    redirect_uri: `${process.env.BASE_URL}/api/calendar/outlook/callback`,
    response_type: 'code',
    scope: MS_SCOPES,
    state
  });
  return `${MS_AUTH_URL}?${params}`;
}

async function exchangeOutlookCode(code) {
  const res = await fetch(MS_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: process.env.OUTLOOK_CLIENT_ID,
      client_secret: process.env.OUTLOOK_CLIENT_SECRET,
      redirect_uri: `${process.env.BASE_URL}/api/calendar/outlook/callback`,
      grant_type: 'authorization_code'
    })
  });
  if (!res.ok) throw new Error(`Outlook token exchange failed: ${res.status}`);
  return res.json();
}

async function refreshOutlookToken(refreshToken) {
  const res = await fetch(MS_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: process.env.OUTLOOK_CLIENT_ID,
      client_secret: process.env.OUTLOOK_CLIENT_SECRET,
      grant_type: 'refresh_token'
    })
  });
  if (!res.ok) throw new Error('Outlook token refresh failed');
  return res.json();
}

async function outlookApiCall(accessToken, path, method = 'GET', body = null) {
  const opts = {
    method,
    headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' }
  };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(`${MS_GRAPH_API}${path}`, opts);
  if (res.status === 204) return null;
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(`Graph API ${res.status}: ${err.error?.message || JSON.stringify(err)}`);
  }
  return res.json();
}

// ============================================================
// UNIFIED TOKEN MANAGEMENT
// ============================================================

async function getValidToken(connection, queryFn) {
  const now = new Date();
  const expiresAt = new Date(connection.token_expires_at);

  // Token still valid (with 5 min buffer)
  if (expiresAt > new Date(now.getTime() + 5 * 60000)) {
    return connection.access_token;
  }

  // Refresh token
  if (!connection.refresh_token) {
    throw new Error('No refresh token available — reconnection required');
  }

  let tokenData;
  if (connection.provider === 'google') {
    tokenData = await refreshGoogleToken(connection.refresh_token);
  } else {
    tokenData = await refreshOutlookToken(connection.refresh_token);
  }

  // Update stored tokens
  await queryFn(
    `UPDATE calendar_connections SET
      access_token = $1,
      token_expires_at = $2,
      refresh_token = COALESCE($3, refresh_token),
      status = 'active',
      error_message = NULL,
      updated_at = NOW()
     WHERE id = $4`,
    [
      tokenData.access_token,
      new Date(Date.now() + (tokenData.expires_in || 3600) * 1000).toISOString(),
      tokenData.refresh_token || null,
      connection.id
    ]
  );

  return tokenData.access_token;
}

// ============================================================
// EVENT SYNC — PUSH (Bookt → Calendar)
// ============================================================

/**
 * Push a booking to the connected calendar
 * Creates or updates the external event
 */
async function pushBookingToCalendar(connection, booking, queryFn) {
  const accessToken = await getValidToken(connection, queryFn);

  // Check if already synced
  const existing = await queryFn(
    `SELECT * FROM calendar_events WHERE connection_id = $1 AND booking_id = $2 AND direction = 'push'`,
    [connection.id, booking.id]
  );

  const event = buildCalendarEvent(booking, connection.provider);

  let externalEventId, externalLink;

  if (existing.rows.length > 0) {
    // Update existing event
    const ext = existing.rows[0];
    if (connection.provider === 'google') {
      const calId = connection.calendar_id || 'primary';
      const result = await googleApiCall(accessToken,
        `/calendars/${encodeURIComponent(calId)}/events/${ext.external_event_id}`,
        'PUT', event
      );
      externalEventId = result.id;
      externalLink = result.htmlLink;
    } else {
      const result = await outlookApiCall(accessToken,
        `/me/events/${ext.external_event_id}`,
        'PATCH', event
      );
      externalEventId = result.id;
      externalLink = result.webLink;
    }

    await queryFn(
      `UPDATE calendar_events SET external_link = $1, synced_at = NOW() WHERE id = $2`,
      [externalLink, ext.id]
    );
  } else {
    // Create new event
    if (connection.provider === 'google') {
      const calId = connection.calendar_id || 'primary';
      const result = await googleApiCall(accessToken,
        `/calendars/${encodeURIComponent(calId)}/events`,
        'POST', event
      );
      externalEventId = result.id;
      externalLink = result.htmlLink;
    } else {
      const result = await outlookApiCall(accessToken, '/me/events', 'POST', event);
      externalEventId = result.id;
      externalLink = result.webLink;
    }

    await queryFn(
      `INSERT INTO calendar_events (connection_id, booking_id, external_event_id, external_link, direction)
       VALUES ($1, $2, $3, $4, 'push')`,
      [connection.id, booking.id, externalEventId, externalLink]
    );
  }

  return { externalEventId, externalLink };
}

/**
 * Delete a calendar event when booking is cancelled
 */
async function deleteCalendarEvent(connection, bookingId, queryFn) {
  const existing = await queryFn(
    `SELECT * FROM calendar_events WHERE connection_id = $1 AND booking_id = $2 AND direction = 'push'`,
    [connection.id, bookingId]
  );
  if (existing.rows.length === 0) return;

  const ext = existing.rows[0];
  try {
    const accessToken = await getValidToken(connection, queryFn);
    if (connection.provider === 'google') {
      const calId = connection.calendar_id || 'primary';
      await googleApiCall(accessToken,
        `/calendars/${encodeURIComponent(calId)}/events/${ext.external_event_id}`,
        'DELETE'
      );
    } else {
      await outlookApiCall(accessToken, `/me/events/${ext.external_event_id}`, 'DELETE');
    }
  } catch (err) {
    console.warn('[CAL-SYNC] Delete event failed:', err.message);
  }

  await queryFn(`DELETE FROM calendar_events WHERE id = $1`, [ext.id]);
}

function buildCalendarEvent(booking, provider) {
  const start = new Date(booking.start_at);
  const end = new Date(booking.end_at || new Date(start.getTime() + (booking.duration_min || 30) * 60000));
  const summary = `${booking.client_name} — ${booking.service_name}`;
  const description = [
    booking.service_name,
    booking.client_phone ? `📞 ${booking.client_phone}` : null,
    booking.client_email ? `📧 ${booking.client_email}` : null,
    booking.notes ? `📝 ${booking.notes}` : null,
    '—\nGéré via Bookt.be'
  ].filter(Boolean).join('\n');

  if (provider === 'google') {
    return {
      summary,
      description,
      start: { dateTime: start.toISOString(), timeZone: 'Europe/Brussels' },
      end: { dateTime: end.toISOString(), timeZone: 'Europe/Brussels' },
      reminders: { useDefault: false, overrides: [{ method: 'popup', minutes: 15 }] },
      colorId: '7' // Teal-ish
    };
  } else {
    // Outlook/Graph format
    return {
      subject: summary,
      body: { contentType: 'text', content: description },
      start: { dateTime: start.toISOString().replace('Z', ''), timeZone: 'Europe/Brussels' },
      end: { dateTime: end.toISOString().replace('Z', ''), timeZone: 'Europe/Brussels' },
      isReminderOn: true,
      reminderMinutesBeforeStart: 15
    };
  }
}

// ============================================================
// EVENT SYNC — PULL (Calendar → Bookt busy times)
// ============================================================

/**
 * Pull busy/free events from external calendar
 * Used to block slots in the booking flow
 */
async function pullBusyTimes(connection, startDate, endDate, queryFn) {
  const accessToken = await getValidToken(connection, queryFn);
  const events = [];

  if (connection.provider === 'google') {
    const calId = connection.calendar_id || 'primary';
    const params = new URLSearchParams({
      timeMin: startDate.toISOString(),
      timeMax: endDate.toISOString(),
      singleEvents: 'true',
      orderBy: 'startTime',
      maxResults: '250'
    });
    const result = await googleApiCall(accessToken,
      `/calendars/${encodeURIComponent(calId)}/events?${params}`
    );
    (result.items || []).forEach(ev => {
      if (ev.status === 'cancelled') return;
      // Skip transparent (free) events
      if (ev.transparency === 'transparent') return;
      events.push({
        external_event_id: ev.id,
        title: ev.summary || '(occupé)',
        start_at: ev.start?.dateTime || ev.start?.date,
        end_at: ev.end?.dateTime || ev.end?.date,
        is_busy: true
      });
    });
  } else {
    // Outlook
    const params = new URLSearchParams({
      startDateTime: startDate.toISOString(),
      endDateTime: endDate.toISOString(),
      $top: '250',
      $select: 'id,subject,start,end,showAs',
      $orderby: 'start/dateTime'
    });
    const result = await outlookApiCall(accessToken, `/me/calendarView?${params}`);
    (result.value || []).forEach(ev => {
      // Skip free/tentative
      if (ev.showAs === 'free') return;
      events.push({
        external_event_id: ev.id,
        title: ev.subject || '(occupé)',
        start_at: ev.start?.dateTime,
        end_at: ev.end?.dateTime,
        is_busy: true
      });
    });
  }

  // Upsert events
  for (const ev of events) {
    await queryFn(
      `INSERT INTO calendar_events (connection_id, external_event_id, title, start_at, end_at, is_busy, direction)
       VALUES ($1, $2, $3, $4, $5, $6, 'pull')
       ON CONFLICT (connection_id, external_event_id) DO UPDATE SET
         title = EXCLUDED.title, start_at = EXCLUDED.start_at, end_at = EXCLUDED.end_at,
         is_busy = EXCLUDED.is_busy, synced_at = NOW()`,
      [connection.id, ev.external_event_id, ev.title, ev.start_at, ev.end_at, ev.is_busy]
    );
  }

  // Update last sync
  await queryFn(
    `UPDATE calendar_connections SET last_sync_at = NOW(), updated_at = NOW() WHERE id = $1`,
    [connection.id]
  );

  return events;
}

/**
 * Get busy blocks for a practitioner (used by slot engine)
 * Returns array of { start_at, end_at }
 */
async function getBusyBlocks(queryFn, businessId, practitionerId, startDate, endDate) {
  const result = await queryFn(
    `SELECT ce.start_at, ce.end_at FROM calendar_events ce
     JOIN calendar_connections cc ON cc.id = ce.connection_id
     WHERE cc.business_id = $1
       AND (cc.practitioner_id = $2 OR $2 IS NULL)
       AND ce.direction = 'pull'
       AND ce.is_busy = true
       AND ce.start_at < $4
       AND ce.end_at > $3`,
    [businessId, practitionerId, startDate.toISOString(), endDate.toISOString()]
  );
  return result.rows;
}

module.exports = {
  // Google
  getGoogleAuthUrl, exchangeGoogleCode, refreshGoogleToken, getGoogleUserInfo,
  // Outlook
  getOutlookAuthUrl, exchangeOutlookCode, refreshOutlookToken,
  // Unified
  getValidToken, pushBookingToCalendar, deleteCalendarEvent,
  pullBusyTimes, getBusyBlocks,
  // Helpers
  buildCalendarEvent
};
