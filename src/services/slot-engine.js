const { query } = require('./db');
const { getBusyBlocks } = require('./calendar-sync');

/**
 * SLOT ENGINE — the heart of the booking app.
 * 
 * Calculates available time slots for a given business, service, 
 * practitioner (optional), and date range.
 * 
 * Steps:
 * 1. Get practitioner(s) who can do the service
 * 2. For each date in range, for each practitioner:
 *    a. Get availability windows (weekly schedule - exceptions)
 *    b. Get existing bookings (conflicts)
 *    c. Generate candidate slots at configured granularity
 *    d. Filter out conflicts
 * 3. Return flat list of available slots
 */

async function getAvailableSlots({ businessId, serviceId, practitionerId, dateFrom, dateTo, appointmentMode }) {
  // 1. Fetch business settings
  const bizResult = await query(
    `SELECT settings FROM businesses WHERE id = $1 AND is_active = true`,
    [businessId]
  );
  if (bizResult.rows.length === 0) throw Object.assign(new Error('Cabinet introuvable'), { type: 'not_found' });

  const settings = bizResult.rows[0].settings;
  const granularity = settings.slot_granularity_min || 15;

  // 2. Fetch service details
  const svcResult = await query(
    `SELECT id, duration_min, buffer_before_min, buffer_after_min, mode_options
     FROM services WHERE id = $1 AND business_id = $2 AND is_active = true`,
    [serviceId, businessId]
  );
  if (svcResult.rows.length === 0) throw Object.assign(new Error('Prestation introuvable'), { type: 'not_found' });

  const service = svcResult.rows[0];
  const totalDuration = service.buffer_before_min + service.duration_min + service.buffer_after_min;

  // Check if mode is supported
  if (appointmentMode && !service.mode_options.includes(appointmentMode)) {
    throw Object.assign(new Error(`Mode "${appointmentMode}" non disponible pour cette prestation`), { type: 'validation' });
  }

  // 3. Fetch practitioners for this service
  let practitionerIds;
  if (practitionerId) {
    // Verify this practitioner can do this service
    const psResult = await query(
      `SELECT ps.practitioner_id FROM practitioner_services ps
       JOIN practitioners p ON p.id = ps.practitioner_id
       WHERE ps.service_id = $1 AND ps.practitioner_id = $2
       AND p.business_id = $3 AND p.is_active = true AND p.booking_enabled = true`,
      [serviceId, practitionerId, businessId]
    );
    if (psResult.rows.length === 0) throw Object.assign(new Error('Ce praticien ne propose pas cette prestation'), { type: 'validation' });
    practitionerIds = [practitionerId];
  } else {
    // Get all practitioners for this service
    const psResult = await query(
      `SELECT ps.practitioner_id FROM practitioner_services ps
       JOIN practitioners p ON p.id = ps.practitioner_id
       WHERE ps.service_id = $1 AND p.business_id = $2
       AND p.is_active = true AND p.booking_enabled = true
       ORDER BY p.sort_order`,
      [serviceId, businessId]
    );
    practitionerIds = psResult.rows.map(r => r.practitioner_id);
  }

  if (practitionerIds.length === 0) return [];

  // 4. Fetch availabilities for all relevant practitioners
  const availResult = await query(
    `SELECT practitioner_id, weekday, start_time, end_time
     FROM availabilities
     WHERE business_id = $1 AND practitioner_id = ANY($2) AND is_active = true
     ORDER BY weekday, start_time`,
    [businessId, practitionerIds]
  );

  // Group by practitioner+weekday
  const availMap = {};
  for (const row of availResult.rows) {
    const key = `${row.practitioner_id}-${row.weekday}`;
    if (!availMap[key]) availMap[key] = [];
    availMap[key].push({ start: row.start_time, end: row.end_time });
  }

  // 5. Fetch exceptions in date range
  const exceptResult = await query(
    `SELECT practitioner_id, date, type, start_time, end_time
     FROM availability_exceptions
     WHERE business_id = $1 AND practitioner_id = ANY($2)
     AND date >= $3 AND date <= $4`,
    [businessId, practitionerIds, dateFrom, dateTo]
  );

  const exceptionMap = {};
  for (const row of exceptResult.rows) {
    const key = `${row.practitioner_id}-${row.date.toISOString().split('T')[0]}`;
    exceptionMap[key] = row;
  }

  // 6. Fetch existing bookings in date range (conflicts)
  const bookingsResult = await query(
    `SELECT practitioner_id, start_at, end_at
     FROM bookings
     WHERE business_id = $1 AND practitioner_id = ANY($2)
     AND start_at >= $3 AND start_at <= ($4::date + INTERVAL '1 day')
     AND status IN ('pending', 'confirmed')
     ORDER BY start_at`,
    [businessId, practitionerIds, dateFrom, dateTo]
  );

  // Group bookings by practitioner+date
  const bookingMap = {};
  for (const row of bookingsResult.rows) {
    const dateStr = row.start_at.toISOString().split('T')[0];
    const key = `${row.practitioner_id}-${dateStr}`;
    if (!bookingMap[key]) bookingMap[key] = [];
    bookingMap[key].push({
      start: row.start_at,
      end: row.end_at
    });
  }

  // 6b. Fetch busy blocks from external calendars (Google/Outlook)
  try {
    for (const pracId of practitionerIds) {
      const busyBlocks = await getBusyBlocks(query, businessId, pracId, new Date(dateFrom), new Date(dateTo));
      for (const block of busyBlocks) {
        const dateStr = new Date(block.start_at).toISOString().split('T')[0];
        const key = `${pracId}-${dateStr}`;
        if (!bookingMap[key]) bookingMap[key] = [];
        bookingMap[key].push({
          start: new Date(block.start_at),
          end: new Date(block.end_at)
        });
      }
    }
  } catch (e) {
    // Non-critical: if calendar_events table doesn't exist yet or no connections,
    // just continue without external busy blocks
    console.warn('Calendar busy blocks unavailable:', e.message);
  }

  // 7. Generate slots
  const slots = [];
  const startDate = new Date(dateFrom);
  const endDate = new Date(dateTo);

  // DST-safe: compute correct UTC offset for a given date in Europe/Brussels
  function brusselsOffset(dateStr) {
    const d = new Date(dateStr + 'T12:00:00Z');
    const utc = new Date(d.toLocaleString('en-US', { timeZone: 'UTC' }));
    const bxl = new Date(d.toLocaleString('en-US', { timeZone: 'Europe/Brussels' }));
    const hours = Math.round((bxl - utc) / 3600000);
    return `${hours >= 0 ? '+' : '-'}${String(Math.abs(hours)).padStart(2, '0')}:00`;
  }

  for (let d = new Date(startDate); d <= endDate; d.setDate(d.getDate() + 1)) {
    const dateStr = d.toISOString().split('T')[0];
    // JavaScript: 0=Sunday, we use 0=Monday → convert
    const jsDay = d.getDay(); // 0=Sun, 1=Mon, ...
    const weekday = jsDay === 0 ? 6 : jsDay - 1; // 0=Mon, 6=Sun
    const tzOffset = brusselsOffset(dateStr);

    for (const pracId of practitionerIds) {
      // Check exceptions
      const exKey = `${pracId}-${dateStr}`;
      const exception = exceptionMap[exKey];

      let windows;
      if (exception) {
        if (exception.type === 'closed') continue; // Skip this day entirely
        // Custom hours
        windows = [{ start: exception.start_time, end: exception.end_time }];
      } else {
        // Normal weekly schedule
        const avKey = `${pracId}-${weekday}`;
        windows = availMap[avKey];
        if (!windows || windows.length === 0) continue; // Not available this day
      }

      // Get bookings for this practitioner on this date
      const bkKey = `${pracId}-${dateStr}`;
      const dayBookings = bookingMap[bkKey] || [];

      // Generate candidate slots within each window
      for (const window of windows) {
        const windowStart = timeToMinutes(window.start);
        const windowEnd = timeToMinutes(window.end);

        for (let startMin = windowStart; startMin + totalDuration <= windowEnd; startMin += granularity) {
          const slotStart = new Date(`${dateStr}T${minutesToTime(startMin)}:00${tzOffset}`);
          const slotEnd = new Date(slotStart.getTime() + totalDuration * 60000);

          // Check if slot is in the past
          if (slotStart <= new Date()) continue;

          // Check for conflicts with existing bookings
          const hasConflict = dayBookings.some(bk => {
            return slotStart < bk.end && slotEnd > bk.start;
          });

          if (!hasConflict) {
            slots.push({
              practitioner_id: pracId,
              date: dateStr,
              start_time: minutesToTime(startMin),
              end_time: minutesToTime(startMin + service.duration_min),
              start_at: slotStart.toISOString(),
              end_at: new Date(slotStart.getTime() + service.duration_min * 60000).toISOString()
            });
          }
        }
      }
    }
  }

  return slots;
}

// ===== Helpers =====

function timeToMinutes(timeStr) {
  // "09:30" → 570
  const parts = String(timeStr).split(':');
  return parseInt(parts[0]) * 60 + parseInt(parts[1]);
}

function minutesToTime(minutes) {
  // 570 → "09:30"
  const h = Math.floor(minutes / 60).toString().padStart(2, '0');
  const m = (minutes % 60).toString().padStart(2, '0');
  return `${h}:${m}`;
}

module.exports = { getAvailableSlots };
