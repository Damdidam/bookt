/**
 * Shared helpers for booking sub-routers.
 * - calSyncPush: push booking to connected calendars (non-blocking)
 * - calSyncDelete: remove booking from connected calendars (non-blocking)
 * - businessAllowsOverlap: check global overlap policy
 * - syncDraftInvoicesForBookings: sync invoice_items + subtotal/vat on draft invoices
 *   after booked_price_cents changes (H10 fix — parity with public reschedule).
 */
const { queryWithRLS } = require('../../services/db');

/**
 * H10 fix: Sync DRAFT invoices that reference these bookings after price change.
 * Mirror of booking-reschedule.js:517-552. `sent`/`paid` invoices are immutable
 * (legal BE — credit note required for sent/paid mutations).
 *
 * @param {object} txClient - pg client already in a transaction (BEGIN active)
 * @param {string[]} bookingIds - array of booking UUIDs
 */
async function syncDraftInvoicesForBookings(txClient, bookingIds) {
  if (!Array.isArray(bookingIds) || bookingIds.length === 0) return;
  const invIdsRes = await txClient.query(
    `SELECT DISTINCT i.id
     FROM invoices i JOIN invoice_items it ON it.invoice_id = i.id
     WHERE it.booking_id = ANY($1::uuid[]) AND i.status = 'draft'`,
    [bookingIds]
  );
  for (const iv of invIdsRes.rows) {
    await txClient.query(
      `UPDATE invoice_items it
       SET unit_price_cents = b.booked_price_cents,
           total_cents = COALESCE(it.quantity, 1) * b.booked_price_cents
       FROM bookings b
       WHERE it.invoice_id = $1 AND it.booking_id = b.id`,
      [iv.id]
    );
    const itRes = await txClient.query(
      `SELECT total_cents, vat_rate FROM invoice_items WHERE invoice_id = $1`, [iv.id]
    );
    let _sub = 0, _vat = 0;
    const _ratesSeen = new Set();
    for (const _it of itRes.rows) {
      const _t = parseInt(_it.total_cents) || 0;
      // 0% exemption must not be coerced to 21 (E#4 fix applied here too).
      const _parsed = parseFloat(_it.vat_rate);
      const _r = isNaN(_parsed) ? 21 : _parsed;
      _ratesSeen.add(_r);
      _sub += _t;
      _vat += Math.round(_t * _r / (100 + _r));
    }
    // If the draft is single-rate, align invoices.vat_rate to the actual rate; for
    // multi-rate drafts we leave the header alone — the PDF reads per-line rates
    // and displays ventilation (see invoice-pdf.js).
    if (_ratesSeen.size === 1) {
      const [_uniqueRate] = _ratesSeen;
      await txClient.query(
        `UPDATE invoices SET subtotal_cents = $1, vat_amount_cents = $2, total_cents = $1, vat_rate = $4, updated_at = NOW() WHERE id = $3`,
        [_sub, _vat, iv.id, _uniqueRate]
      );
    } else {
      await txClient.query(
        `UPDATE invoices SET subtotal_cents = $1, vat_amount_cents = $2, total_cents = $1, updated_at = NOW() WHERE id = $3`,
        [_sub, _vat, iv.id]
      );
    }
  }

  // P2a-11 fix: invoices sent/paid sont IMMUTABLES (legal BE — credit note requise).
  // Mais si booked_price_cents a changé, l'invoice officielle ne reflète plus le prix réel.
  // Détecter la divergence et queue une notif pro pour action manuelle (émettre note de crédit).
  const divergentRes = await txClient.query(
    `SELECT DISTINCT i.id, i.invoice_number, i.business_id, i.total_cents AS invoice_total,
            it.booking_id, it.unit_price_cents AS invoice_price, b.booked_price_cents AS current_price
     FROM invoices i
     JOIN invoice_items it ON it.invoice_id = i.id
     JOIN bookings b ON b.id = it.booking_id
     WHERE it.booking_id = ANY($1::uuid[])
       AND i.status IN ('sent', 'paid')
       AND b.booked_price_cents IS NOT NULL
       AND it.unit_price_cents IS NOT NULL
       AND it.unit_price_cents != b.booked_price_cents`,
    [bookingIds]
  );
  for (const div of divergentRes.rows) {
    console.warn(`[INVOICE DIVERGENCE] Invoice ${div.invoice_number} (status=sent/paid) prix ${div.invoice_price}c ≠ booked_price ${div.current_price}c — note de crédit requise`);
    try {
      // Idempotence manuelle : check si une notif existe déjà pour ce couple
      // (booking_id, metadata.invoice_id) — évite spam si helper appelé plusieurs fois
      // (table notifications n'a pas de unique constraint composite, ON CONFLICT inapplicable).
      const existing = await txClient.query(
        `SELECT 1 FROM notifications
         WHERE booking_id = $1
           AND type = 'email_dispute_alert'
           AND metadata->>'kind' = 'invoice_price_divergence'
           AND metadata->>'invoice_id' = $2
           AND created_at > NOW() - INTERVAL '7 days'
         LIMIT 1`,
        [div.booking_id, String(div.id)]
      );
      if (existing.rows.length === 0) {
        await txClient.query(
          `INSERT INTO notifications (business_id, booking_id, type, status, metadata)
           VALUES ($1, $2, 'email_dispute_alert', 'queued', $3)`,
          [div.business_id, div.booking_id, JSON.stringify({
            kind: 'invoice_price_divergence',
            invoice_id: div.id,
            invoice_number: div.invoice_number,
            invoice_unit_price_cents: div.invoice_price,
            current_booked_price_cents: div.current_price
          })]
        );
      }
    } catch (_) { /* audit non-critique */ }
  }
}

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
      `SELECT b.*,
              CASE WHEN sv.name IS NOT NULL THEN s.name || ' — ' || sv.name ELSE s.name END AS service_name,
              COALESCE(sv.duration_min, s.duration_min) AS duration_min,
              c.full_name AS client_name, c.phone AS client_phone, c.email AS client_email
       FROM bookings b LEFT JOIN services s ON s.id = b.service_id
       LEFT JOIN service_variants sv ON sv.id = b.service_variant_id
       LEFT JOIN clients c ON c.id = b.client_id
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

  // 0a. Check business-wide holidays / closures (salon-level shutdown).
  // The slot-engine already filters these at display time, but a curl direct to
  // POST /api/public/:slug/bookings would bypass — same rationale as the Q11 fix
  // on min_booking_notice_hours. We gate once, reused by every caller.
  // Schema: business_holidays(date) = single date ; business_closures(date_from, date_to) = range.
  // No .catch swallowing — if the query blows up we want to know, not silently let bookings through.
  const endDateStr = end.toLocaleDateString('en-CA', { timeZone: 'Europe/Brussels' });
  const holRes = await queryWithRLS(bid,
    `SELECT 1 FROM business_holidays
      WHERE business_id = $1 AND date IN ($2::date, $3::date)
      LIMIT 1`,
    [bid, dateStr, endDateStr]
  );
  if (holRes.rows.length > 0) return { ok: false, reason: 'Salon fermé ce jour (jour férié / congé)' };
  const clsRes = await queryWithRLS(bid,
    `SELECT 1 FROM business_closures
      WHERE business_id = $1
        AND ($2::date BETWEEN date_from AND date_to OR $3::date BETWEEN date_from AND date_to)
      LIMIT 1`,
    [bid, dateStr, endDateStr]
  );
  if (clsRes.rows.length > 0) return { ok: false, reason: 'Salon fermé ce jour (fermeture exceptionnelle)' };

  // 0b. Check staff absences (congés, maladie, formation…)
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

  // BK-V13-007: Check end date for cross-day bookings (start date may be open but end date closed).
  // endDateStr was already computed above for the holidays/closures check.
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
  // Advisory lock on (practitioner, timeslot) to prevent double-booking on empty slots.
  // FOR UPDATE only locks existing rows — if no booking exists yet, two concurrent
  // transactions both see 0 conflicts and insert. This lock serializes them.
  // BUG-LOCK-KEY-MISMATCH fix : normaliser newStart en ISO pour matcher la clé
  // utilisée dans tasks.js (`${pid}_${new Date(startAt).toISOString()}`). Avant,
  // newStart brut ('2026-04-20T08:00:00' vs '2026-04-20 10:00:00+02' vs Date obj)
  // donnait des hash différents → race booking/task non sérialisée.
  const lockKey = `${pracId}_${new Date(newStart).toISOString()}`;
  await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [lockKey]);

  let excludeClause = '';
  const params = [bid, pracId, newStart, newEnd];

  if (excludeIds != null) {
    if (Array.isArray(excludeIds)) {
      params.push(excludeIds);
      excludeClause = `AND b.id != ALL($${params.length}::uuid[])`;
    } else {
      params.push(excludeIds);
      excludeClause = `AND b.id != $${params.length}::uuid`;
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
       date_trunc('minute', b.start_at) >= date_trunc('minute', $3::timestamptz) + ($${bufIdx}::integer + $${psIdx}::integer) * interval '1 minute'
       AND date_trunc('minute', b.end_at) <= date_trunc('minute', $3::timestamptz) + ($${bufIdx}::integer + $${psIdx}::integer + $${ptIdx}::integer) * interval '1 minute'
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
       AND date_trunc('minute', $3::timestamptz) >= date_trunc('minute', b.start_at) + (COALESCE(s.buffer_before_min, 0) + b.processing_start) * interval '1 minute'
       AND date_trunc('minute', $4::timestamptz) <= date_trunc('minute', b.start_at) + (COALESCE(s.buffer_before_min, 0) + b.processing_start + b.processing_time) * interval '1 minute'
     )
     ${reversePoseClause}
     FOR UPDATE OF b`,
    params
  );

  // Also check for overlap with planned internal_tasks (lunch, admin blocks, etc.)
  const taskConflicts = await client.query(
    `SELECT id FROM internal_tasks
     WHERE business_id = $1 AND practitioner_id = $2 AND status = 'planned'
     AND start_at < $4 AND end_at > $3`,
    [bid, pracId, newStart, newEnd]
  );

  return [...result.rows, ...taskConflicts.rows];
}

module.exports = { calSyncPush, calSyncDelete, businessAllowsOverlap, checkPracAvailability, getMaxConcurrent, checkBookingConflicts, syncDraftInvoicesForBookings };
