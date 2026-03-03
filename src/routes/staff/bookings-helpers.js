/**
 * Shared helpers for booking sub-routers.
 * - calSyncPush: push booking to connected calendars (non-blocking)
 * - calSyncDelete: remove booking from connected calendars (non-blocking)
 * - businessAllowsOverlap: check global overlap policy
 */
const { query, queryWithRLS } = require('../../services/db');

// ── Calendar auto-sync helper (non-blocking) ──
async function calSyncPush(businessId, bookingId) {
  try {
    const { pushBookingToCalendar } = require('../../services/calendar-sync');
    const conns = await query(
      `SELECT * FROM calendar_connections
       WHERE business_id = $1 AND status = 'active' AND sync_enabled = true
       AND (sync_direction = 'push' OR sync_direction = 'both')`, [businessId]
    );
    if (conns.rows.length === 0) return;
    const bk = await query(
      `SELECT b.*, s.name AS service_name, s.duration_min, c.full_name AS client_name, c.phone AS client_phone, c.email AS client_email
       FROM bookings b LEFT JOIN services s ON s.id = b.service_id LEFT JOIN clients c ON c.id = b.client_id
       WHERE b.id = $1`, [bookingId]
    );
    if (bk.rows.length === 0) return;
    const qFn = (sql, params) => query(sql, params);
    for (const conn of conns.rows) {
      try { await pushBookingToCalendar(conn, bk.rows[0], qFn); }
      catch (e) { console.warn('[CAL-SYNC] Push failed:', e.message); }
    }
  } catch (e) { /* non-blocking */ }
}

async function calSyncDelete(businessId, bookingId) {
  try {
    const { deleteCalendarEvent } = require('../../services/calendar-sync');
    const conns = await query(
      `SELECT * FROM calendar_connections
       WHERE business_id = $1 AND status = 'active' AND sync_enabled = true
       AND (sync_direction = 'push' OR sync_direction = 'both')`, [businessId]
    );
    const qFn = (sql, params) => query(sql, params);
    for (const conn of conns.rows) {
      try { await deleteCalendarEvent(conn, bookingId, qFn); }
      catch (e) { console.warn('[CAL-SYNC] Delete failed:', e.message); }
    }
  } catch (e) { /* non-blocking */ }
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
  const dateStr = start.toISOString().slice(0, 10); // YYYY-MM-DD
  // DB weekday: 0=Monday..6=Sunday (ISO), JS getDay: 0=Sunday..6=Saturday
  const jsDay = start.getDay();
  const dbDay = jsDay === 0 ? 6 : jsDay - 1;

  // 1. Check exceptions for this specific date
  const exc = await queryWithRLS(bid,
    `SELECT type, start_time, end_time FROM availability_exceptions
     WHERE business_id = $1 AND practitioner_id = $2 AND date = $3`,
    [bid, pracId, dateStr]
  );
  if (exc.rows.length > 0) {
    const ex = exc.rows[0];
    if (ex.type === 'closed') return { ok: false, reason: 'Ce praticien est indisponible ce jour (exception)' };
    // custom_hours: check if booking fits
    const exStart = timeToMin(ex.start_time);
    const exEnd = timeToMin(ex.end_time);
    const bkStart = start.getHours() * 60 + start.getMinutes();
    const bkEnd = end.getHours() * 60 + end.getMinutes();
    if (bkStart >= exStart && bkEnd <= exEnd) return { ok: true };
    return { ok: false, reason: 'Horaire hors des heures exceptionnelles du praticien' };
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
  const bkStart = start.getHours() * 60 + start.getMinutes();
  const bkEnd = end.getHours() * 60 + end.getMinutes();
  const slots = avail.rows.map(r => ({ s: timeToMin(r.start_time), e: timeToMin(r.end_time) })).sort((a, b) => a.s - b.s);
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
  const [h, m] = t.split(':').map(Number);
  return h * 60 + (m || 0);
}

/**
 * Get the max concurrent bookings allowed for a practitioner.
 * Returns 1 by default (no overlap).
 */
async function getMaxConcurrent(bid, pracId) {
  const r = await queryWithRLS(bid,
    `SELECT max_concurrent FROM practitioners WHERE id = $1 AND business_id = $2`, [pracId, bid]);
  return r.rows[0]?.max_concurrent || 1;
}

module.exports = { calSyncPush, calSyncDelete, businessAllowsOverlap, checkPracAvailability, getMaxConcurrent };
