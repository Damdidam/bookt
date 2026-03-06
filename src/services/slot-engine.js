const { queryWithRLS } = require('./db');
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

async function getAvailableSlots({ businessId, serviceId, practitionerId, dateFrom, dateTo, appointmentMode, variantId }) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateFrom) || !/^\d{4}-\d{2}-\d{2}$/.test(dateTo)) {
    throw Object.assign(new Error('Format de date invalide'), { type: 'validation' });
  }
  if (dateFrom > dateTo) throw Object.assign(new Error('dateFrom doit être <= dateTo'), { type: 'validation' });
  const daysDiff = (new Date(dateTo) - new Date(dateFrom)) / 86400000;
  if (daysDiff > 90) throw Object.assign(new Error('Plage maximale : 90 jours'), { type: 'validation' });

  // 1. Fetch business settings
  const bizResult = await queryWithRLS(businessId,
    `SELECT settings FROM businesses WHERE id = $1 AND is_active = true`,
    [businessId]
  );
  if (bizResult.rows.length === 0) throw Object.assign(new Error('Cabinet introuvable'), { type: 'not_found' });

  const settings = bizResult.rows[0].settings;
  // SVC-V11-9: Guard against zero/negative granularity (would cause infinite loop)
  const granularity = Math.max(parseInt(settings.slot_granularity_min, 10) || 15, 1);

  // 2. Fetch service details
  const svcResult = await queryWithRLS(businessId,
    `SELECT id, duration_min, buffer_before_min, buffer_after_min, mode_options, available_schedule
     FROM services WHERE id = $1 AND business_id = $2 AND is_active = true`,
    [serviceId, businessId]
  );
  if (svcResult.rows.length === 0) throw Object.assign(new Error('Prestation introuvable'), { type: 'not_found' });

  const service = svcResult.rows[0];

  // Override duration from variant if provided
  if (variantId) {
    const varResult = await queryWithRLS(businessId,
      `SELECT duration_min FROM service_variants
       WHERE id = $1 AND service_id = $2 AND business_id = $3 AND is_active = true`,
      [variantId, serviceId, businessId]
    );
    if (varResult.rows.length === 0) throw Object.assign(new Error('Variante introuvable'), { type: 'not_found' });
    service.duration_min = varResult.rows[0].duration_min;
  }

  const totalDuration = (service.buffer_before_min || 0) + service.duration_min + (service.buffer_after_min || 0);

  if (!totalDuration || totalDuration <= 0) {
    throw Object.assign(new Error(`Durée de prestation invalide (${totalDuration} min)`), { type: 'validation' });
  }

  // Check if mode is supported
  if (appointmentMode && !(service.mode_options || []).includes(appointmentMode)) {
    throw Object.assign(new Error(`Mode "${appointmentMode}" non disponible pour cette prestation`), { type: 'validation' });
  }

  // 3. Fetch practitioners for this service (with capacity)
  let practitionerIds;
  const capacityMap = {}; // pracId → max_concurrent
  if (practitionerId) {
    // Verify this practitioner can do this service
    const psResult = await queryWithRLS(businessId,
      `SELECT ps.practitioner_id, COALESCE(p.max_concurrent, 1) AS max_concurrent
       FROM practitioner_services ps
       JOIN practitioners p ON p.id = ps.practitioner_id
       WHERE ps.service_id = $1 AND ps.practitioner_id = $2
       AND p.business_id = $3 AND p.is_active = true AND p.booking_enabled = true`,
      [serviceId, practitionerId, businessId]
    );
    if (psResult.rows.length === 0) throw Object.assign(new Error('Ce praticien ne propose pas cette prestation'), { type: 'validation' });
    practitionerIds = [practitionerId];
    capacityMap[practitionerId] = psResult.rows[0].max_concurrent;
  } else {
    // Get all practitioners for this service
    const psResult = await queryWithRLS(businessId,
      `SELECT ps.practitioner_id, COALESCE(p.max_concurrent, 1) AS max_concurrent
       FROM practitioner_services ps
       JOIN practitioners p ON p.id = ps.practitioner_id
       WHERE ps.service_id = $1 AND p.business_id = $2
       AND p.is_active = true AND p.booking_enabled = true
       ORDER BY p.sort_order`,
      [serviceId, businessId]
    );
    practitionerIds = psResult.rows.map(r => r.practitioner_id);
    for (const r of psResult.rows) capacityMap[r.practitioner_id] = r.max_concurrent;
  }

  if (practitionerIds.length === 0) return [];

  // 4. Fetch availabilities for all relevant practitioners
  const availResult = await queryWithRLS(businessId,
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
  const exceptResult = await queryWithRLS(businessId,
    `SELECT practitioner_id, date, type, start_time, end_time
     FROM availability_exceptions
     WHERE business_id = $1 AND practitioner_id = ANY($2)
     AND date >= $3 AND date <= $4`,
    [businessId, practitionerIds, dateFrom, dateTo]
  );

  const exceptionMap = {};
  for (const row of exceptResult.rows) {
    const key = `${row.practitioner_id}-${new Date(row.date).toLocaleDateString('en-CA', { timeZone: 'Europe/Brussels' })}`;
    if (!exceptionMap[key]) exceptionMap[key] = [];
    exceptionMap[key].push(row);
  }

  // 5b. Fetch business schedule (salon opening hours)
  const bizSchedResult = await queryWithRLS(businessId,
    `SELECT weekday, start_time, end_time FROM business_schedule
     WHERE business_id = $1 AND is_active = true ORDER BY weekday, start_time`,
    [businessId]
  );
  const bizScheduleMap = {};
  for (const row of bizSchedResult.rows) {
    if (!bizScheduleMap[row.weekday]) bizScheduleMap[row.weekday] = [];
    bizScheduleMap[row.weekday].push({ start: row.start_time, end: row.end_time });
  }
  const hasBizSchedule = Object.keys(bizScheduleMap).length > 0;

  // 5c. Fetch business closures in date range
  const bizClosureResult = await queryWithRLS(businessId,
    `SELECT date_from, date_to FROM business_closures
     WHERE business_id = $1 AND date_to >= $2::date AND date_from <= $3::date`,
    [businessId, dateFrom, dateTo]
  );
  const bizClosures = bizClosureResult.rows.map(r => ({
    from: new Date(r.date_from).toISOString().slice(0, 10),
    to: new Date(r.date_to).toISOString().slice(0, 10)
  }));

  // 5d. Fetch business holidays in date range
  const bizHolidayResult = await queryWithRLS(businessId,
    `SELECT date FROM business_holidays
     WHERE business_id = $1 AND date >= $2::date AND date <= $3::date`,
    [businessId, dateFrom, dateTo]
  );
  const bizHolidaySet = new Set(bizHolidayResult.rows.map(r =>
    new Date(r.date).toISOString().slice(0, 10)
  ));

  // 5e. Fetch staff absences in date range (congés, maladie, formation…)
  const absenceResult = await queryWithRLS(businessId,
    `SELECT practitioner_id, date_from, date_to, period, period_end
     FROM staff_absences
     WHERE business_id = $1 AND practitioner_id = ANY($2)
     AND date_from <= $4::date AND date_to >= $3::date`,
    [businessId, practitionerIds, dateFrom, dateTo]
  );
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

  // 6. Fetch existing bookings in date range (conflicts)
  const bookingsResult = await queryWithRLS(businessId,
    `SELECT b.practitioner_id, b.start_at, b.end_at,
            COALESCE(s.buffer_before_min, 0) AS buffer_before_min,
            COALESCE(s.buffer_after_min, 0) AS buffer_after_min
     FROM bookings b
     LEFT JOIN services s ON s.id = b.service_id
     WHERE b.business_id = $1 AND b.practitioner_id = ANY($2)
     AND b.end_at > ($3::date AT TIME ZONE 'Europe/Brussels')
     AND b.start_at <= (($4::date + INTERVAL '1 day') AT TIME ZONE 'Europe/Brussels')
     AND b.status IN ('pending', 'confirmed', 'modified_pending', 'pending_deposit')
     ORDER BY b.start_at`,
    [businessId, practitionerIds, dateFrom, dateTo]
  );

  // Group bookings by practitioner+date (Brussels timezone for correct day grouping)
  const bookingMap = {};
  for (const row of bookingsResult.rows) {
    const dateStr = row.start_at.toLocaleDateString('en-CA', { timeZone: 'Europe/Brussels' });
    const key = `${row.practitioner_id}-${dateStr}`;
    if (!bookingMap[key]) bookingMap[key] = [];
    bookingMap[key].push({
      start: row.start_at,
      end: row.end_at,
      buffer_before_min: row.buffer_before_min || 0,
      buffer_after_min: row.buffer_after_min || 0
    });
  }

  // 6b. Fetch busy blocks from external calendars (Google/Outlook)
  try {
    for (const pracId of practitionerIds) {
      const rlsQuery = (sql, params) => queryWithRLS(businessId, sql, params);
      const busyBlocks = await getBusyBlocks(rlsQuery, businessId, pracId, new Date(dateFrom), new Date(dateTo));
      for (const block of busyBlocks) {
        const dateStr = new Date(block.start_at).toLocaleDateString('en-CA', { timeZone: 'Europe/Brussels' });
        const key = `${pracId}-${dateStr}`;
        if (!bookingMap[key]) bookingMap[key] = [];
        bookingMap[key].push({
          start: new Date(block.start_at),
          end: new Date(block.end_at)
        });
      }
    }
  } catch (e) {
    // Only swallow "undefined table" errors (calendar_events not yet created)
    if (e.code === '42P01') {
      console.warn('Calendar busy blocks unavailable:', e.message);
    } else {
      throw e;
    }
  }

  // 7. Generate slots
  const now = new Date();
  const slots = [];

  // DST-safe: compute correct UTC offset for a given date in Europe/Brussels
  function brusselsOffset(dateStr) {
    const d = new Date(dateStr + 'T12:00:00Z');
    const utc = new Date(d.toLocaleString('en-US', { timeZone: 'UTC' }));
    const bxl = new Date(d.toLocaleString('en-US', { timeZone: 'Europe/Brussels' }));
    const hours = Math.round((bxl - utc) / 3600000);
    return `${hours >= 0 ? '+' : '-'}${String(Math.abs(hours)).padStart(2, '0')}:00`;
  }

  // DST-safe date iteration using string arithmetic (avoids setDate DST skips)
  function nextDateStr(ds) {
    const [y, m, d] = ds.split('-').map(Number);
    const next = new Date(Date.UTC(y, m - 1, d + 1));
    return next.toISOString().split('T')[0];
  }

  for (let dateStr = dateFrom; dateStr <= dateTo; dateStr = nextDateStr(dateStr)) {
    // Calculate weekday from date string (noon UTC to avoid edge cases)
    const dayDate = new Date(dateStr + 'T12:00:00Z');
    const jsDay = dayDate.getUTCDay(); // 0=Sun, 1=Mon, ...
    const weekday = jsDay === 0 ? 6 : jsDay - 1; // 0=Mon, 6=Sun
    const tzOffset = brusselsOffset(dateStr);

    // Skip if business holiday
    if (bizHolidaySet.has(dateStr)) continue;

    // Skip if in a business closure range
    if (bizClosures.some(c => dateStr >= c.from && dateStr <= c.to)) continue;

    // Skip if salon is closed this weekday (only when business_schedule has data)
    const bizWindows = bizScheduleMap[weekday];
    if (hasBizSchedule && (!bizWindows || bizWindows.length === 0)) continue;

    for (const pracId of practitionerIds) {
      // Check staff absences (congés, maladie…)
      const absencePeriod = getAbsencePeriod(absenceMap[pracId], dateStr);
      if (absencePeriod === 'full') continue; // Fully absent → skip

      // Check exceptions
      const exKey = `${pracId}-${dateStr}`;
      const exceptions = exceptionMap[exKey];

      let windows;
      if (exceptions) {
        if (exceptions.some(ex => ex.type === 'closed')) continue; // Skip this day entirely
        // custom_hours: use all windows
        const customWindows = exceptions.filter(ex => ex.type === 'custom_hours');
        if (customWindows.length > 0) {
          windows = customWindows.map(ex => ({ start: ex.start_time, end: ex.end_time }));
        } else {
          // Exceptions exist but none are custom_hours or closed — fall through to weekly
          const avKey = `${pracId}-${weekday}`;
          windows = availMap[avKey];
          if (!windows || windows.length === 0) continue;
        }
      } else {
        // Normal weekly schedule
        const avKey = `${pracId}-${weekday}`;
        windows = availMap[avKey];
        if (!windows || windows.length === 0) continue; // Not available this day
      }

      // Restrict windows for half-day absence (am/pm)
      if (absencePeriod === 'am' || absencePeriod === 'pm') {
        windows = restrictWindowsForAbsence(windows, absencePeriod);
        if (windows.length === 0) continue;
      }

      // Intersect with business hours (salon-level constraint)
      if (hasBizSchedule && bizWindows && bizWindows.length > 0) {
        windows = intersectWindows(windows, bizWindows);
        if (windows.length === 0) continue;
      }

      // Service time restrictions — intersect with practitioner windows
      if (service.available_schedule?.type === 'restricted') {
        const svcWindows = (service.available_schedule.windows || [])
          .filter(w => w.day === weekday)
          .map(w => ({ start: w.from, end: w.to }));
        if (svcWindows.length === 0) continue; // service not available this day
        windows = intersectWindows(windows, svcWindows);
        if (windows.length === 0) continue;
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
          if (slotStart <= now) continue;

          // Check for conflicts with existing bookings (capacity-aware)
          // Buffers are included in totalDuration for the NEW slot (slotStart→slotEnd),
          // and existing bookings are expanded by their own service buffers.
          const overlapCount = dayBookings.filter(bk => {
            const bkStart = new Date(bk.start.getTime() - (bk.buffer_before_min || 0) * 60000);
            const bkEnd = new Date(bk.end.getTime() + (bk.buffer_after_min || 0) * 60000);
            return slotStart < bkEnd && slotEnd > bkStart;
          }).length;

          if (overlapCount < (capacityMap[pracId] || 1)) {
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

/**
 * Intersect two sets of time windows.
 * Each window: { start: "HH:MM", end: "HH:MM" }
 * Returns the overlapping segments.
 */
function intersectWindows(windowsA, windowsB) {
  const result = [];
  for (const a of windowsA) {
    const aStart = timeToMinutes(a.start), aEnd = timeToMinutes(a.end);
    for (const b of windowsB) {
      const bStart = timeToMinutes(b.start), bEnd = timeToMinutes(b.end);
      const start = Math.max(aStart, bStart), end = Math.min(aEnd, bEnd);
      if (start < end) {
        result.push({ start: minutesToTime(start), end: minutesToTime(end) });
      }
    }
  }
  return result;
}

/**
 * Determine if a practitioner is absent on a given date, and what period.
 * Returns null (not absent), 'full', 'am', or 'pm'.
 */
function getAbsencePeriod(absences, dateStr) {
  if (!absences) return null;
  for (const abs of absences) {
    if (dateStr >= abs.from && dateStr <= abs.to) {
      if (abs.from === abs.to) return abs.period;
      if (dateStr === abs.from) return abs.period;
      if (dateStr === abs.to) return abs.periodEnd;
      return 'full'; // middle day → fully absent
    }
  }
  return null;
}

/**
 * Restrict time windows for half-day absence.
 * 'am' absence blocks before 13:00, 'pm' blocks from 13:00 onward.
 */
function restrictWindowsForAbsence(windows, period) {
  const noon = 780; // 13:00 in minutes
  return windows.map(w => {
    const ws = timeToMinutes(w.start), we = timeToMinutes(w.end);
    if (period === 'am') {
      if (we <= noon) return null; // entire window in morning → blocked
      return { start: ws < noon ? '13:00' : w.start, end: w.end };
    } else { // pm
      if (ws >= noon) return null; // entire window in afternoon → blocked
      return { start: w.start, end: we > noon ? '13:00' : w.end };
    }
  }).filter(Boolean);
}

/**
 * MULTI-SERVICE SLOT ENGINE
 *
 * Calculates available time slots for chained multi-service bookings.
 * Same algorithm as getAvailableSlots, but totalDuration is the chained
 * sum of all services with buffer_before from first and buffer_after from last only.
 */
async function getAvailableSlotsMulti({ businessId, serviceIds, practitionerId, dateFrom, dateTo, appointmentMode, variantIds }) {
  // Deduplicate serviceIds while preserving order
  if (!Array.isArray(serviceIds)) {
    throw Object.assign(new Error('Au moins 2 prestations requises'), { type: 'validation' });
  }
  serviceIds = [...new Set(serviceIds)];
  if (serviceIds.length < 2) {
    throw Object.assign(new Error('Au moins 2 prestations requises'), { type: 'validation' });
  }
  if (serviceIds.length > 5) {
    throw Object.assign(new Error('Maximum 5 prestations par réservation groupée'), { type: 'validation' });
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateFrom) || !/^\d{4}-\d{2}-\d{2}$/.test(dateTo)) {
    throw Object.assign(new Error('Format de date invalide'), { type: 'validation' });
  }
  if (dateFrom > dateTo) throw Object.assign(new Error('dateFrom doit être <= dateTo'), { type: 'validation' });
  const daysDiff = (new Date(dateTo) - new Date(dateFrom)) / 86400000;
  if (daysDiff > 90) throw Object.assign(new Error('Plage maximale : 90 jours'), { type: 'validation' });

  // 1. Fetch business settings
  const bizResult = await queryWithRLS(businessId,
    `SELECT settings FROM businesses WHERE id = $1 AND is_active = true`,
    [businessId]
  );
  if (bizResult.rows.length === 0) throw Object.assign(new Error('Cabinet introuvable'), { type: 'not_found' });

  const settings = bizResult.rows[0].settings;
  const granularity = Math.max(parseInt(settings.slot_granularity_min, 10) || 15, 1);

  // 2. Fetch all services in one query, preserving order from serviceIds array
  const svcResult = await queryWithRLS(businessId,
    `SELECT id, duration_min, buffer_before_min, buffer_after_min, mode_options, available_schedule
     FROM services WHERE id = ANY($1) AND business_id = $2 AND is_active = true
     ORDER BY array_position($1, id)`,
    [serviceIds, businessId]
  );

  // Validate all services found
  if (svcResult.rows.length !== serviceIds.length) {
    const foundIds = new Set(svcResult.rows.map(r => r.id));
    const missing = serviceIds.filter(id => !foundIds.has(id));
    throw Object.assign(new Error(`Prestation(s) introuvable(s): ${missing.join(', ')}`), { type: 'not_found' });
  }

  const services = svcResult.rows;

  // Override durations from variants if provided
  if (Array.isArray(variantIds) && variantIds.length > 0) {
    for (let i = 0; i < services.length; i++) {
      const vid = variantIds[i];
      if (!vid) continue;
      const vr = await queryWithRLS(businessId,
        `SELECT duration_min FROM service_variants
         WHERE id = $1 AND service_id = $2 AND business_id = $3 AND is_active = true`,
        [vid, services[i].id, businessId]
      );
      if (vr.rows.length === 0) throw Object.assign(new Error(`Variante introuvable: ${vid}`), { type: 'not_found' });
      services[i].duration_min = vr.rows[0].duration_min;
    }
  }

  // 3. Calculate chained duration: buffer_before from FIRST, buffer_after from LAST, no buffers between
  const sumDurations = services.reduce((sum, s) => sum + s.duration_min, 0);
  const bufferBefore = services[0].buffer_before_min || 0;
  const bufferAfter = services[services.length - 1].buffer_after_min || 0;
  const totalDuration = bufferBefore + sumDurations + bufferAfter;

  if (!totalDuration || totalDuration <= 0) {
    throw Object.assign(new Error(`Durée totale invalide (${totalDuration} min)`), { type: 'validation' });
  }

  // 4. Mode validation: if appointmentMode provided, ALL services must support it
  if (appointmentMode) {
    for (const svc of services) {
      if (!(svc.mode_options || []).includes(appointmentMode)) {
        throw Object.assign(
          new Error(`Mode "${appointmentMode}" non disponible pour la prestation ${svc.id}`),
          { type: 'validation' }
        );
      }
    }
  }

  // 5. Find practitioners who offer ALL services (intersection)
  let practitionerIds;
  const capacityMap = {};
  if (practitionerId) {
    // Verify this practitioner offers ALL services
    const psResult = await queryWithRLS(businessId,
      `SELECT ps.practitioner_id, COALESCE(p.max_concurrent, 1) AS max_concurrent
       FROM practitioner_services ps
       JOIN practitioners p ON p.id = ps.practitioner_id
       WHERE ps.service_id = ANY($1) AND ps.practitioner_id = $2
       AND p.business_id = $3 AND p.is_active = true AND p.booking_enabled = true
       GROUP BY ps.practitioner_id, p.max_concurrent
       HAVING COUNT(DISTINCT ps.service_id) = $4`,
      [serviceIds, practitionerId, businessId, serviceIds.length]
    );
    if (psResult.rows.length === 0) {
      throw Object.assign(new Error('Ce praticien ne propose pas toutes les prestations sélectionnées'), { type: 'validation' });
    }
    practitionerIds = [practitionerId];
    capacityMap[practitionerId] = psResult.rows[0].max_concurrent;
  } else {
    const psResult = await queryWithRLS(businessId,
      `SELECT ps.practitioner_id, COALESCE(p.max_concurrent, 1) AS max_concurrent
       FROM practitioner_services ps
       JOIN practitioners p ON p.id = ps.practitioner_id
       WHERE ps.service_id = ANY($1) AND p.business_id = $2
       AND p.is_active = true AND p.booking_enabled = true
       GROUP BY ps.practitioner_id, p.max_concurrent, p.sort_order
       HAVING COUNT(DISTINCT ps.service_id) = $3
       ORDER BY p.sort_order`,
      [serviceIds, businessId, serviceIds.length]
    );
    practitionerIds = psResult.rows.map(r => r.practitioner_id);
    for (const r of psResult.rows) capacityMap[r.practitioner_id] = r.max_concurrent;
  }

  if (practitionerIds.length === 0) return [];

  // 6. Fetch availabilities, exceptions, bookings, busy blocks — same as getAvailableSlots
  const availResult = await queryWithRLS(businessId,
    `SELECT practitioner_id, weekday, start_time, end_time
     FROM availabilities
     WHERE business_id = $1 AND practitioner_id = ANY($2) AND is_active = true
     ORDER BY weekday, start_time`,
    [businessId, practitionerIds]
  );

  const availMap = {};
  for (const row of availResult.rows) {
    const key = `${row.practitioner_id}-${row.weekday}`;
    if (!availMap[key]) availMap[key] = [];
    availMap[key].push({ start: row.start_time, end: row.end_time });
  }

  const exceptResult = await queryWithRLS(businessId,
    `SELECT practitioner_id, date, type, start_time, end_time
     FROM availability_exceptions
     WHERE business_id = $1 AND practitioner_id = ANY($2)
     AND date >= $3 AND date <= $4`,
    [businessId, practitionerIds, dateFrom, dateTo]
  );

  const exceptionMap = {};
  for (const row of exceptResult.rows) {
    const key = `${row.practitioner_id}-${new Date(row.date).toLocaleDateString('en-CA', { timeZone: 'Europe/Brussels' })}`;
    if (!exceptionMap[key]) exceptionMap[key] = [];
    exceptionMap[key].push(row);
  }

  const bookingsResult = await queryWithRLS(businessId,
    `SELECT b.practitioner_id, b.start_at, b.end_at,
            COALESCE(s.buffer_before_min, 0) AS buffer_before_min,
            COALESCE(s.buffer_after_min, 0) AS buffer_after_min
     FROM bookings b
     LEFT JOIN services s ON s.id = b.service_id
     WHERE b.business_id = $1 AND b.practitioner_id = ANY($2)
     AND b.end_at > ($3::date AT TIME ZONE 'Europe/Brussels')
     AND b.start_at <= (($4::date + INTERVAL '1 day') AT TIME ZONE 'Europe/Brussels')
     AND b.status IN ('pending', 'confirmed', 'modified_pending', 'pending_deposit')
     ORDER BY b.start_at`,
    [businessId, practitionerIds, dateFrom, dateTo]
  );

  const bookingMap = {};
  for (const row of bookingsResult.rows) {
    const dateStr = row.start_at.toLocaleDateString('en-CA', { timeZone: 'Europe/Brussels' });
    const key = `${row.practitioner_id}-${dateStr}`;
    if (!bookingMap[key]) bookingMap[key] = [];
    bookingMap[key].push({
      start: row.start_at,
      end: row.end_at,
      buffer_before_min: row.buffer_before_min || 0,
      buffer_after_min: row.buffer_after_min || 0
    });
  }

  // 6b. Fetch business schedule, closures, holidays (same as getAvailableSlots)
  const bizSchedResult2 = await queryWithRLS(businessId,
    `SELECT weekday, start_time, end_time FROM business_schedule
     WHERE business_id = $1 AND is_active = true ORDER BY weekday, start_time`,
    [businessId]
  );
  const bizScheduleMap2 = {};
  for (const row of bizSchedResult2.rows) {
    if (!bizScheduleMap2[row.weekday]) bizScheduleMap2[row.weekday] = [];
    bizScheduleMap2[row.weekday].push({ start: row.start_time, end: row.end_time });
  }
  const hasBizSchedule2 = Object.keys(bizScheduleMap2).length > 0;

  const bizClosureResult2 = await queryWithRLS(businessId,
    `SELECT date_from, date_to FROM business_closures
     WHERE business_id = $1 AND date_to >= $2::date AND date_from <= $3::date`,
    [businessId, dateFrom, dateTo]
  );
  const bizClosures2 = bizClosureResult2.rows.map(r => ({
    from: new Date(r.date_from).toISOString().slice(0, 10),
    to: new Date(r.date_to).toISOString().slice(0, 10)
  }));

  const bizHolidayResult2 = await queryWithRLS(businessId,
    `SELECT date FROM business_holidays
     WHERE business_id = $1 AND date >= $2::date AND date <= $3::date`,
    [businessId, dateFrom, dateTo]
  );
  const bizHolidaySet2 = new Set(bizHolidayResult2.rows.map(r =>
    new Date(r.date).toISOString().slice(0, 10)
  ));

  // 6c. Fetch staff absences in date range (congés, maladie, formation…)
  const absenceResult2 = await queryWithRLS(businessId,
    `SELECT practitioner_id, date_from, date_to, period, period_end
     FROM staff_absences
     WHERE business_id = $1 AND practitioner_id = ANY($2)
     AND date_from <= $4::date AND date_to >= $3::date`,
    [businessId, practitionerIds, dateFrom, dateTo]
  );
  const absenceMap2 = {};
  for (const row of absenceResult2.rows) {
    const pid = row.practitioner_id;
    if (!absenceMap2[pid]) absenceMap2[pid] = [];
    absenceMap2[pid].push({
      from: new Date(row.date_from).toLocaleDateString('en-CA', { timeZone: 'Europe/Brussels' }),
      to: new Date(row.date_to).toLocaleDateString('en-CA', { timeZone: 'Europe/Brussels' }),
      period: row.period || 'full',
      periodEnd: row.period_end || 'full'
    });
  }

  // Busy blocks from external calendars
  try {
    for (const pracId of practitionerIds) {
      const rlsQuery = (sql, params) => queryWithRLS(businessId, sql, params);
      const busyBlocks = await getBusyBlocks(rlsQuery, businessId, pracId, new Date(dateFrom), new Date(dateTo));
      for (const block of busyBlocks) {
        const dateStr = new Date(block.start_at).toLocaleDateString('en-CA', { timeZone: 'Europe/Brussels' });
        const key = `${pracId}-${dateStr}`;
        if (!bookingMap[key]) bookingMap[key] = [];
        bookingMap[key].push({
          start: new Date(block.start_at),
          end: new Date(block.end_at)
        });
      }
    }
  } catch (e) {
    if (e.code === '42P01') {
      console.warn('Calendar busy blocks unavailable:', e.message);
    } else {
      throw e;
    }
  }

  // 7. Generate slots — same loop as getAvailableSlots, using chained totalDuration
  const now = new Date();
  const slots = [];

  function brusselsOffset(dateStr) {
    const d = new Date(dateStr + 'T12:00:00Z');
    const utc = new Date(d.toLocaleString('en-US', { timeZone: 'UTC' }));
    const bxl = new Date(d.toLocaleString('en-US', { timeZone: 'Europe/Brussels' }));
    const hours = Math.round((bxl - utc) / 3600000);
    return `${hours >= 0 ? '+' : '-'}${String(Math.abs(hours)).padStart(2, '0')}:00`;
  }

  function nextDateStr(ds) {
    const [y, m, d] = ds.split('-').map(Number);
    const next = new Date(Date.UTC(y, m - 1, d + 1));
    return next.toISOString().split('T')[0];
  }

  for (let dateStr = dateFrom; dateStr <= dateTo; dateStr = nextDateStr(dateStr)) {
    const dayDate = new Date(dateStr + 'T12:00:00Z');
    const jsDay = dayDate.getUTCDay();
    const weekday = jsDay === 0 ? 6 : jsDay - 1;
    const tzOffset = brusselsOffset(dateStr);

    // Skip if business holiday
    if (bizHolidaySet2.has(dateStr)) continue;

    // Skip if in a business closure range
    if (bizClosures2.some(c => dateStr >= c.from && dateStr <= c.to)) continue;

    // Skip if salon is closed this weekday
    const bizWindows2 = bizScheduleMap2[weekday];
    if (hasBizSchedule2 && (!bizWindows2 || bizWindows2.length === 0)) continue;

    for (const pracId of practitionerIds) {
      // Check staff absences (congés, maladie…)
      const absencePeriod2 = getAbsencePeriod(absenceMap2[pracId], dateStr);
      if (absencePeriod2 === 'full') continue; // Fully absent → skip

      const exKey = `${pracId}-${dateStr}`;
      const exceptions = exceptionMap[exKey];

      let windows;
      if (exceptions) {
        if (exceptions.some(ex => ex.type === 'closed')) continue;
        const customWindows = exceptions.filter(ex => ex.type === 'custom_hours');
        if (customWindows.length > 0) {
          windows = customWindows.map(ex => ({ start: ex.start_time, end: ex.end_time }));
        } else {
          const avKey = `${pracId}-${weekday}`;
          windows = availMap[avKey];
          if (!windows || windows.length === 0) continue;
        }
      } else {
        const avKey = `${pracId}-${weekday}`;
        windows = availMap[avKey];
        if (!windows || windows.length === 0) continue;
      }

      // Restrict windows for half-day absence (am/pm)
      if (absencePeriod2 === 'am' || absencePeriod2 === 'pm') {
        windows = restrictWindowsForAbsence(windows, absencePeriod2);
        if (windows.length === 0) continue;
      }

      // Intersect with business hours (salon-level constraint)
      if (hasBizSchedule2 && bizWindows2 && bizWindows2.length > 0) {
        windows = intersectWindows(windows, bizWindows2);
        if (windows.length === 0) continue;
      }

      // Multi-service time restrictions — intersect all services' schedules
      for (const svc of services) {
        if (svc.available_schedule?.type === 'restricted') {
          const svcWindows = (svc.available_schedule.windows || [])
            .filter(w => w.day === weekday)
            .map(w => ({ start: w.from, end: w.to }));
          if (svcWindows.length === 0) { windows = []; break; }
          windows = intersectWindows(windows, svcWindows);
          if (windows.length === 0) break;
        }
      }
      if (windows.length === 0) continue;

      const bkKey = `${pracId}-${dateStr}`;
      const dayBookings = bookingMap[bkKey] || [];

      for (const window of windows) {
        const windowStart = timeToMinutes(window.start);
        const windowEnd = timeToMinutes(window.end);

        for (let startMin = windowStart; startMin + totalDuration <= windowEnd; startMin += granularity) {
          const slotStart = new Date(`${dateStr}T${minutesToTime(startMin)}:00${tzOffset}`);
          const slotEnd = new Date(slotStart.getTime() + totalDuration * 60000);

          if (slotStart <= now) continue;

          const overlapCount = dayBookings.filter(bk => {
            const bkStart = new Date(bk.start.getTime() - (bk.buffer_before_min || 0) * 60000);
            const bkEnd = new Date(bk.end.getTime() + (bk.buffer_after_min || 0) * 60000);
            return slotStart < bkEnd && slotEnd > bkStart;
          }).length;

          if (overlapCount < (capacityMap[pracId] || 1)) {
            // start_time/end_time = actual service time (excluding outer buffers)
            const serviceStartMin = startMin + bufferBefore;
            const serviceEndMin = serviceStartMin + sumDurations;
            slots.push({
              practitioner_id: pracId,
              date: dateStr,
              start_time: minutesToTime(serviceStartMin),
              end_time: minutesToTime(serviceEndMin),
              start_at: new Date(`${dateStr}T${minutesToTime(serviceStartMin)}:00${tzOffset}`).toISOString(),
              end_at: new Date(`${dateStr}T${minutesToTime(serviceEndMin)}:00${tzOffset}`).toISOString()
            });
          }
        }
      }
    }
  }

  return slots;
}

module.exports = { getAvailableSlots, getAvailableSlotsMulti };
