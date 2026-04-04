/**
 * GAP ENGINE — detects exploitable gaps and unused processing windows.
 *
 * For a given date and (optional) practitioner, returns:
 *   - gaps between bookings
 *   - unused processing (pose) windows
 *   - compatible services that could fill each gap
 *   - waitlist entries that match
 *   - occupation stats per practitioner
 *
 * Reuses the same data-fetching pattern as slot-engine.js.
 */

const { queryWithRLS } = require('./db');
const { getBusyBlocks } = require('./calendar-sync');
const {
  timeToMinutes, minutesToTime, intersectWindows,
  getAbsencePeriod, restrictWindowsForAbsence,
  brusselsOffset, dateToWeekday
} = require('./schedule-helpers');

/**
 * @param {object} opts
 * @param {string} opts.businessId
 * @param {string} [opts.practitionerId] - if omitted, all active practitioners
 * @param {string} opts.date - YYYY-MM-DD
 * @returns {Promise<object>}
 */
async function detectGaps({ businessId, date, practitionerId }) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw Object.assign(new Error('Format de date invalide'), { type: 'validation' });
  }

  const weekday = dateToWeekday(date);
  const tzOffset = brusselsOffset(date);
  const hour12 = timeToMinutes('12:00');
  const timeOfDay = (startMin) => startMin < hour12 ? 'morning' : 'afternoon';

  // ── 1. Fetch practitioners ──
  let practitionerIds;
  const pracNames = {};
  if (practitionerId) {
    const r = await queryWithRLS(businessId,
      `SELECT id, display_name FROM practitioners
       WHERE id = $1 AND business_id = $2 AND is_active = true`,
      [practitionerId, businessId]);
    if (r.rows.length === 0) throw Object.assign(new Error('Praticien introuvable'), { type: 'not_found' });
    practitionerIds = [practitionerId];
    pracNames[practitionerId] = r.rows[0].display_name;
  } else {
    const r = await queryWithRLS(businessId,
      `SELECT id, display_name FROM practitioners
       WHERE business_id = $1 AND is_active = true ORDER BY sort_order`,
      [businessId]);
    practitionerIds = r.rows.map(p => p.id);
    for (const p of r.rows) pracNames[p.id] = p.display_name;
  }
  if (practitionerIds.length === 0) return { date, practitioners: [] };

  // ── 2. Fetch schedule constraints (same pattern as slot-engine) ──

  // Business schedule
  const bizSchedResult = await queryWithRLS(businessId,
    `SELECT weekday, start_time, end_time FROM business_schedule
     WHERE business_id = $1 AND is_active = true ORDER BY weekday, start_time`,
    [businessId]);
  const bizScheduleMap = {};
  for (const row of bizSchedResult.rows) {
    if (!bizScheduleMap[row.weekday]) bizScheduleMap[row.weekday] = [];
    bizScheduleMap[row.weekday].push({ start: row.start_time, end: row.end_time });
  }
  const hasBizSchedule = Object.keys(bizScheduleMap).length > 0;

  // Business closures
  const closureResult = await queryWithRLS(businessId,
    `SELECT date_from, date_to FROM business_closures
     WHERE business_id = $1 AND date_from <= $2::date AND date_to >= $2::date`,
    [businessId, date]);
  if (closureResult.rows.length > 0) return { date, practitioners: [], closed: true };

  // Business holidays
  const holidayResult = await queryWithRLS(businessId,
    `SELECT date FROM business_holidays WHERE business_id = $1 AND date = $2::date`,
    [businessId, date]);
  if (holidayResult.rows.length > 0) return { date, practitioners: [], holiday: true };

  // Salon closed this weekday?
  const bizWindows = bizScheduleMap[weekday];
  if (hasBizSchedule && (!bizWindows || bizWindows.length === 0)) {
    return { date, practitioners: [], closed_weekday: true };
  }

  // Practitioner availabilities
  const availResult = await queryWithRLS(businessId,
    `SELECT practitioner_id, weekday, start_time, end_time
     FROM availabilities
     WHERE business_id = $1 AND practitioner_id = ANY($2) AND is_active = true
     ORDER BY weekday, start_time`,
    [businessId, practitionerIds]);
  const availMap = {};
  for (const row of availResult.rows) {
    const key = `${row.practitioner_id}-${row.weekday}`;
    if (!availMap[key]) availMap[key] = [];
    availMap[key].push({ start: row.start_time, end: row.end_time });
  }

  // Exceptions
  const exceptResult = await queryWithRLS(businessId,
    `SELECT practitioner_id, date, type, start_time, end_time
     FROM availability_exceptions
     WHERE business_id = $1 AND practitioner_id = ANY($2) AND date = $3`,
    [businessId, practitionerIds, date]);
  const exceptionMap = {};
  for (const row of exceptResult.rows) {
    const key = row.practitioner_id;
    if (!exceptionMap[key]) exceptionMap[key] = [];
    exceptionMap[key].push(row);
  }

  // Staff absences
  const absenceResult = await queryWithRLS(businessId,
    `SELECT practitioner_id, date_from, date_to, period, period_end
     FROM staff_absences
     WHERE business_id = $1 AND practitioner_id = ANY($2)
     AND date_from <= $3::date AND date_to >= $3::date`,
    [businessId, practitionerIds, date]);
  const absenceMap = {};
  for (const row of absenceResult.rows) {
    const pid = row.practitioner_id;
    if (!absenceMap[pid]) absenceMap[pid] = [];
    absenceMap[pid].push({
      from: new Date(row.date_from).toLocaleDateString('en-CA', { timeZone: 'Europe/Brussels' }),
      to: new Date(row.date_to).toLocaleDateString('en-CA', { timeZone: 'Europe/Brussels' }),
      period: row.period || 'full',
      periodEnd: row.period_end || 'full'
    });
  }

  // ── 3. Fetch bookings for the day (with processing time + service info) ──
  const bookingsResult = await queryWithRLS(businessId,
    `SELECT b.id, b.practitioner_id, b.service_id, b.start_at, b.end_at,
            b.processing_time, b.processing_start,
            COALESCE(s.buffer_before_min, 0) AS buffer_before_min,
            COALESCE(s.buffer_after_min, 0) AS buffer_after_min,
            s.name AS service_name
     FROM bookings b
     LEFT JOIN services s ON s.id = b.service_id
     WHERE b.business_id = $1 AND b.practitioner_id = ANY($2)
     AND b.start_at >= ($3::date AT TIME ZONE 'Europe/Brussels')
     AND b.start_at < (($3::date + INTERVAL '1 day') AT TIME ZONE 'Europe/Brussels')
     AND b.status IN ('pending', 'confirmed', 'modified_pending', 'pending_deposit')
     ORDER BY b.start_at`,
    [businessId, practitionerIds, date]);

  const bookingsByPrac = {};
  for (const row of bookingsResult.rows) {
    const pid = row.practitioner_id;
    if (!bookingsByPrac[pid]) bookingsByPrac[pid] = [];
    bookingsByPrac[pid].push(row);
  }

  // ── 3b. Fetch external calendar busy blocks and merge into bookingsByPrac ──
  try {
    const dateObj = new Date(date + 'T00:00:00');
    const nextDay = new Date(dateObj); nextDay.setDate(nextDay.getDate() + 1);
    const rlsQuery = (sql, params) => queryWithRLS(businessId, sql, params);
    for (const pracId of practitionerIds) {
      const busyBlocks = await getBusyBlocks(rlsQuery, businessId, pracId, dateObj, nextDay);
      for (const block of busyBlocks) {
        if (!bookingsByPrac[pracId]) bookingsByPrac[pracId] = [];
        bookingsByPrac[pracId].push({
          id: `ext-${block.id || Date.now()}`,
          practitioner_id: pracId,
          service_id: null,
          start_at: block.start_at,
          end_at: block.end_at,
          processing_time: 0,
          processing_start: 0,
          buffer_before_min: 0,
          buffer_after_min: 0,
          service_name: block.title || 'External event'
        });
      }
    }
  } catch (e) {
    if (e.code === '42P01') {
      // calendar_events table not yet created — ignore
    } else {
      throw e;
    }
  }

  // ── 4. Fetch all active services with practitioner links (for suggestions) ──
  const servicesResult = await queryWithRLS(businessId,
    `SELECT s.id, s.name, s.duration_min, s.buffer_before_min, s.buffer_after_min, s.price_cents,
            ps.practitioner_id
     FROM services s
     JOIN practitioner_services ps ON ps.service_id = s.id
     WHERE s.business_id = $1 AND s.is_active = true
     AND ps.practitioner_id = ANY($2)
     ORDER BY s.price_cents DESC`,
    [businessId, practitionerIds]);

  // Group by practitioner
  const servicesByPrac = {};
  for (const row of servicesResult.rows) {
    const pid = row.practitioner_id;
    if (!servicesByPrac[pid]) servicesByPrac[pid] = [];
    servicesByPrac[pid].push({
      id: row.id,
      name: row.name,
      duration_min: row.duration_min,
      total_min: row.duration_min + (row.buffer_before_min || 0) + (row.buffer_after_min || 0),
      price_cents: row.price_cents
    });
  }

  // ── 5. Fetch waitlist entries ──
  let waitlistByPrac = {};
  try {
    const wlResult = await queryWithRLS(businessId,
      `SELECT id, practitioner_id, service_id, client_name, client_email, preferred_time
       FROM waitlist_entries
       WHERE business_id = $1 AND practitioner_id = ANY($2)
       AND status = 'waiting'
       AND (preferred_days @> $3::jsonb)
       ORDER BY priority ASC, created_at ASC`,
      [businessId, practitionerIds, JSON.stringify([weekday])]);
    for (const row of wlResult.rows) {
      const pid = row.practitioner_id;
      if (!waitlistByPrac[pid]) waitlistByPrac[pid] = [];
      waitlistByPrac[pid].push(row);
    }
  } catch (e) {
    // Waitlist table may not exist
    if (e.code !== '42P01') throw e;
  }

  // ── 6. Process each practitioner ──
  const practitioners = [];

  for (const pracId of practitionerIds) {
    // Resolve work windows (same logic as slot-engine)
    const absencePeriod = getAbsencePeriod(absenceMap[pracId], date);
    if (absencePeriod === 'full') continue;

    const exceptions = exceptionMap[pracId];
    let windows;
    if (exceptions) {
      if (exceptions.some(ex => ex.type === 'closed')) continue;
      const customWindows = exceptions.filter(ex => ex.type === 'custom_hours');
      if (customWindows.length > 0) {
        windows = customWindows.map(ex => ({ start: ex.start_time, end: ex.end_time }));
      } else {
        windows = availMap[`${pracId}-${weekday}`];
        if (!windows || windows.length === 0) continue;
      }
    } else {
      windows = availMap[`${pracId}-${weekday}`];
      if (!windows || windows.length === 0) continue;
    }

    if (absencePeriod === 'am' || absencePeriod === 'pm') {
      windows = restrictWindowsForAbsence(windows, absencePeriod);
      if (windows.length === 0) continue;
    }

    if (hasBizSchedule && bizWindows && bizWindows.length > 0) {
      windows = intersectWindows(windows, bizWindows);
      if (windows.length === 0) continue;
    }

    // Convert windows to minutes
    const workWindows = windows.map(w => ({
      start: timeToMinutes(w.start),
      end: timeToMinutes(w.end)
    }));

    const totalWorkMin = workWindows.reduce((sum, w) => sum + (w.end - w.start), 0);
    const dayBookings = bookingsByPrac[pracId] || [];
    const pracServices = servicesByPrac[pracId] || [];
    const pracWaitlist = waitlistByPrac[pracId] || [];

    // Convert bookings to minutes (Brussels timezone)
    const bkMinutes = dayBookings.map(bk => {
      const s = new Date(bk.start_at);
      const e = new Date(bk.end_at);
      const sParts = s.toLocaleString('en-GB', { timeZone: 'Europe/Brussels', hour12: false }).split(/[\s,/:]+/);
      const eParts = e.toLocaleString('en-GB', { timeZone: 'Europe/Brussels', hour12: false }).split(/[\s,/:]+/);
      const startMin = (parseInt(sParts[3]) || 0) * 60 + (parseInt(sParts[4]) || 0);
      const endMin = (parseInt(eParts[3]) || 0) * 60 + (parseInt(eParts[4]) || 0);
      return {
        id: bk.id,
        service_name: bk.service_name,
        start: startMin,
        end: endMin,
        buffer_before: bk.buffer_before_min || 0,
        buffer_after: bk.buffer_after_min || 0,
        processing_time: parseInt(bk.processing_time) || 0,
        processing_start: parseInt(bk.processing_start) || 0
      };
    }).sort((a, b) => a.start - b.start);

    // ── Walk the timeline to find gaps ──
    const gaps = [];
    let bookedMin = 0;
    let processingUnusedMin = 0;

    for (const window of workWindows) {
      let cursor = window.start;

      // Get bookings within this window
      const windowBookings = bkMinutes.filter(bk =>
        bk.start < window.end && bk.end > window.start
      );

      for (const bk of windowBookings) {
        const effStart = Math.max(bk.start - bk.buffer_before, window.start);
        const effEnd = Math.min(bk.end + bk.buffer_after, window.end);

        // Gap before this booking?
        if (cursor < effStart) {
          const gapDuration = effStart - cursor;
          if (gapDuration >= 10) { // minimum 10 min to be useful
            gaps.push(buildGap('gap', cursor, effStart, gapDuration, pracId, null, null,
              pracServices, pracWaitlist, weekday, timeOfDay(cursor)));
          }
        }

        // Processing window?
        if (bk.processing_time > 0) {
          const poseStart = bk.start + bk.processing_start;
          const poseEnd = poseStart + bk.processing_time;
          // Check if any other booking already occupies this pose window
          const poseOccupied = windowBookings.some(other =>
            other.id !== bk.id && other.start < poseEnd && other.end > poseStart
          );
          if (!poseOccupied && bk.processing_time >= 10) {
            processingUnusedMin += bk.processing_time;
            gaps.push(buildGap('processing', poseStart, poseEnd, bk.processing_time,
              pracId, bk.id, bk.service_name,
              pracServices, pracWaitlist, weekday, timeOfDay(poseStart)));
          }
        }

        bookedMin += (Math.min(bk.end, window.end) - Math.max(bk.start, window.start));
        cursor = Math.max(cursor, effEnd);
      }

      // Gap after last booking until window end?
      if (cursor < window.end) {
        const gapDuration = window.end - cursor;
        if (gapDuration >= 10) {
          gaps.push(buildGap('gap', cursor, window.end, gapDuration, pracId, null, null,
            pracServices, pracWaitlist, weekday, timeOfDay(cursor)));
        }
      }
    }

    const gapMin = gaps.filter(g => g.type === 'gap').reduce((s, g) => s + g.duration_min, 0);
    const occupationPct = totalWorkMin > 0 ? Math.round((bookedMin / totalWorkMin) * 1000) / 10 : 0;

    practitioners.push({
      practitioner_id: pracId,
      practitioner_name: pracNames[pracId],
      work_start: minutesToTime(workWindows[0]?.start || 0),
      work_end: minutesToTime(workWindows[workWindows.length - 1]?.end || 0),
      gaps,
      stats: {
        total_work_min: totalWorkMin,
        booked_min: bookedMin,
        gap_min: gapMin,
        processing_unused_min: processingUnusedMin,
        occupation_pct: occupationPct
      }
    });
  }

  return { date, practitioners };
}

