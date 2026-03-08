/**
 * Shared helpers for booking sub-routers.
 * - calSyncPush: push booking to connected calendars (non-blocking)
 * - calSyncDelete: remove booking from connected calendars (non-blocking)
 * - businessAllowsOverlap: check global overlap policy
 */
const { queryWithRLS } = require('../../services/db');

// ── Calendar auto-sync helper (non-blocking) ──
// Bug M12 fix: Use queryWithRLS instead of query for tenant isolation
async function calSyncPush(businessId, bookingId) {
  try {
    const { pushBookingToCalendar } = require('../../services/calendar-sync');
    const conns = await queryWithRLS(businessId,
      `SELECT * FROM calendar_connections
       WHERE business_id = $1 AND status = 'active' AND sync_enabled = true
       AND (sync_direction = 'push' OR sync_direction = 'both')`, [businessId]
    );
    if (conns.rows.length === 0) return;
    const bk = await queryWithRLS(businessId,
      `SELECT b.*, s.name AS service_name, s.duration_min, c.full_name AS client_name, c.phone AS client_phone, c.email AS client_email
       FROM bookings b LEFT JOIN services s ON s.id = b.service_id LEFT JOIN clients c ON c.id = b.client_id
       WHERE b.id = $1 AND b.business_id = $2`, [bookingId, businessId]
    );
    if (bk.rows.length === 0) return;
    const qFn = (sql, params) => queryWithRLS(businessId, sql, params);
    for (const conn of conns.rows) {
      try { await pushBookingToCalendar(conn, bk.rows[0], qFn); }
      catch (e) { console.warn('[CAL-SYNC] Push failed:', e.message); }
    }
  } catch (e) { console.error('[CAL-SYNC] calSyncPush unexpected error:', e.message); }
}

async function calSyncDelete(businessId, bookingId) {
  try {
    const { deleteCalendarEvent } = require('../../services/calendar-sync');
    const conns = await queryWithRLS(businessId,
      `SELECT * FROM calendar_connections
       WHERE business_id = $1 AND status = 'active' AND sync_enabled = true
       AND (sync_direction = 'push' OR sync_direction = 'both')`, [businessId]
    );
    const qFn = (sql, params) => queryWithRLS(businessId, sql, params);
    for (const conn of conns.rows) {
      try { await deleteCalendarEvent(conn, bookingId, qFn); }
      catch (e) { console.warn('[CAL-SYNC] Delete failed:', e.message); }
    }
  } catch (e) { console.error('[CAL-SYNC] calSyncDelete unexpected error:', e.message); }
}

// Helper: get global overlap policy from business settings
async function businessAllowsOverlap(bid) {
  const r = await queryWithRLS(bid,
    `SELECT COALESCE((settings->>'allow_overlap')::boolean, false) AS allow_overlap FROM businesses WHERE id = $1`, [bid]);
  return r.rows.length > 0 && r.rows[0].allow_overlap;
}

/**
 * Check if a booking time fits within a practitioner's working hours.
 * Checks availability_exceptions first (closed / custom_hours), then weekly schedule.
 * Returns { ok: true } or { ok: false, reason: string }.
 */
