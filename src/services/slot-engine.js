const { queryWithRLS } = require('./db');
const { getBusyBlocks } = require('./calendar-sync');
const {
  timeToMinutes, minutesToTime, intersectWindows,
  getAbsencePeriod, restrictWindowsForAbsence,
  brusselsOffset, nextDateStr, dateToWeekday
} = require('./schedule-helpers');
const { computeOptimalGranularity, rankSlots } = require('./slot-optimizer');

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
  if (bizResult.rows.length === 0) throw Object.assign(new Error('Salon introuvable'), { type: 'not_found' });

  const settings = bizResult.rows[0].settings;
  // SVC-V11-9: Guard against zero/negative granularity (would cause infinite loop)
  let granularity;
  if (settings.slot_auto_optimize !== false) {
    if (settings.optimized_granularity) {
      granularity = Math.max(settings.optimized_granularity, 5);
    } else {
      const allSvcDur = await queryWithRLS(businessId,
        `SELECT duration_min FROM services WHERE business_id = $1 AND is_active = true`,
        [businessId]
      );
      granularity = computeOptimalGranularity(allSvcDur.rows.map(r => r.duration_min));
    }
  } else {
    granularity = Math.max(parseInt(settings.slot_increment_min ?? settings.slot_granularity_min, 10) || 15, 5);
  }

  // 2. Fetch service details
  const svcResult = await queryWithRLS(businessId,
    `SELECT id, duration_min, buffer_before_min, buffer_after_min, mode_options, available_schedule, min_booking_notice_hours, quote_only
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
    from: new Date(r.date_from).toLocaleDateString('en-CA', { timeZone: 'Europe/Brussels' }),
    to: new Date(r.date_to).toLocaleDateString('en-CA', { timeZone: 'Europe/Brussels' })
  }));

  // 5d. Fetch business holidays in date range
  const bizHolidayResult = await queryWithRLS(businessId,
    `SELECT date FROM business_holidays
     WHERE business_id = $1 AND date >= $2::date AND date <= $3::date`,
    [businessId, dateFrom, dateTo]
  );
  const bizHolidaySet = new Set(bizHolidayResult.rows.map(r =>
    new Date(r.date).toLocaleDateString('en-CA', { timeZone: 'Europe/Brussels' })
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

  // 6a. Fetch internal tasks (lunch, admin blocks, etc.) — they block slots like bookings
  const tasksResult = await queryWithRLS(businessId,
    `SELECT practitioner_id, start_at, end_at FROM internal_tasks
     WHERE business_id = $1 AND practitioner_id = ANY($2) AND status = 'planned'
     AND end_at > ($3::date AT TIME ZONE 'Europe/Brussels')
     AND start_at <= (($4::date + INTERVAL '1 day') AT TIME ZONE 'Europe/Brussels')`,
    [businessId, practitionerIds, dateFrom, dateTo]
  );
  for (const row of tasksResult.rows) {
    const dateStr = row.start_at.toLocaleDateString('en-CA', { timeZone: 'Europe/Brussels' });
    const key = `${row.practitioner_id}-${dateStr}`;
    if (!bookingMap[key]) bookingMap[key] = [];
    bookingMap[key].push({ start: row.start_at, end: row.end_at, buffer_before_min: 0, buffer_after_min: 0 });
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

  for (let dateStr = dateFrom; dateStr <= dateTo; dateStr = nextDateStr(dateStr)) {
    const weekday = dateToWeekday(dateStr);
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

          // Check if slot is in the past or within min booking notice
          const minNoticeMs = (service.min_booking_notice_hours || 0) * 3600000;
          if (slotStart <= new Date(now.getTime() + minNoticeMs)) continue;

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

  // Smart ranking: score slots by gap-filling potential
  if (settings.slot_auto_optimize !== false) {
    rankSlots(slots, bookingMap);
  }

  return slots;
}

// ===== Helpers imported from schedule-helpers.js =====

/**
 * MULTI-SERVICE SLOT ENGINE
 *
 * Calculates available time slots for chained multi-service bookings.
 * Same algorithm as getAvailableSlots, but totalDuration is the chained
 * sum of all services with buffer_before from first and buffer_after from last only.
 */
async function getAvailableSlotsMulti({ businessId, serviceIds, practitionerId, dateFrom, dateTo, appointmentMode, variantIds }) {
  // Allow duplicate serviceIds (e.g. same service booked twice)
  if (!Array.isArray(serviceIds)) {
    throw Object.assign(new Error('Au moins 2 prestations requises'), { type: 'validation' });
  }
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
  if (bizResult.rows.length === 0) throw Object.assign(new Error('Salon introuvable'), { type: 'not_found' });

  const settings = bizResult.rows[0].settings;
  let granularity;
  if (settings.slot_auto_optimize !== false) {
    if (settings.optimized_granularity) {
      granularity = Math.max(settings.optimized_granularity, 5);
    } else {
      const allSvcDur = await queryWithRLS(businessId,
        `SELECT duration_min FROM services WHERE business_id = $1 AND is_active = true`,
        [businessId]
      );
      granularity = computeOptimalGranularity(allSvcDur.rows.map(r => r.duration_min));
    }
  } else {
    granularity = Math.max(parseInt(settings.slot_increment_min ?? settings.slot_granularity_min, 10) || 15, 5);
  }

  // 2. Fetch all unique services in one query, then expand to match serviceIds order (supports duplicates)
  const uniqueServiceIds = [...new Set(serviceIds)];
  const svcResult = await queryWithRLS(businessId,
    `SELECT id, duration_min, buffer_before_min, buffer_after_min, mode_options, available_schedule, min_booking_notice_hours, quote_only
     FROM services WHERE id = ANY($1) AND business_id = $2 AND is_active = true`,
    [uniqueServiceIds, businessId]
  );

  // Validate all unique services found
  if (svcResult.rows.length !== uniqueServiceIds.length) {
    const foundIds = new Set(svcResult.rows.map(r => r.id));
    const missing = uniqueServiceIds.filter(id => !foundIds.has(id));
    throw Object.assign(new Error(`Prestation(s) introuvable(s): ${missing.join(', ')}`), { type: 'not_found' });
  }
  // Build a lookup and expand to match serviceIds order (duplicates get independent copies)
  const svcLookup = Object.fromEntries(svcResult.rows.map(r => [r.id, r]));
  const services = serviceIds.map(id => ({ ...svcLookup[id] }));

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

  // 2b. Sort services: morning-restricted first, unrestricted middle, afternoon-restricted last.
  // This maximizes the chance each restricted service falls within its allowed window.
  function _restrictionWeight(svc) {
    if (svc.available_schedule?.type !== 'restricted') return 50; // middle
    const wins = svc.available_schedule.windows || [];
    if (wins.length === 0) return 50;
    // Average start time across all windows — lower = morning, higher = afternoon
    const avgStart = wins.reduce((sum, w) => sum + timeToMinutes(w.from), 0) / wins.length;
    return avgStart < 720 ? 0 : 100; // before noon → front, after noon → back
  }
  // Store original index before sorting so we can restore order in the response
  services.forEach((s, i) => { s._originalIndex = i; });
  services.sort((a, b) => _restrictionWeight(a) - _restrictionWeight(b));

  // 3. Calculate chained duration: buffer_before from FIRST, intermediate buffers (max of adjacent), buffer_after from LAST
  const sumDurations = services.reduce((sum, s) => sum + s.duration_min, 0);
  const bufferBefore = services[0].buffer_before_min || 0;
  const bufferAfter = services[services.length - 1].buffer_after_min || 0;
  let intermediateBuffers = 0;
  for (let i = 0; i < services.length - 1; i++) {
    intermediateBuffers += Math.max(services[i].buffer_after_min || 0, services[i + 1].buffer_before_min || 0);
  }
  const totalDuration = bufferBefore + sumDurations + intermediateBuffers + bufferAfter;

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
      [serviceIds, practitionerId, businessId, uniqueServiceIds.length]
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
      [serviceIds, businessId, uniqueServiceIds.length]
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

  // Internal tasks block slots like bookings
  {
    const taskRes = await queryWithRLS(businessId,
      `SELECT practitioner_id, start_at, end_at FROM internal_tasks
       WHERE business_id = $1 AND practitioner_id = ANY($2) AND status = 'planned'
       AND end_at > ($3::date AT TIME ZONE 'Europe/Brussels')
       AND start_at <= (($4::date + INTERVAL '1 day') AT TIME ZONE 'Europe/Brussels')`,
      [businessId, practitionerIds, dateFrom, dateTo]
    );
    for (const row of taskRes.rows) {
      const dateStr = row.start_at.toLocaleDateString('en-CA', { timeZone: 'Europe/Brussels' });
      const key = `${row.practitioner_id}-${dateStr}`;
      if (!bookingMap[key]) bookingMap[key] = [];
      bookingMap[key].push({ start: row.start_at, end: row.end_at, buffer_before_min: 0, buffer_after_min: 0 });
    }
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
    from: new Date(r.date_from).toLocaleDateString('en-CA', { timeZone: 'Europe/Brussels' }),
    to: new Date(r.date_to).toLocaleDateString('en-CA', { timeZone: 'Europe/Brussels' })
  }));

  const bizHolidayResult2 = await queryWithRLS(businessId,
    `SELECT date FROM business_holidays
     WHERE business_id = $1 AND date >= $2::date AND date <= $3::date`,
    [businessId, dateFrom, dateTo]
  );
  const bizHolidaySet2 = new Set(bizHolidayResult2.rows.map(r =>
    new Date(r.date).toLocaleDateString('en-CA', { timeZone: 'Europe/Brussels' })
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

  for (let dateStr = dateFrom; dateStr <= dateTo; dateStr = nextDateStr(dateStr)) {
    const weekday = dateToWeekday(dateStr);
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

      // Pre-calculate each service's offset within the chain (for per-service restriction checks)
      const hasRestrictions = services.some(s => s.available_schedule?.type === 'restricted');
      let serviceChainOffsets;
      if (hasRestrictions) {
        serviceChainOffsets = [];
        let chainCursor = bufferBefore;
        for (const svc of services) {
          serviceChainOffsets.push({ offset: chainCursor, duration: svc.duration_min });
          chainCursor += svc.duration_min;
        }
      }

      const bkKey = `${pracId}-${dateStr}`;
      const dayBookings = bookingMap[bkKey] || [];

      for (const window of windows) {
        const windowStart = timeToMinutes(window.start);
        const windowEnd = timeToMinutes(window.end);

        for (let startMin = windowStart; startMin + totalDuration <= windowEnd; startMin += granularity) {
          const slotStart = new Date(`${dateStr}T${minutesToTime(startMin)}:00${tzOffset}`);
          const slotEnd = new Date(slotStart.getTime() + totalDuration * 60000);

          // Check past + max notice across all services
          const maxNoticeMs = Math.max(...services.map(s => (s.min_booking_notice_hours || 0) * 3600000));
          if (slotStart <= new Date(now.getTime() + maxNoticeMs)) continue;

          // Per-service restriction check: each restricted service's actual time slice
          // must fall within its allowed windows (not the entire group)
          if (hasRestrictions) {
            let restrictionOk = true;
            for (let si = 0; si < services.length; si++) {
              const svc = services[si];
              if (svc.available_schedule?.type !== 'restricted') continue;
              const svcStartMin = startMin + serviceChainOffsets[si].offset;
              const svcEndMin = svcStartMin + serviceChainOffsets[si].duration;
              const svcWindows = (svc.available_schedule.windows || []).filter(w => w.day === weekday);
              if (svcWindows.length === 0) { restrictionOk = false; break; }
              const fits = svcWindows.some(w => svcStartMin >= timeToMinutes(w.from) && svcEndMin <= timeToMinutes(w.to));
              if (!fits) { restrictionOk = false; break; }
            }
            if (!restrictionOk) continue;
          }

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

  // Smart ranking: score slots by gap-filling potential
  if (settings.slot_auto_optimize !== false) {
    rankSlots(slots, bookingMap);
  }

  return slots;
}

/**
 * MULTI-PRACTITIONER SPLIT SLOT ENGINE
 *
 * Calculates available time slots for chained multi-service bookings
 * where different practitioners handle different services.
 * Falls back from getAvailableSlotsMulti when no single practitioner
 * offers all selected services.
 *
 * Key difference from getAvailableSlotsMulti:
 * - Each service can be assigned to a different practitioner
 * - For each candidate time, checks per-service practitioner availability
 * - Returns slots with practitioners[] array instead of single practitioner_id
 */
async function getAvailableSlotsMultiPractitioner({ businessId, serviceIds, dateFrom, dateTo, appointmentMode, variantIds }) {
  // Validation (same as getAvailableSlotsMulti)
  if (!Array.isArray(serviceIds)) {
    throw Object.assign(new Error('Au moins 2 prestations requises'), { type: 'validation' });
  }
  // Allow duplicate serviceIds (e.g. same service booked twice)
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
  const uniqueServiceIds = [...new Set(serviceIds)];

  // 1. Fetch business settings
  const bizResult = await queryWithRLS(businessId,
    `SELECT settings FROM businesses WHERE id = $1 AND is_active = true`,
    [businessId]
  );
  if (bizResult.rows.length === 0) throw Object.assign(new Error('Salon introuvable'), { type: 'not_found' });

  const settings = bizResult.rows[0].settings;
  let granularity;
  if (settings.slot_auto_optimize !== false) {
    if (settings.optimized_granularity) {
      granularity = Math.max(settings.optimized_granularity, 5);
    } else {
      const allSvcDur = await queryWithRLS(businessId,
        `SELECT duration_min FROM services WHERE business_id = $1 AND is_active = true`,
        [businessId]
      );
      granularity = computeOptimalGranularity(allSvcDur.rows.map(r => r.duration_min));
    }
  } else {
    granularity = Math.max(parseInt(settings.slot_increment_min ?? settings.slot_granularity_min, 10) || 15, 5);
  }

  // 2. Fetch all unique services in one query, then expand to match serviceIds order (supports duplicates)
  const svcResult = await queryWithRLS(businessId,
    `SELECT id, duration_min, buffer_before_min, buffer_after_min, mode_options, available_schedule, min_booking_notice_hours, quote_only
     FROM services WHERE id = ANY($1) AND business_id = $2 AND is_active = true`,
    [uniqueServiceIds, businessId]
  );
  if (svcResult.rows.length !== uniqueServiceIds.length) {
    const foundIds = new Set(svcResult.rows.map(r => r.id));
    const missing = uniqueServiceIds.filter(id => !foundIds.has(id));
    throw Object.assign(new Error(`Prestation(s) introuvable(s): ${missing.join(', ')}`), { type: 'not_found' });
  }
  // Build a lookup and expand to match serviceIds order (duplicates get independent copies)
  const svcLookup = Object.fromEntries(svcResult.rows.map(r => [r.id, r]));
  const services = serviceIds.map(id => ({ ...svcLookup[id] }));

  // Override durations from variants
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

  // Sort services by restriction weight (morning-restricted first, afternoon last)
  function _restrictionWeight(svc) {
    if (svc.available_schedule?.type !== 'restricted') return 50;
    const wins = svc.available_schedule.windows || [];
    if (wins.length === 0) return 50;
    const avgStart = wins.reduce((sum, w) => sum + timeToMinutes(w.from), 0) / wins.length;
    return avgStart < 720 ? 0 : 100;
  }
  // Store original index before sorting (for split-mode response ordering)
  services.forEach((s, i) => { s._originalIndex = i; });
  services.sort((a, b) => _restrictionWeight(a) - _restrictionWeight(b));

  // Calculate chained duration (with intermediate buffers between consecutive services)
  const sumDurations = services.reduce((sum, s) => sum + s.duration_min, 0);
  const bufferBefore = services[0].buffer_before_min || 0;
  const bufferAfter = services[services.length - 1].buffer_after_min || 0;
  let intermediateBuffers = 0;
  for (let i = 0; i < services.length - 1; i++) {
    intermediateBuffers += Math.max(services[i].buffer_after_min || 0, services[i + 1].buffer_before_min || 0);
  }
  const totalDuration = bufferBefore + sumDurations + intermediateBuffers + bufferAfter;

  if (!totalDuration || totalDuration <= 0) {
    throw Object.assign(new Error(`Durée totale invalide (${totalDuration} min)`), { type: 'validation' });
  }

  // Mode validation
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

  // 3. Find practitioners PER SERVICE (not intersection)
  // Build a map: serviceId → [{practitioner_id, max_concurrent, sort_order}]
  const perServicePracs = {};
  const allPracIds = new Set();
  const capacityMap = {};

  for (const svc of services) {
    const psResult = await queryWithRLS(businessId,
      `SELECT ps.practitioner_id, COALESCE(p.max_concurrent, 1) AS max_concurrent, p.sort_order
       FROM practitioner_services ps
       JOIN practitioners p ON p.id = ps.practitioner_id
       WHERE ps.service_id = $1 AND p.business_id = $2
       AND p.is_active = true AND p.booking_enabled = true
       ORDER BY p.sort_order`,
      [svc.id, businessId]
    );
    if (psResult.rows.length === 0) return []; // No practitioner for this service → no slots possible
    perServicePracs[svc.id] = psResult.rows.map(r => r.practitioner_id);
    for (const r of psResult.rows) {
      allPracIds.add(r.practitioner_id);
      capacityMap[r.practitioner_id] = r.max_concurrent;
    }
  }

  const practitionerIds = [...allPracIds];

  // 4. Fetch availabilities, exceptions, bookings, busy blocks for ALL practitioners (union)
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

  // Internal tasks block slots like bookings
  {
    const taskRes = await queryWithRLS(businessId,
      `SELECT practitioner_id, start_at, end_at FROM internal_tasks
       WHERE business_id = $1 AND practitioner_id = ANY($2) AND status = 'planned'
       AND end_at > ($3::date AT TIME ZONE 'Europe/Brussels')
       AND start_at <= (($4::date + INTERVAL '1 day') AT TIME ZONE 'Europe/Brussels')`,
      [businessId, practitionerIds, dateFrom, dateTo]
    );
    for (const row of taskRes.rows) {
      const dateStr = row.start_at.toLocaleDateString('en-CA', { timeZone: 'Europe/Brussels' });
      const key = `${row.practitioner_id}-${dateStr}`;
      if (!bookingMap[key]) bookingMap[key] = [];
      bookingMap[key].push({ start: row.start_at, end: row.end_at, buffer_before_min: 0, buffer_after_min: 0 });
    }
  }

  // Business schedule, closures, holidays
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

  const bizClosureResult = await queryWithRLS(businessId,
    `SELECT date_from, date_to FROM business_closures
     WHERE business_id = $1 AND date_to >= $2::date AND date_from <= $3::date`,
    [businessId, dateFrom, dateTo]
  );
  const bizClosures = bizClosureResult.rows.map(r => ({
    from: new Date(r.date_from).toLocaleDateString('en-CA', { timeZone: 'Europe/Brussels' }),
    to: new Date(r.date_to).toLocaleDateString('en-CA', { timeZone: 'Europe/Brussels' })
  }));

  const bizHolidayResult = await queryWithRLS(businessId,
    `SELECT date FROM business_holidays
     WHERE business_id = $1 AND date >= $2::date AND date <= $3::date`,
    [businessId, dateFrom, dateTo]
  );
  const bizHolidaySet = new Set(bizHolidayResult.rows.map(r =>
    new Date(r.date).toLocaleDateString('en-CA', { timeZone: 'Europe/Brussels' })
  ));

  // Staff absences
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

  // 5. Pre-compute per-practitioner per-date availability windows
  // Build a resolved windows map: { "pracId-dateStr" → [windows] | null (unavailable) }
  function getPracWindows(pracId, dateStr, weekday) {
    const absencePeriod = getAbsencePeriod(absenceMap[pracId], dateStr);
    if (absencePeriod === 'full') return null;

    const exKey = `${pracId}-${dateStr}`;
    const exceptions = exceptionMap[exKey];

    let windows;
    if (exceptions) {
      if (exceptions.some(ex => ex.type === 'closed')) return null;
      const customWindows = exceptions.filter(ex => ex.type === 'custom_hours');
      if (customWindows.length > 0) {
        windows = customWindows.map(ex => ({ start: ex.start_time, end: ex.end_time }));
      } else {
        const avKey = `${pracId}-${weekday}`;
        windows = availMap[avKey];
        if (!windows || windows.length === 0) return null;
      }
    } else {
      const avKey = `${pracId}-${weekday}`;
      windows = availMap[avKey];
      if (!windows || windows.length === 0) return null;
    }

    if (absencePeriod === 'am' || absencePeriod === 'pm') {
      windows = restrictWindowsForAbsence(windows, absencePeriod);
      if (windows.length === 0) return null;
    }

    return windows;
  }

  // Helper: check if a practitioner is available for a specific time range on a date
  function isPracAvailable(pracId, dateStr, svcStartMin, svcEndMin, pracWindows, tzOffset) {
    // Check the time falls within at least one availability window
    const fitsWindow = pracWindows.some(w => {
      const wStart = timeToMinutes(w.start);
      const wEnd = timeToMinutes(w.end);
      return svcStartMin >= wStart && svcEndMin <= wEnd;
    });
    if (!fitsWindow) return false;

    // Check no booking conflicts
    const bkKey = `${pracId}-${dateStr}`;
    const dayBookings = bookingMap[bkKey] || [];
    const svcStart = new Date(`${dateStr}T${minutesToTime(svcStartMin)}:00${tzOffset}`);
    const svcEnd = new Date(`${dateStr}T${minutesToTime(svcEndMin)}:00${tzOffset}`);

    const overlapCount = dayBookings.filter(bk => {
      const bkStart = new Date(bk.start.getTime() - (bk.buffer_before_min || 0) * 60000);
      const bkEnd = new Date(bk.end.getTime() + (bk.buffer_after_min || 0) * 60000);
      return svcStart < bkEnd && svcEnd > bkStart;
    }).length;

    return overlapCount < (capacityMap[pracId] || 1);
  }

  // 6. Generate slots — per-service practitioner assignment
  const now = new Date();
  const slots = [];

  for (let dateStr = dateFrom; dateStr <= dateTo; dateStr = nextDateStr(dateStr)) {
    const weekday = dateToWeekday(dateStr);
    const tzOffset = brusselsOffset(dateStr);

    // Skip business holidays / closures
    if (bizHolidaySet.has(dateStr)) continue;
    if (bizClosures.some(c => dateStr >= c.from && dateStr <= c.to)) continue;

    const bizWindows = bizScheduleMap[weekday];
    if (hasBizSchedule && (!bizWindows || bizWindows.length === 0)) continue;

    // Pre-compute practitioner windows for this date
    const pracWindowsCache = {};
    for (const pracId of practitionerIds) {
      let windows = getPracWindows(pracId, dateStr, weekday);
      if (windows && hasBizSchedule && bizWindows && bizWindows.length > 0) {
        windows = intersectWindows(windows, bizWindows);
        if (windows.length === 0) windows = null;
      }
      pracWindowsCache[pracId] = windows; // null = unavailable
    }

    // Find the broadest possible time range across all practitioners for outer loop
    let dayStartMin = 1440, dayEndMin = 0;
    for (const pracId of practitionerIds) {
      const w = pracWindowsCache[pracId];
      if (!w) continue;
      for (const win of w) {
        const s = timeToMinutes(win.start), e = timeToMinutes(win.end);
        if (s < dayStartMin) dayStartMin = s;
        if (e > dayEndMin) dayEndMin = e;
      }
    }
    if (dayStartMin >= dayEndMin) continue;

    // Pre-compute service chain offsets and restriction data
    const hasRestrictions = services.some(s => s.available_schedule?.type === 'restricted');

    for (let startMin = dayStartMin; startMin + totalDuration <= dayEndMin; startMin += granularity) {
      // Check past + max notice
      const slotStart = new Date(`${dateStr}T${minutesToTime(startMin + bufferBefore)}:00${tzOffset}`);
      const maxNoticeMs = Math.max(...services.map(s => (s.min_booking_notice_hours || 0) * 3600000));
      if (slotStart <= new Date(now.getTime() + maxNoticeMs)) continue;

      // Try to assign a practitioner for each service in the chain
      let cursor = startMin + bufferBefore; // after first buffer
      let valid = true;
      const assignments = []; // [{service_id, practitioner_id, start_min, end_min}]
      const usedPracSlots = {}; // track per-prac usage to handle same-prac for multiple services

      for (let si = 0; si < services.length; si++) {
        const svc = services[si];
        const svcStartMin = cursor;
        const svcEndMin = cursor + svc.duration_min;

        // Per-service restriction check
        if (hasRestrictions && svc.available_schedule?.type === 'restricted') {
          const svcWindows = (svc.available_schedule.windows || []).filter(w => w.day === weekday);
          if (svcWindows.length === 0) { valid = false; break; }
          const fits = svcWindows.some(w => svcStartMin >= timeToMinutes(w.from) && svcEndMin <= timeToMinutes(w.to));
          if (!fits) { valid = false; break; }
        }

        // Find an available practitioner for this service
        const candidates = perServicePracs[svc.id];
        let assignedPrac = null;

        // Prefer reusing a practitioner already assigned to a previous service (minimize handoffs)
        const assignedPracIds = assignments.map(a => a.practitioner_id);
        const sortedCandidates = [...candidates].sort((a, b) => {
          const aUsed = assignedPracIds.includes(a) ? 0 : 1;
          const bUsed = assignedPracIds.includes(b) ? 0 : 1;
          return aUsed - bUsed;
        });

        for (const pracId of sortedCandidates) {
          const windows = pracWindowsCache[pracId];
          if (!windows) continue;

          // For the first service, include bufferBefore in the window check
          const checkStart = (si === 0) ? startMin : svcStartMin;
          // For the last service, include bufferAfter in the window check
          const checkEnd = (si === services.length - 1) ? svcEndMin + bufferAfter : svcEndMin;

          if (isPracAvailable(pracId, dateStr, checkStart, checkEnd, windows, tzOffset)) {
            // Also check this prac isn't double-booked by our own assignments
            // (if same prac assigned to service 0 at 14:00-14:30 and service 1 at 14:30-15:00, that's OK - sequential)
            // But if overlapping, it's not OK
            const selfConflict = assignments.some(a => {
              if (a.practitioner_id !== pracId) return false;
              return svcStartMin < a.end_min && svcEndMin > a.start_min;
            });
            if (!selfConflict) {
              assignedPrac = pracId;
              break;
            }
          }
        }

        if (!assignedPrac) { valid = false; break; }

        assignments.push({
          service_id: svc.id,
          practitioner_id: assignedPrac,
          start_min: svcStartMin,
          end_min: svcEndMin
        });
        // Advance cursor past service duration + intermediate buffer to next service
        if (si < services.length - 1) {
          const interBuf = Math.max(svc.buffer_after_min || 0, services[si + 1].buffer_before_min || 0);
          cursor = svcEndMin + interBuf;
        } else {
          cursor = svcEndMin;
        }
      }

      if (!valid) continue;

      // Build the slot
      const serviceStartMin = startMin + bufferBefore;
      const serviceEndMin = serviceStartMin + sumDurations;
      const isSplit = new Set(assignments.map(a => a.practitioner_id)).size > 1;

      slots.push({
        date: dateStr,
        start_time: minutesToTime(serviceStartMin),
        end_time: minutesToTime(serviceEndMin),
        start_at: new Date(`${dateStr}T${minutesToTime(serviceStartMin)}:00${tzOffset}`).toISOString(),
        end_at: new Date(`${dateStr}T${minutesToTime(serviceEndMin)}:00${tzOffset}`).toISOString(),
        split: isSplit,
        practitioner_id: isSplit ? assignments[0].practitioner_id : assignments[0].practitioner_id,
        practitioners: assignments
          .map((a, i) => ({ ...a, _originalIndex: services[i]._originalIndex }))
          .sort((a, b) => a._originalIndex - b._originalIndex)
          .map(a => ({
            service_id: a.service_id,
            practitioner_id: a.practitioner_id,
            start_at: new Date(`${dateStr}T${minutesToTime(a.start_min)}:00${tzOffset}`).toISOString(),
            end_at: new Date(`${dateStr}T${minutesToTime(a.end_min)}:00${tzOffset}`).toISOString()
          }))
      });
    }
  }

  // Smart ranking
  if (settings.slot_auto_optimize !== false) {
    rankSlots(slots, bookingMap);
  }

  return slots;
}

module.exports = { getAvailableSlots, getAvailableSlotsMulti, getAvailableSlotsMultiPractitioner };