/**
 * Build a gap object with compatible services and waitlist matches.
 */
function buildGap(type, startMin, endMin, durationMin, pracId, parentBookingId, parentService,
  pracServices, pracWaitlist, weekday, tod) {
  // Find services that fit
  const compatible = pracServices
    .filter(s => s.total_min <= durationMin)
    .map(s => ({ id: s.id, name: s.name, duration_min: s.duration_min, price_cents: s.price_cents }));

  const compatibleIds = compatible.map(s => s.id);

  // Find waitlist matches
  const wlMatches = pracWaitlist
    .filter(wl =>
      compatibleIds.includes(wl.service_id) &&
      (wl.preferred_time === 'any' || wl.preferred_time === tod)
    )
    .map(wl => ({
      id: wl.id,
      client_name: wl.client_name,
      service_name: compatible.find(s => s.id === wl.service_id)?.name || '',
      preferred_time: wl.preferred_time
    }));

  const gap = {
    type,
    start: minutesToTime(startMin),
    end: minutesToTime(endMin),
    duration_min: durationMin,
    compatible_services: compatible,
    waitlist_matches: wlMatches
  };

  if (type === 'processing') {
    gap.parent_booking_id = parentBookingId;
    gap.parent_service = parentService;
  }

  return gap;
}

module.exports = { detectGaps };