async function checkPracAvailability(bid, pracId, startAt, endAt) {
  const start = new Date(startAt);
  const end = new Date(endAt);

  // Convert to Brussels timezone for correct weekday + time extraction
  const bxlStartParts = start.toLocaleString('en-GB', { timeZone: 'Europe/Brussels', hour12: false }).split(/[\s,/:]+/);
  // en-GB format: "DD/MM/YYYY, HH:MM:SS" → parts: [DD, MM, YYYY, HH, MM, SS]
  const bxlStartH = parseInt(bxlStartParts[3]) || 0;
  const bxlStartM = parseInt(bxlStartParts[4]) || 0;
  const bxlEndParts = end.toLocaleString('en-GB', { timeZone: 'Europe/Brussels', hour12: false }).split(/[\s,/:]+/);
  const bxlEndH = parseInt(bxlEndParts[3]) || 0;
  const bxlEndM = parseInt(bxlEndParts[4]) || 0;

  const dateStr = start.toLocaleDateString('en-CA', { timeZone: 'Europe/Brussels' }); // YYYY-MM-DD in Brussels TZ
  // DB weekday: 0=Monday..6=Sunday (ISO)
  const bxlDate = new Date(dateStr + 'T12:00:00'); // noon to avoid DST edge
  const jsDay = bxlDate.getDay(); // correct day because we're using Brussels date
  const dbDay = jsDay === 0 ? 6 : jsDay - 1;

  // 0. Check staff absences (congés, maladie, formation…)
  const absCheck = await queryWithRLS(bid,
    `SELECT date_from, date_to, period, period_end FROM staff_absences
     WHERE business_id = $1 AND practitioner_id = $2
     AND date_from <= $3::date AND date_to >= $3::date`,
    [bid, pracId, dateStr]
  );
  if (absCheck.rows.length > 0) {
    const abs = absCheck.rows[0];
    const absFrom = new Date(abs.date_from).toLocaleDateString('en-CA', { timeZone: 'Europe/Brussels' });
    const absTo = new Date(abs.date_to).toLocaleDateString('en-CA', { timeZone: 'Europe/Brussels' });
    let period;
    if (absFrom === absTo) period = abs.period || 'full';
    else if (dateStr === absFrom) period = abs.period || 'full';
    else if (dateStr === absTo) period = abs.period_end || 'full';
    else period = 'full'; // middle day

    const bkStartMin = bxlStartH * 60 + bxlStartM;
    const noon = 780; // 13:00

    if (period === 'full') return { ok: false, reason: 'Ce praticien est absent ce jour (congé/absence)' };
    if (period === 'am' && bkStartMin < noon) return { ok: false, reason: 'Ce praticien est absent le matin' };
    if (period === 'pm' && bkStartMin >= noon) return { ok: false, reason: 'Ce praticien est absent l\'après-midi' };
  }

  // 1. Check exceptions for this specific date
  const exc = await queryWithRLS(bid,
    `SELECT type, start_time, end_time FROM availability_exceptions
     WHERE business_id = $1 AND practitioner_id = $2 AND date = $3`,
    [bid, pracId, dateStr]
  );
  if (exc.rows.length > 0) {
    // Check for any 'closed' exception
    if (exc.rows.some(ex => ex.type === 'closed')) return { ok: false, reason: 'Ce praticien est indisponible ce jour (exception)' };
    // STS-12 fix: Filter for custom_hours type only; if none found, fall through to weekly schedule
    const customHoursExc = exc.rows.filter(ex => ex.type === 'custom_hours');
    if (customHoursExc.length > 0) {
      const bkStart = bxlStartH * 60 + bxlStartM;
      // STS-V12-006 fix: Handle cross-midnight booking end times in custom_hours check
      let bkEnd = bxlEndH * 60 + bxlEndM;
      if (bkEnd <= bkStart) bkEnd += 1440;
      const fitsAny = customHoursExc.some(ex => {
        const exStart = timeToMin(ex.start_time);
        // STS-V12-006 fix: Handle cross-midnight exception end times
        let exEnd = timeToMin(ex.end_time);
        if (exEnd <= exStart) exEnd += 1440;
        return bkStart >= exStart && bkEnd <= exEnd;
      });
      if (fitsAny) return { ok: true };
      return { ok: false, reason: 'Horaire hors des heures exceptionnelles du praticien' };
    }
    // No custom_hours and no closed: fall through to weekly schedule check
  }

  // BK-V13-007: Check end date for cross-day bookings (start date may be open but end date closed)
  const endDateStr = end.toLocaleDateString('en-CA', { timeZone: 'Europe/Brussels' });
  if (endDateStr !== dateStr) {
    const excEnd = await queryWithRLS(bid,
      `SELECT type FROM availability_exceptions WHERE business_id = $1 AND practitioner_id = $2 AND date = $3`,
      [bid, pracId, endDateStr]
    );
    if (excEnd.rows.some(ex => ex.type === 'closed')) {
      return { ok: false, reason: 'Ce praticien est indisponible le jour de fin' };
    }
  }

  // 2. Check weekly availability
  const avail = await queryWithRLS(bid,
    `SELECT start_time, end_time FROM availabilities
     WHERE business_id = $1 AND practitioner_id = $2 AND weekday = $3 AND is_active = true`,
    [bid, pracId, dbDay]
  );
  if (avail.rows.length === 0) {
    return { ok: false, reason: 'Ce praticien n\'a pas d\'horaires configurés pour ce jour' };
  }

  // Merge slots and check if booking fits within any merged window
  const bkStart = bxlStartH * 60 + bxlStartM;
  let bkEnd = bxlEndH * 60 + bxlEndM;
  // STS-8 fix: Handle cross-midnight bookings
  if (bkEnd <= bkStart) bkEnd += 1440;
  const slots = avail.rows.map(r => {
    const s = timeToMin(r.start_time);
    let e = timeToMin(r.end_time);
    // STS-8 fix: Handle cross-midnight slot end times
    if (e <= s) e += 1440;
    return { s, e };
  }).sort((a, b) => a.s - b.s);
  const merged = [];
  for (const sl of slots) {
    if (merged.length > 0 && sl.s <= merged[merged.length - 1].e) {
      merged[merged.length - 1].e = Math.max(merged[merged.length - 1].e, sl.e);
    } else {
      merged.push({ s: sl.s, e: sl.e });
    }
  }
  if (merged.some(sl => bkStart >= sl.s && bkEnd <= sl.e)) return { ok: true };
  return { ok: false, reason: 'Horaire hors des heures de travail du praticien' };
}

