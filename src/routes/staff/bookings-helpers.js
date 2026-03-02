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
       FROM bookings b JOIN services s ON s.id = b.service_id JOIN clients c ON c.id = b.client_id
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

module.exports = { calSyncPush, calSyncDelete, businessAllowsOverlap };