function timeToMin(t) {
  if (!t || typeof t !== 'string') return 0;
  const [h, m] = t.split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

/**
 * Get the max concurrent bookings allowed for a practitioner.
 * Returns 1 by default (no overlap).
 */
async function getMaxConcurrent(bid, pracId) {
  const r = await queryWithRLS(bid,
    `SELECT max_concurrent FROM practitioners WHERE id = $1 AND business_id = $2`, [pracId, bid]);
  return r.rows[0]?.max_concurrent ?? 1;
}

/**
 * Check booking conflicts for a practitioner time range.
 * Accounts for processing time (pose) windows: if the new booking fits
 * entirely within an existing booking's pose window, it's not a conflict.
 * @param {object} client - Transaction client
 * @param {object} opts
 * @returns {Promise<Array>} Conflicting booking rows
 */
async function checkBookingConflicts(client, { bid, pracId, newStart, newEnd, excludeIds, movingProcTime, movingProcStart, movingBufferBefore }) {
  let excludeClause = '';
  const params = [bid, pracId, newStart, newEnd];

  if (excludeIds != null) {
    if (Array.isArray(excludeIds)) {
      params.push(excludeIds);
      excludeClause = `AND b.id != ALL($${params.length}::int[])`;
    } else {
      params.push(excludeIds);
      excludeClause = `AND b.id != $${params.length}`;
    }
  }

  // Reverse pose: if the MOVING booking has processing_time, existing bookings
  // that fit entirely within the moving booking's pose window are not conflicts
  let reversePoseClause = '';
  if (movingProcTime && movingProcTime > 0) {
    params.push(movingBufferBefore || 0);  // $N
    params.push(movingProcStart || 0);     // $N+1
    params.push(movingProcTime);           // $N+2
    const bufIdx = params.length - 2;
    const psIdx = params.length - 1;
    const ptIdx = params.length;
    reversePoseClause = `AND NOT (
       b.start_at >= $3::timestamptz + ($${bufIdx} + $${psIdx}) * interval '1 minute'
       AND b.end_at <= $3::timestamptz + ($${bufIdx} + $${psIdx} + $${ptIdx}) * interval '1 minute'
     )`;
  }

  const result = await client.query(
    `SELECT b.id FROM bookings b
     LEFT JOIN services s ON s.id = b.service_id
     WHERE b.business_id = $1 AND b.practitioner_id = $2
     AND b.status IN ('pending', 'confirmed', 'modified_pending', 'pending_deposit')
     AND b.start_at < $4 AND b.end_at > $3
     ${excludeClause}
     AND NOT (
       b.processing_time > 0
       AND $3::timestamptz >= b.start_at + (COALESCE(s.buffer_before_min, 0) + b.processing_start) * interval '1 minute'
       AND $4::timestamptz <= b.start_at + (COALESCE(s.buffer_before_min, 0) + b.processing_start + b.processing_time) * interval '1 minute'
     )
     ${reversePoseClause}
     FOR UPDATE OF b`,
    params
  );

  return result.rows;
}

module.exports = { calSyncPush, calSyncDelete, businessAllowsOverlap, checkPracAvailability, getMaxConcurrent, checkBookingConflicts };
