const router = require('express').Router();
const { queryWithRLS, transactionWithRLS } = require('../../services/db');
const { requireAuth, requireOwner } = require('../../middleware/auth');
const { sendEmail, buildEmailHTML, escHtml } = require('../../services/email');
const { sendSMS } = require('../../services/sms');
const { checkPracAvailability, calSyncPush } = require('./bookings-helpers');

router.use(requireAuth);

// ============================================================
// Helpers
// ============================================================

async function logAbsence(bid, absenceId, action, details, actorName) {
  try {
    await queryWithRLS(bid,
      `INSERT INTO absence_logs (business_id, absence_id, action, details, actor_name)
       VALUES ($1, $2, $3, $4, $5)`,
      [bid, absenceId, action, details ? JSON.stringify(details) : null, actorName || null]
    );
  } catch (e) {
    console.error('[PLANNING] Log error:', e.message);
  }
}

/**
 * Get the effective period for a specific day within an absence.
 * - First day → period (period_start)
 * - Last day → period_end
 * - Middle days → 'full'
 * - Single day → period
 */
function getEffectivePeriod(dayDate, absDateFrom, absDateTo, periodStart, periodEnd) {
  const dayStr = dayDate.toLocaleDateString('en-CA', { timeZone: 'Europe/Brussels' });
  const fromStr = new Date(absDateFrom).toLocaleDateString('en-CA', { timeZone: 'Europe/Brussels' });
  const toStr = new Date(absDateTo).toLocaleDateString('en-CA', { timeZone: 'Europe/Brussels' });
  if (fromStr === toStr) return periodStart || 'full';
  if (dayStr === fromStr) return periodStart || 'full';
  if (dayStr === toStr) return periodEnd || 'full';
  return 'full';
}

/** Check if two periods conflict (both occupy the same half of the day) */
function periodsConflict(p1, p2) {
  if (p1 === 'full' || p2 === 'full') return true;
  return p1 === p2; // am+am or pm+pm conflict; am+pm don't
}

/**
 * Convert JS Date.getDay() (0=Sun) to availabilities weekday (0=Mon).
 * Formula: (jsGetDay + 6) % 7
 */
function toAvailWeekday(jsDate) {
  return (jsDate.getDay() + 6) % 7;
}

/**
 * Check if a date is a working day for a practitioner.
 * @param {Date} date
 * @param {Set<number>|null} workDays — Set of avail weekdays (0=Mon..6=Sun). Null = all days are workdays.
 * @param {Set<string>|null} holidayDates — Set of 'YYYY-MM-DD' strings for holidays.
 */
function isWorkDay(date, workDays, holidayDates) {
  // Check holidays first
  if (holidayDates) {
    const ds = date.toLocaleDateString('en-CA', { timeZone: 'Europe/Brussels' });
    if (holidayDates.has(ds)) return false;
  }
  // If no workDays data, fallback: all days are workdays
  if (!workDays || workDays.size === 0) return true;
  return workDays.has(toAvailWeekday(date));
}

/**
 * Fetch working days for a set of practitioners.
 * Returns Map<pracId, Set<weekday>> where weekday is avail format (0=Mon).
 */
async function getPractitionerWorkDays(bid, practitionerIds) {
  if (!practitionerIds || practitionerIds.length === 0) return new Map();
  const result = await queryWithRLS(bid,
    `SELECT DISTINCT practitioner_id, weekday
     FROM availabilities
     WHERE business_id = $1 AND is_active = true
       AND practitioner_id = ANY($2::uuid[])`,
    [bid, practitionerIds]
  );
  const map = new Map();
  result.rows.forEach(r => {
    if (!map.has(r.practitioner_id)) map.set(r.practitioner_id, new Set());
    map.get(r.practitioner_id).add(r.weekday);
  });
  return map;
}

/**
 * Fetch business holidays for a date range.
 * Returns Set of 'YYYY-MM-DD' strings + array of { date, name }.
 */
async function getHolidays(bid, dateFrom, dateTo) {
  try {
    const result = await queryWithRLS(bid,
      `SELECT date, name FROM business_holidays
       WHERE business_id = $1 AND date >= $2::date AND date <= $3::date
       ORDER BY date`,
      [bid, dateFrom, dateTo]
    );
    const dateSet = new Set();
    const list = [];
    result.rows.forEach(r => {
      const ds = new Date(r.date).toLocaleDateString('en-CA', { timeZone: 'Europe/Brussels' });
      dateSet.add(ds);
      list.push({ date: ds, name: r.name });
    });
    return { dateSet, list };
  } catch (e) {
    // Table might not exist yet — graceful fallback
    return { dateSet: new Set(), list: [] };
  }
}

/**
 * Day-by-day overlap check with period awareness.
 * Skips non-working days and holidays. Excludes an optional absenceId (for edit mode).
 * Returns true if there's a conflict.
 */
function hasOverlapConflict(existingAbsences, newFrom, newTo, newPeriod, newPeriodEnd, excludeId, workDays, holidayDates) {
  const from = new Date(newFrom);
  const to = new Date(newTo);

  for (let d = new Date(from); d <= to; d.setDate(d.getDate() + 1)) {
    if (!isWorkDay(d, workDays, holidayDates)) continue;

    const newDayPeriod = getEffectivePeriod(d, newFrom, newTo, newPeriod, newPeriodEnd);

    for (const existing of existingAbsences) {
      if (excludeId && existing.id === excludeId) continue;
      const exFrom = new Date(existing.date_from);
      const exTo = new Date(existing.date_to);

      if (d >= exFrom && d <= exTo) {
        const exDayPeriod = getEffectivePeriod(d, existing.date_from, existing.date_to, existing.period, existing.period_end);
        if (periodsConflict(newDayPeriod, exDayPeriod)) {
          return true;
        }
      }
    }
  }
  return false;
}

/** Shift a date string (YYYY-MM-DD) by N days */
function shiftDate(dateStr, days) {
  const d = new Date(dateStr + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toLocaleDateString('en-CA', { timeZone: 'Europe/Brussels' });
}

/** String-based effective period (same logic as getEffectivePeriod but pure strings) */
function effectivePeriodStr(dateStr, fromStr, toStr, period, periodEnd) {
  if (fromStr === toStr) return period || 'full';
  if (dateStr === fromStr) return period || 'full';
  if (dateStr === toStr) return periodEnd || 'full';
  return 'full';
}

/**
 * Auto-split existing absences to make room for a new one.
 * Instead of rejecting overlaps with 409, we split existing absences around the new one.
 *
 * Example: existing congé Mon→Fri + new formation Wed→Wed
 *        → congé Mon→Tue + formation Wed + congé Thu→Fri
 *
 * Handles half-day leftovers: if new is AM-only on a day where existing is full,
 * the PM half is preserved as a single-day leftover.
 *
 * @returns {number} Number of existing absences that were split
 */
async function splitOverlappingAbsences(bid, pracId, newFrom, newTo, newPeriod, newPeriodEnd, excludeId, actorName) {
  const existing = await queryWithRLS(bid,
    `SELECT id, date_from, date_to, type, note, period, period_end FROM staff_absences
     WHERE business_id = $1 AND practitioner_id = $2
     AND date_from <= $4::date AND date_to >= $3::date`,
    [bid, pracId, newFrom, newTo]
  );

  // Pre-compute which absences have conflicts (pure logic, no DB)
  const toProcess = [];
  for (const abs of existing.rows) {
    if (excludeId && abs.id === excludeId) continue;
    const exFrom = new Date(abs.date_from).toLocaleDateString('en-CA', { timeZone: 'Europe/Brussels' });
    const exTo = new Date(abs.date_to).toLocaleDateString('en-CA', { timeZone: 'Europe/Brussels' });
    const overlapStart = exFrom > newFrom ? exFrom : newFrom;
    const overlapEnd = exTo < newTo ? exTo : newTo;

    let hasConflict = false;
    for (let d = new Date(overlapStart + 'T12:00:00Z');
         d.toLocaleDateString('en-CA', { timeZone: 'Europe/Brussels' }) <= overlapEnd;
         d.setUTCDate(d.getUTCDate() + 1)) {
      const ds = d.toLocaleDateString('en-CA', { timeZone: 'Europe/Brussels' });
      const exP = effectivePeriodStr(ds, exFrom, exTo, abs.period, abs.period_end);
      const newP = effectivePeriodStr(ds, newFrom, newTo, newPeriod, newPeriodEnd);
      if (periodsConflict(exP, newP)) { hasConflict = true; break; }
    }
    if (hasConflict) toProcess.push({ abs, exFrom, exTo, overlapStart, overlapEnd });
  }

  if (toProcess.length === 0) return 0;

  // Atomic: all splits + deletes in one transaction
  return await transactionWithRLS(bid, async (txClient) => {
    let splitCount = 0;
    for (const { abs, exFrom, exTo, overlapStart, overlapEnd } of toProcess) {
      // Before leftover
      const dayBefore = shiftDate(overlapStart, -1);
      if (exFrom <= dayBefore) {
        await txClient.query(
          `INSERT INTO staff_absences (business_id, practitioner_id, date_from, date_to, type, note, period, period_end)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [bid, pracId, exFrom, dayBefore, abs.type, abs.note, abs.period || 'full', 'full']
        );
      }
      // After leftover
      const dayAfter = shiftDate(overlapEnd, 1);
      if (dayAfter <= exTo) {
        await txClient.query(
          `INSERT INTO staff_absences (business_id, practitioner_id, date_from, date_to, type, note, period, period_end)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [bid, pracId, dayAfter, exTo, abs.type, abs.note, 'full', abs.period_end || 'full']
        );
      }
      // Half-day leftovers
      const exPStart = effectivePeriodStr(overlapStart, exFrom, exTo, abs.period, abs.period_end);
      const newPStart = effectivePeriodStr(overlapStart, newFrom, newTo, newPeriod, newPeriodEnd);
      if (exPStart === 'full' && (newPStart === 'am' || newPStart === 'pm')) {
        const keep = newPStart === 'am' ? 'pm' : 'am';
        await txClient.query(
          `INSERT INTO staff_absences (business_id, practitioner_id, date_from, date_to, type, note, period, period_end)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [bid, pracId, overlapStart, overlapStart, abs.type, abs.note, keep, keep]
        );
      }
      if (overlapEnd !== overlapStart) {
        const exPEnd = effectivePeriodStr(overlapEnd, exFrom, exTo, abs.period, abs.period_end);
        const newPEnd = effectivePeriodStr(overlapEnd, newFrom, newTo, newPeriod, newPeriodEnd);
        if (exPEnd === 'full' && (newPEnd === 'am' || newPEnd === 'pm')) {
          const keep = newPEnd === 'am' ? 'pm' : 'am';
          await txClient.query(
            `INSERT INTO staff_absences (business_id, practitioner_id, date_from, date_to, type, note, period, period_end)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
            [bid, pracId, overlapEnd, overlapEnd, abs.type, abs.note, keep, keep]
          );
        }
      }
      // Log and delete the original
      await logAbsence(bid, abs.id, 'auto_split', {
        reason: 'Découpé automatiquement pour nouvelle absence',
        original: { date_from: exFrom, date_to: exTo, type: abs.type, period: abs.period, period_end: abs.period_end },
        new_absence: { date_from: newFrom, date_to: newTo }
      }, actorName);
      await txClient.query(
        `DELETE FROM staff_absences WHERE id = $1 AND business_id = $2`,
        [abs.id, bid]
      );
      splitCount++;
    }
    return splitCount;
  });
}

/**
 * Compute available alternative practitioners for each impacted booking.
 * Uses batch queries (5 total) + in-memory checks for efficiency.
 */
async function computeAlternatives(bid, absentPracId, dateFrom, dateTo, bookings) {
  const serviceIds = [...new Set(bookings.map(b => b.service_id).filter(Boolean))];
  if (serviceIds.length === 0) { bookings.forEach(b => { b.alternatives = []; }); return; }

  const candResult = await queryWithRLS(bid,
    `SELECT DISTINCT ps.service_id, p.id AS practitioner_id, p.display_name, p.color
     FROM practitioner_services ps
     JOIN practitioners p ON p.id = ps.practitioner_id
     WHERE ps.service_id = ANY($1::uuid[])
       AND p.business_id = $2 AND p.is_active = true AND p.booking_enabled = true
       AND p.id != $3`,
    [serviceIds, bid, absentPracId]
  );

  const allCandIds = [...new Set(candResult.rows.map(r => r.practitioner_id))];
  if (allCandIds.length === 0) { bookings.forEach(b => { b.alternatives = []; }); return; }

  // Batch fetch (4 queries)
  const [absR, availR, excR, bkR] = await Promise.all([
    queryWithRLS(bid,
      `SELECT practitioner_id, date_from, date_to, period, period_end FROM staff_absences
       WHERE business_id = $1 AND practitioner_id = ANY($2::uuid[])
       AND date_from <= $4::date AND date_to >= $3::date`,
      [bid, allCandIds, dateFrom, dateTo]),
    queryWithRLS(bid,
      `SELECT practitioner_id, weekday, start_time, end_time FROM availabilities
       WHERE business_id = $1 AND practitioner_id = ANY($2::uuid[]) AND is_active = true`,
      [bid, allCandIds]),
    queryWithRLS(bid,
      `SELECT practitioner_id, date, type FROM availability_exceptions
       WHERE business_id = $1 AND practitioner_id = ANY($2::uuid[])
       AND date >= $3::date AND date <= $4::date`,
      [bid, allCandIds, dateFrom, dateTo]),
    queryWithRLS(bid,
      `SELECT practitioner_id, start_at, end_at FROM bookings
       WHERE business_id = $1 AND practitioner_id = ANY($2::uuid[])
       AND start_at::date >= $3::date AND start_at::date <= $4::date
       AND status IN ('confirmed', 'pending', 'modified_pending', 'pending_deposit')`,
      [bid, allCandIds, dateFrom, dateTo])
  ]);

  const candByService = {};
  candResult.rows.forEach(r => {
    if (!candByService[r.service_id]) candByService[r.service_id] = [];
    if (!candByService[r.service_id].find(c => c.practitioner_id === r.practitioner_id)) {
      candByService[r.service_id].push(r);
    }
  });

  function _ttm(t) {
    if (!t || typeof t !== 'string') return 0;
    const [h, m] = t.split(':').map(Number);
    return (h || 0) * 60 + (m || 0);
  }

  function isCandAvail(pracId, startAt, endAt) {
    const start = new Date(startAt);
    const end = new Date(endAt);
    const dateStr = start.toLocaleDateString('en-CA', { timeZone: 'Europe/Brussels' });

    // 1. Absences
    for (const abs of absR.rows) {
      if (abs.practitioner_id !== pracId) continue;
      const aF = new Date(abs.date_from).toLocaleDateString('en-CA', { timeZone: 'Europe/Brussels' });
      const aT = new Date(abs.date_to).toLocaleDateString('en-CA', { timeZone: 'Europe/Brussels' });
      if (dateStr < aF || dateStr > aT) continue;
      let p = aF === aT ? (abs.period || 'full') : dateStr === aF ? (abs.period || 'full') : dateStr === aT ? (abs.period_end || 'full') : 'full';
      if (p === 'full') return false;
      const bxlH = parseInt(start.toLocaleString('en-GB', { timeZone: 'Europe/Brussels', hour12: false, hour: '2-digit' })) || 0;
      if (p === 'am' && bxlH < 13) return false;
      if (p === 'pm' && bxlH >= 13) return false;
    }

    // 2. Exceptions (closed)
    for (const exc of excR.rows) {
      if (exc.practitioner_id !== pracId) continue;
      if (new Date(exc.date).toLocaleDateString('en-CA', { timeZone: 'Europe/Brussels' }) === dateStr && exc.type === 'closed') return false;
    }

    // 3. Weekly schedule
    const bxlDate = new Date(dateStr + 'T12:00:00');
    const jsDay = bxlDate.getDay();
    const dbDay = jsDay === 0 ? 6 : jsDay - 1;
    const slots = availR.rows.filter(a => a.practitioner_id === pracId && a.weekday === dbDay);
    if (slots.length === 0) return false;

    const sp = start.toLocaleString('en-GB', { timeZone: 'Europe/Brussels', hour12: false }).split(/[\s,/:]+/);
    const ep = end.toLocaleString('en-GB', { timeZone: 'Europe/Brussels', hour12: false }).split(/[\s,/:]+/);
    const bkS = (parseInt(sp[3]) || 0) * 60 + (parseInt(sp[4]) || 0);
    let bkE = (parseInt(ep[3]) || 0) * 60 + (parseInt(ep[4]) || 0);
    if (bkE <= bkS) bkE += 1440;
    const fitsSchedule = slots.some(s => {
      const ss = _ttm(s.start_time);
      let se = _ttm(s.end_time);
      if (se <= ss) se += 1440;
      return bkS >= ss && bkE <= se;
    });
    if (!fitsSchedule) return false;

    // 4. Booking overlaps
    const startMs = start.getTime();
    const endMs = end.getTime();
    for (const ob of bkR.rows) {
      if (ob.practitioner_id !== pracId) continue;
      if (new Date(ob.start_at).getTime() < endMs && new Date(ob.end_at).getTime() > startMs) return false;
    }
    return true;
  }

  for (const bk of bookings) {
    bk.alternatives = [];
    const candidates = candByService[bk.service_id] || [];
    for (const cand of candidates) {
      if (isCandAvail(cand.practitioner_id, bk.start_at, bk.end_at)) {
        bk.alternatives.push({
          practitioner_id: cand.practitioner_id,
          display_name: cand.display_name,
          color: cand.color
        });
      }
    }
  }
}

/** Parse month range from query param */
function parseMonthRange(monthParam) {
  if (monthParam && /^\d{4}-\d{2}$/.test(monthParam)) {
    const dateFrom = `${monthParam}-01`;
    const [y, m] = monthParam.split('-').map(Number);
    const lastDay = new Date(y, m, 0).getDate();
    const dateTo = `${monthParam}-${String(lastDay).padStart(2, '0')}`;
    return { dateFrom, dateTo };
  }
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const dateFrom = `${y}-${m}-01`;
  const lastDay = new Date(y, now.getMonth() + 1, 0).getDate();
  const dateTo = `${y}-${m}-${String(lastDay).padStart(2, '0')}`;
  return { dateFrom, dateTo };
}

// ============================================================
// GET /api/planning/absences?month=2026-03
// Returns absences + workingDays per practitioner + holidays
// ============================================================
router.get('/absences', async (req, res, next) => {
  try {
    const bid = req.businessId;
    const { dateFrom, dateTo } = parseMonthRange(req.query.month);

    const result = await queryWithRLS(bid,
      `SELECT sa.*, p.display_name AS practitioner_name, p.color AS practitioner_color, p.email AS practitioner_email
       FROM staff_absences sa
       JOIN practitioners p ON p.id = sa.practitioner_id
       WHERE sa.business_id = $1
         AND sa.date_from <= $3::date
         AND sa.date_to >= $2::date
       ORDER BY sa.date_from`,
      [bid, dateFrom, dateTo]
    );

    // Fetch all active practitioners to get workingDays
    const pracResult = await queryWithRLS(bid,
      `SELECT DISTINCT practitioner_id, weekday
       FROM availabilities
       WHERE business_id = $1 AND is_active = true`,
      [bid]
    );
    const workingDays = {};
    pracResult.rows.forEach(r => {
      if (!workingDays[r.practitioner_id]) workingDays[r.practitioner_id] = [];
      workingDays[r.practitioner_id].push(r.weekday);
    });
    // Sort each array for consistency
    Object.values(workingDays).forEach(arr => arr.sort((a, b) => a - b));

    // Fetch holidays for the month
    const holidays = await getHolidays(bid, dateFrom, dateTo);

    res.json({
      absences: result.rows,
      workingDays,
      holidays: holidays.list
    });
  } catch (err) { next(err); }
});

// ============================================================
// GET /api/planning/absences/:id
// ============================================================
router.get('/absences/:id', async (req, res, next) => {
  try {
    const bid = req.businessId;
    const result = await queryWithRLS(bid,
      `SELECT sa.*, p.display_name AS practitioner_name, p.email AS practitioner_email
       FROM staff_absences sa
       JOIN practitioners p ON p.id = sa.practitioner_id
       WHERE sa.id = $1 AND sa.business_id = $2`,
      [req.params.id, bid]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Absence introuvable' });
    res.json({ absence: result.rows[0] });
  } catch (err) { next(err); }
});

// ============================================================
// POST /api/planning/absences — create absence
// ============================================================
router.post('/absences', requireOwner, async (req, res, next) => {
  try {
    const bid = req.businessId;
    const { practitioner_id, date_from, date_to, type, note, period, period_end } = req.body;

    if (!practitioner_id) return res.status(400).json({ error: 'Praticien requis' });
    if (!date_from || !date_to) return res.status(400).json({ error: 'Dates requises' });
    if (date_from > date_to) return res.status(400).json({ error: 'Date de début doit être avant la date de fin' });

    const validTypes = ['conge', 'maladie', 'formation', 'autre'];
    const absType = validTypes.includes(type) ? type : 'conge';

    const validPeriods = ['full', 'am', 'pm'];
    const absPeriod = validPeriods.includes(period) ? period : 'full';
    const absPeriodEnd = validPeriods.includes(period_end) ? period_end : 'full';

    // Check practitioner belongs to this business
    const pracCheck = await queryWithRLS(bid,
      `SELECT id, display_name FROM practitioners WHERE id = $1 AND business_id = $2`,
      [practitioner_id, bid]
    );
    if (pracCheck.rows.length === 0) return res.status(404).json({ error: 'Praticien introuvable' });

    // Auto-split existing absences that overlap (instead of rejecting)
    const actorName = req.user?.name || req.user?.email || 'Système';
    const splitCount = await splitOverlappingAbsences(bid, practitioner_id, date_from, date_to, absPeriod, absPeriodEnd, null, actorName);

    // Count impacted bookings
    const impacted = await queryWithRLS(bid,
      `SELECT COUNT(*) AS cnt FROM bookings
       WHERE business_id = $1 AND practitioner_id = $2
         AND start_at::date >= $3::date AND start_at::date <= $4::date
         AND status IN ('confirmed', 'pending', 'modified_pending', 'pending_deposit')`,
      [bid, practitioner_id, date_from, date_to]
    );

    const result = await queryWithRLS(bid,
      `INSERT INTO staff_absences (business_id, practitioner_id, date_from, date_to, type, note, period, period_end)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
      [bid, practitioner_id, date_from, date_to, absType, note || null, absPeriod, absPeriodEnd]
    );

    const absence = result.rows[0];

    // Log creation
    const pracName = pracCheck.rows[0].display_name;
    await logAbsence(bid, absence.id, 'created', {
      type: absType, period: absPeriod, period_end: absPeriodEnd,
      date_from, date_to, practitioner: pracName,
      ...(splitCount > 0 ? { auto_split: splitCount } : {})
    }, actorName);

    res.status(201).json({
      absence,
      impacted_bookings: parseInt(impacted.rows[0].cnt),
      auto_splits: splitCount
    });
  } catch (err) { next(err); }
});

// ============================================================
// PATCH /api/planning/absences/:id — update absence
// ============================================================
router.patch('/absences/:id', requireOwner, async (req, res, next) => {
  try {
    const bid = req.businessId;
    const { id } = req.params;
    const { date_from, date_to, type, note, period, period_end } = req.body;

    // Fetch current values
    const current = await queryWithRLS(bid,
      `SELECT sa.*, p.display_name AS practitioner_name FROM staff_absences sa
       JOIN practitioners p ON p.id = sa.practitioner_id
       WHERE sa.id = $1 AND sa.business_id = $2`,
      [id, bid]
    );
    if (current.rows.length === 0) return res.status(404).json({ error: 'Absence introuvable' });
    const old = current.rows[0];

    const sets = [];
    const params = [id, bid];
    let idx = 3;
    const changes = {};

    if (date_from !== undefined) { sets.push(`date_from = $${idx}`); params.push(date_from); idx++; if (date_from !== old.date_from?.toISOString?.()?.slice(0,10)) changes.date_from = { from: old.date_from, to: date_from }; }
    if (date_to !== undefined) { sets.push(`date_to = $${idx}`); params.push(date_to); idx++; if (date_to !== old.date_to?.toISOString?.()?.slice(0,10)) changes.date_to = { from: old.date_to, to: date_to }; }
    if (type !== undefined) { sets.push(`type = $${idx}`); params.push(type); idx++; if (type !== old.type) changes.type = { from: old.type, to: type }; }
    if (note !== undefined) { sets.push(`note = $${idx}`); params.push(note); idx++; if (note !== old.note) changes.note = { from: old.note, to: note }; }
    if (period !== undefined) { sets.push(`period = $${idx}`); params.push(period); idx++; if (period !== old.period) changes.period = { from: old.period, to: period }; }
    if (period_end !== undefined) { sets.push(`period_end = $${idx}`); params.push(period_end); idx++; if (period_end !== old.period_end) changes.period_end = { from: old.period_end, to: period_end }; }

    if (sets.length === 0) return res.status(400).json({ error: 'Rien à modifier' });

    // Overlap check for the updated values (exclude self)
    const newFrom = date_from || old.date_from?.toISOString?.()?.slice(0,10) || old.date_from;
    const newTo = date_to || old.date_to?.toISOString?.()?.slice(0,10) || old.date_to;
    const newPeriod = period || old.period || 'full';
    const newPeriodEnd = period_end || old.period_end || 'full';

    // Auto-split any other absences that overlap with the new range (exclude self)
    await splitOverlappingAbsences(bid, old.practitioner_id, newFrom, newTo, newPeriod, newPeriodEnd, id,
      req.user?.name || req.user?.email || 'Système');

    sets.push('updated_at = NOW()');

    const result = await queryWithRLS(bid,
      `UPDATE staff_absences SET ${sets.join(', ')} WHERE id = $1 AND business_id = $2 RETURNING *`,
      params
    );

    if (Object.keys(changes).length > 0) {
      await logAbsence(bid, id, 'modified', { changes, practitioner: old.practitioner_name },
        req.user?.name || req.user?.email || 'Système');
    }

    res.json({ absence: result.rows[0] });
  } catch (err) { next(err); }
});

// ============================================================
// DELETE /api/planning/absences/:id
// ============================================================
router.delete('/absences/:id', requireOwner, async (req, res, next) => {
  try {
    const bid = req.businessId;

    const current = await queryWithRLS(bid,
      `SELECT sa.*, p.display_name AS practitioner_name FROM staff_absences sa
       JOIN practitioners p ON p.id = sa.practitioner_id
       WHERE sa.id = $1 AND sa.business_id = $2`,
      [req.params.id, bid]
    );
    if (current.rows.length === 0) return res.status(404).json({ error: 'Absence introuvable' });
    const old = current.rows[0];

    // Log BEFORE delete (FK cascade will remove logs otherwise)
    await logAbsence(bid, req.params.id, 'cancelled', {
      type: old.type, period: old.period, period_end: old.period_end,
      date_from: old.date_from, date_to: old.date_to,
      practitioner: old.practitioner_name
    }, req.user?.name || req.user?.email || 'Système');

    await queryWithRLS(bid,
      `DELETE FROM staff_absences WHERE id = $1 AND business_id = $2`,
      [req.params.id, bid]
    );
    res.json({ deleted: true });
  } catch (err) { next(err); }
});

// ============================================================
// GET /api/planning/absences/:id/logs
// ============================================================
router.get('/absences/:id/logs', async (req, res, next) => {
  try {
    const bid = req.businessId;
    const result = await queryWithRLS(bid,
      `SELECT * FROM absence_logs
       WHERE absence_id = $1 AND business_id = $2
       ORDER BY created_at DESC`,
      [req.params.id, bid]
    );
    res.json({ logs: result.rows });
  } catch (err) { next(err); }
});

// ============================================================
// POST /api/planning/absences/:id/notify — send email
// ============================================================
router.post('/absences/:id/notify', requireOwner, async (req, res, next) => {
  try {
    const bid = req.businessId;

    const result = await queryWithRLS(bid,
      `SELECT sa.*, p.display_name AS practitioner_name, p.email AS practitioner_email
       FROM staff_absences sa
       JOIN practitioners p ON p.id = sa.practitioner_id
       WHERE sa.id = $1 AND sa.business_id = $2`,
      [req.params.id, bid]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Absence introuvable' });

    const abs = result.rows[0];
    if (!abs.practitioner_email) return res.status(400).json({ error: 'Ce praticien n\'a pas d\'adresse email' });

    const bizResult = await queryWithRLS(bid,
      `SELECT name, email, theme FROM businesses WHERE id = $1`, [bid]
    );
    const business = bizResult.rows[0] || { name: 'Genda' };

    const typeLabels = { conge: 'Congé', maladie: 'Maladie', formation: 'Formation', autre: 'Absence' };
    const periodLabels = { full: 'Journée complète', am: 'Matin', pm: 'Après-midi' };
    const typeLabel = typeLabels[abs.type] || 'Absence';

    const dateFrom = new Date(abs.date_from).toLocaleDateString('fr-BE', {
      timeZone: 'Europe/Brussels', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
    });
    const dateTo = new Date(abs.date_to).toLocaleDateString('fr-BE', {
      timeZone: 'Europe/Brussels', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
    });

    const isSameDay = abs.date_from === abs.date_to ||
      new Date(abs.date_from).toDateString() === new Date(abs.date_to).toDateString();

    let periodInfo = '';
    if (isSameDay) {
      periodInfo = periodLabels[abs.period] || 'Journée complète';
    } else {
      const startP = abs.period === 'pm' ? ' (à partir de l\'après-midi)' : '';
      const endP = abs.period_end === 'am' ? ' (jusqu\'au matin)' : '';
      periodInfo = `Du ${dateFrom}${startP} au ${dateTo}${endP}`;
    }

    const dateRange = isSameDay ? dateFrom : `du ${dateFrom} au ${dateTo}`;

    const bodyHTML = `
      <p>Bonjour <strong>${escHtml(abs.practitioner_name)}</strong>,</p>
      <p>Ceci est une confirmation de votre absence enregistrée :</p>
      <div style="background:#F5F4F1;border-radius:8px;padding:16px;margin:16px 0">
        <div style="font-size:14px;font-weight:600;color:#1A1816;margin-bottom:6px">${escHtml(typeLabel)}</div>
        <div style="font-size:13px;color:#3D3832;margin-bottom:4px">${escHtml(periodInfo)}</div>
        ${abs.note ? `<div style="font-size:13px;color:#6B6560;margin-top:8px;font-style:italic">${escHtml(abs.note)}</div>` : ''}
      </div>
      <p style="font-size:13px;color:#9C958E">Ce document fait office de confirmation. Conservez-le pour vos dossiers.</p>`;

    const html = buildEmailHTML({
      title: `Confirmation — ${typeLabel}`,
      preheader: `${typeLabel} ${dateRange}`,
      bodyHTML,
      businessName: business.name,
      primaryColor: business.theme?.primary_color,
      footerText: `${business.name} · Via Genda.be`
    });

    const emailResult = await sendEmail({
      to: abs.practitioner_email,
      toName: abs.practitioner_name,
      subject: `Confirmation ${typeLabel.toLowerCase()} — ${business.name}`,
      html,
      fromName: business.name,
      replyTo: business.email
    });

    await logAbsence(bid, abs.id, 'email_sent', {
      to: abs.practitioner_email, success: emailResult.success
    }, req.user?.name || req.user?.email || 'Système');

    if (emailResult.success) {
      res.json({ sent: true, to: abs.practitioner_email });
    } else {
      res.status(500).json({ error: emailResult.error || 'Erreur d\'envoi' });
    }
  } catch (err) { next(err); }
});

// ============================================================
// GET /api/planning/stats?month=2026-03
// Counters per practitioner per type — EXCLUDES non-working days & holidays
// ============================================================
router.get('/stats', async (req, res, next) => {
  try {
    const bid = req.businessId;
    const { dateFrom, dateTo } = parseMonthRange(req.query.month);

    const result = await queryWithRLS(bid,
      `SELECT sa.practitioner_id, sa.type, sa.period, sa.period_end,
              sa.date_from, sa.date_to,
              p.display_name AS practitioner_name
       FROM staff_absences sa
       JOIN practitioners p ON p.id = sa.practitioner_id
       WHERE sa.business_id = $1
         AND sa.date_from <= $3::date
         AND sa.date_to >= $2::date
       ORDER BY sa.practitioner_id`,
      [bid, dateFrom, dateTo]
    );

    // Fetch work days for all practitioners in the result
    const pracIds = [...new Set(result.rows.map(r => r.practitioner_id))];
    const workDaysMap = await getPractitionerWorkDays(bid, pracIds);
    const holidays = await getHolidays(bid, dateFrom, dateTo);

    const stats = {};
    const monthStart = new Date(dateFrom);
    const monthEnd = new Date(dateTo);

    result.rows.forEach(row => {
      if (!stats[row.practitioner_id]) {
        stats[row.practitioner_id] = {
          practitioner_name: row.practitioner_name,
          conge: 0, maladie: 0, formation: 0, autre: 0, total: 0
        };
      }
      const from = new Date(Math.max(new Date(row.date_from), monthStart));
      const to = new Date(Math.min(new Date(row.date_to), monthEnd));
      const workDays = workDaysMap.get(row.practitioner_id) || null;

      let days = 0;
      for (let d = new Date(from); d <= to; d.setDate(d.getDate() + 1)) {
        // Skip non-working days and holidays
        if (!isWorkDay(d, workDays, holidays.dateSet)) continue;

        const dayPeriod = getEffectivePeriod(d, row.date_from, row.date_to, row.period, row.period_end);
        days += dayPeriod === 'full' ? 1 : 0.5;
      }

      stats[row.practitioner_id][row.type] += days;
      stats[row.practitioner_id].total += days;
    });

    const totals = { conge: 0, maladie: 0, formation: 0, autre: 0, total: 0 };
    Object.values(stats).forEach(s => {
      totals.conge += s.conge;
      totals.maladie += s.maladie;
      totals.formation += s.formation;
      totals.autre += s.autre;
      totals.total += s.total;
    });

    res.json({ stats, totals });
  } catch (err) { next(err); }
});

// ============================================================
// GET /api/planning/impact
// ============================================================
router.get('/impact', async (req, res, next) => {
  try {
    const bid = req.businessId;
    const { practitioner_id, date_from, date_to, period, period_end } = req.query;

    if (!practitioner_id || !date_from || !date_to) {
      return res.status(400).json({ error: 'practitioner_id, date_from, date_to requis' });
    }

    const bookings = await queryWithRLS(bid,
      `SELECT b.id, b.start_at, b.end_at, b.status, b.service_id, b.group_id, b.practitioner_id,
              c.full_name AS client_name, c.phone AS client_phone, c.email AS client_email,
              s.name AS service_name
       FROM bookings b
       LEFT JOIN clients c ON c.id = b.client_id
       LEFT JOIN services s ON s.id = b.service_id
       WHERE b.business_id = $1 AND b.practitioner_id = $2
         AND b.start_at::date >= $3::date AND b.start_at::date <= $4::date
         AND b.status IN ('confirmed', 'pending', 'modified_pending', 'pending_deposit')
       ORDER BY b.start_at`,
      [bid, practitioner_id, date_from, date_to]
    );

    // Filter by half-day period if provided (am = before 13:00, pm = 13:00+)
    const absPeriod = period || 'full';
    const absPeriodEnd = period_end || absPeriod;
    let filtered = bookings.rows;
    if (absPeriod !== 'full' || absPeriodEnd !== 'full') {
      filtered = bookings.rows.filter(b => {
        const bxlH = new Date(b.start_at).toLocaleString('en-GB', { timeZone: 'Europe/Brussels', hour12: false, hour: '2-digit' });
        const hour = parseInt(bxlH) || 0;
        const dateStr = new Date(b.start_at).toLocaleDateString('en-CA', { timeZone: 'Europe/Brussels' });
        // Determine effective period for this booking's date
        let dayPeriod;
        if (date_from === date_to) dayPeriod = absPeriod;
        else if (dateStr === date_from) dayPeriod = absPeriod;
        else if (dateStr === date_to) dayPeriod = absPeriodEnd;
        else dayPeriod = 'full'; // middle day
        if (dayPeriod === 'full') return true;
        if (dayPeriod === 'am') return hour < 13;
        if (dayPeriod === 'pm') return hour >= 13;
        return true;
      });
    }

    // Split bookings: also include group siblings from split groups
    // (if Ashley is absent and a booking is part of a split group with Véronique, the whole combo is impacted)
    const groupIds = [...new Set(filtered.filter(b => b.group_id).map(b => b.group_id))];
    for (const gid of groupIds) {
      // Check if this group is a split (different practitioners)
      const siblings = await queryWithRLS(bid,
        `SELECT b.id, b.start_at, b.end_at, b.status, b.service_id, b.practitioner_id, b.group_id,
                c.full_name AS client_name, c.phone AS client_phone, c.email AS client_email,
                s.name AS service_name
         FROM bookings b
         LEFT JOIN clients c ON c.id = b.client_id
         LEFT JOIN services s ON s.id = b.service_id
         WHERE b.group_id = $1 AND b.business_id = $2
           AND b.status IN ('confirmed', 'pending', 'modified_pending', 'pending_deposit')
         ORDER BY b.start_at`,
        [gid, bid]
      );
      const pracIds = new Set(siblings.rows.map(r => r.practitioner_id));
      if (pracIds.size > 1) {
        // It's a split group — add missing siblings to the list
        for (const sib of siblings.rows) {
          if (!filtered.find(f => f.id === sib.id)) {
            sib.split_sibling = true; // Mark as indirectly impacted
            filtered.push(sib);
          }
        }
      }
    }

    // Coverage check: which services are ONLY covered by this practitioner?
    const pracServices = await queryWithRLS(bid,
      `SELECT DISTINCT s.id, s.name FROM practitioner_services ps
       JOIN services s ON s.id = ps.service_id
       WHERE ps.practitioner_id = $1 AND s.business_id = $2 AND s.is_active = true`,
      [practitioner_id, bid]
    );

    const uncoveredServices = [];
    for (const svc of pracServices.rows) {
      const others = await queryWithRLS(bid,
        `SELECT COUNT(*) AS cnt FROM practitioner_services ps
         JOIN practitioners p ON p.id = ps.practitioner_id
         WHERE ps.service_id = $1 AND p.business_id = $2
           AND p.is_active = true AND p.booking_enabled = true AND p.id != $3`,
        [svc.id, bid, practitioner_id]
      );
      if (parseInt(others.rows[0].cnt) === 0) {
        uncoveredServices.push(svc.name);
      }
    }

    // Compute alternatives if requested
    if (req.query.with_alternatives === '1' && filtered.length > 0) {
      await computeAlternatives(bid, practitioner_id, date_from, date_to, filtered);
    }

    res.json({
      impacted_bookings: filtered,
      count: filtered.length,
      coverage: uncoveredServices.length === 0 ? 'ok' : 'at_risk',
      uncovered_services: uncoveredServices
    });
  } catch (err) { next(err); }
});

// ============================================================
// POST /api/planning/notify-impacted — notify clients affected by absence
// Sends email + SMS to clients whose bookings overlap the absence period
// ============================================================
router.post('/notify-impacted', requireOwner, async (req, res, next) => {
  try {
    const bid = req.businessId;
    const { practitioner_id, date_from, date_to, period, period_end } = req.body;

    if (!practitioner_id || !date_from || !date_to) {
      return res.status(400).json({ error: 'practitioner_id, date_from, date_to requis' });
    }

    // Fetch impacted bookings (same logic as GET /impact)
    const bookings = await queryWithRLS(bid,
      `SELECT b.id, b.start_at, b.end_at, b.status, b.public_token, b.group_id,
              b.appointment_mode,
              c.full_name AS client_name, c.phone AS client_phone,
              c.email AS client_email, c.consent_sms,
              CASE WHEN sv.name IS NOT NULL THEN s.name || ' — ' || sv.name ELSE s.name END AS service_name,
              COALESCE(sv.duration_min, s.duration_min) AS duration_min,
              COALESCE(sv.price_cents, s.price_cents) AS price_cents,
              p.display_name AS practitioner_name
       FROM bookings b
       LEFT JOIN clients c ON c.id = b.client_id
       LEFT JOIN services s ON s.id = b.service_id
       LEFT JOIN service_variants sv ON sv.id = b.service_variant_id
       LEFT JOIN practitioners p ON p.id = b.practitioner_id
       WHERE b.business_id = $1 AND b.practitioner_id = $2
         AND b.start_at::date >= $3::date AND b.start_at::date <= $4::date
         AND b.status IN ('confirmed', 'pending', 'modified_pending', 'pending_deposit')
       ORDER BY b.start_at`,
      [bid, practitioner_id, date_from, date_to]
    );

    // Filter by half-day period
    const absPeriod = period || 'full';
    const absPeriodEnd = period_end || absPeriod;
    let filtered = bookings.rows;
    if (absPeriod !== 'full' || absPeriodEnd !== 'full') {
      filtered = bookings.rows.filter(b => {
        const bxlH = new Date(b.start_at).toLocaleString('en-GB', { timeZone: 'Europe/Brussels', hour12: false, hour: '2-digit' });
        const hour = parseInt(bxlH) || 0;
        const dateStr = new Date(b.start_at).toLocaleDateString('en-CA', { timeZone: 'Europe/Brussels' });
        let dayPeriod;
        if (date_from === date_to) dayPeriod = absPeriod;
        else if (dateStr === date_from) dayPeriod = absPeriod;
        else if (dateStr === date_to) dayPeriod = absPeriodEnd;
        else dayPeriod = 'full';
        if (dayPeriod === 'full') return true;
        if (dayPeriod === 'am') return hour < 13;
        if (dayPeriod === 'pm') return hour >= 13;
        return true;
      });
    }

    if (filtered.length === 0) {
      return res.json({ sent_email: 0, sent_sms: 0, total: 0, errors: 0 });
    }

    // Fetch business info
    const bizResult = await queryWithRLS(bid,
      `SELECT name, email, phone, address, plan, theme, settings, slug FROM businesses WHERE id = $1`, [bid]
    );
    const business = bizResult.rows[0] || { name: 'Genda' };
    const hasSms = business.plan !== 'free';
    const primaryColor = business.theme?.primary_color;

    const pracName = filtered[0]?.practitioner_name || 'votre praticien';

    let sentEmail = 0, sentSms = 0, errors = 0;
    let splitGroupsCancelled = 0;

    // Split bookings: auto-cancel entire group when one sibling is impacted
    const processedGroupIds = new Set();
    for (const bk of filtered) {
      if (!bk.group_id || processedGroupIds.has(bk.group_id)) continue;
      processedGroupIds.add(bk.group_id);

      // Check if this group is a split (different practitioners)
      const siblings = await queryWithRLS(bid,
        `SELECT b.id, b.practitioner_id, b.status, b.public_token, b.start_at, b.end_at,
                b.promotion_label, b.promotion_discount_cents,
                b.deposit_status, b.deposit_amount_cents,
                CASE WHEN sv.name IS NOT NULL THEN s.name || ' \u2014 ' || sv.name ELSE s.name END AS service_name,
                COALESCE(sv.price_cents, s.price_cents) AS price_cents,
                p.display_name AS practitioner_name,
                c.full_name AS client_name, c.email AS client_email
         FROM bookings b
         LEFT JOIN services s ON s.id = b.service_id
         LEFT JOIN service_variants sv ON sv.id = b.service_variant_id
         LEFT JOIN practitioners p ON p.id = b.practitioner_id
         LEFT JOIN clients c ON c.id = b.client_id
         WHERE b.group_id = $1 AND b.business_id = $2
         ORDER BY b.group_order, b.start_at`,
        [bk.group_id, bid]
      );
      const pracIds = new Set(siblings.rows.map(r => r.practitioner_id));
      if (pracIds.size <= 1) continue; // Not a split group, handle normally

      // Cancel ALL siblings in the split group
      await queryWithRLS(bid,
        `UPDATE bookings SET status = 'cancelled', cancel_reason = 'absence', updated_at = NOW()
         WHERE group_id = $1 AND business_id = $2 AND status IN ('confirmed', 'pending', 'pending_deposit')`,
        [bk.group_id, bid]
      );
      splitGroupsCancelled++;

      // Send unified cancellation email to the client
      const clientEmail = siblings.rows[0]?.client_email;
      const clientName = siblings.rows[0]?.client_name;
      const publicToken = siblings.rows[0]?.public_token;
      if (clientEmail) {
        try {
          const startLocal = new Date(bk.start_at).toLocaleString('fr-BE', {
            timeZone: 'Europe/Brussels', weekday: 'long', day: 'numeric', month: 'long',
            hour: '2-digit', minute: '2-digit'
          });
          const lastSib = siblings.rows[siblings.rows.length - 1];
          const endTimeLocal = lastSib.end_at ? new Date(lastSib.end_at).toLocaleTimeString('fr-BE', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Brussels' }) : '';
          const svcList = siblings.rows.map(s => {
            const price = s.price_cents ? ` \u00b7 ${(s.price_cents / 100).toFixed(2).replace('.', ',')} \u20ac` : '';
            return `<div style="font-size:13px;color:#3D3832;padding:2px 0">\u2022 ${escHtml(s.service_name)}${price} \u00b7 ${escHtml(s.practitioner_name || '')}</div>`;
          }).join('');
          // Show promo discount if present on any sibling
          const grpPromoLabel = siblings.rows.find(s => s.promotion_label)?.promotion_label || '';
          const grpPromoDiscount = siblings.rows.reduce((sum, s) => sum + (parseInt(s.promotion_discount_cents) || 0), 0);
          const promoHTML = (grpPromoDiscount > 0 && grpPromoLabel)
            ? `<div style="font-size:12px;color:#7A7470;padding:2px 0">${escHtml(grpPromoLabel)} : -${(grpPromoDiscount / 100).toFixed(2).replace('.', ',')} \u20ac</div>`
            : '';
          // Deposit info if any sibling had a paid deposit
          const grpDepositPaid = siblings.rows.find(s => s.deposit_status === 'paid' && parseInt(s.deposit_amount_cents) > 0);
          const depositHTML = grpDepositPaid
            ? `<div style="background:#FFF8E1;border-radius:8px;padding:12px 16px;margin:12px 0;border-left:3px solid #F9A825">
                <div style="font-size:13px;color:#5D4037">Votre acompte de ${(parseInt(grpDepositPaid.deposit_amount_cents) / 100).toFixed(2).replace('.', ',')} \u20ac a bien \u00e9t\u00e9 enregistr\u00e9. Nous vous recontacterons concernant son traitement (remboursement ou report).</div>
              </div>`
            : '';
          const baseUrl = process.env.APP_BASE_URL || process.env.BASE_URL || 'https://genda.be';
          const slug = business.slug || '';
          const rebookUrl = slug ? `${baseUrl}/${slug}` : baseUrl;

          const bodyHTML = `
            <p>Bonjour <strong>${escHtml(clientName || 'cher client')}</strong>,</p>
            <p>Nous sommes d\u00e9sol\u00e9s, votre rendez-vous a d\u00fb \u00eatre annul\u00e9 suite \u00e0 l'indisponibilit\u00e9 de ${escHtml(pracName)} :</p>
            <div style="background:#FEF2F2;border-left:4px solid #EF4444;border-radius:6px;padding:14px 16px;margin:16px 0">
              <div style="font-size:14px;font-weight:600;color:#1A1816;margin-bottom:6px">${escHtml(startLocal)}${endTimeLocal ? ' \u2013 ' + endTimeLocal : ''}</div>
              ${svcList}
              ${promoHTML}
            </div>
            ${depositHTML}
            <p>Vous pouvez reprendre un nouveau cr\u00e9neau en cliquant ci-dessous :</p>
            ${business.phone ? `<p style="font-size:13px;color:#3D3832">📞 Téléphone : <a href="tel:${escHtml(business.phone)}" style="color:#1A1816">${escHtml(business.phone)}</a></p>` : ''}
            ${business.email ? `<p style="font-size:13px;color:#3D3832;margin-top:-8px">✉️ Email : <a href="mailto:${escHtml(business.email)}" style="color:#1A1816">${escHtml(business.email)}</a></p>` : ''}`;

          const html = buildEmailHTML({
            title: 'Rendez-vous annul\u00e9',
            preheader: `Votre RDV chez ${business.name} a \u00e9t\u00e9 annul\u00e9`,
            bodyHTML,
            ctaText: 'Reprendre un cr\u00e9neau',
            ctaUrl: rebookUrl,
            cancelText: publicToken ? 'G\u00e9rer mon rendez-vous' : null,
            cancelUrl: publicToken ? `${baseUrl}/booking/${publicToken}` : null,
            businessName: business.name,
            primaryColor,
            footerText: `${business.name}${business.address ? ' \u00b7 ' + business.address : ''} \u2014 Via Genda.be`
          });

          const emailResult = await sendEmail({
            to: clientEmail,
            toName: clientName,
            subject: `Rendez-vous annul\u00e9 \u2014 ${business.name}`,
            html,
            fromName: business.name,
            replyTo: business.email
          });
          if (emailResult.success) sentEmail++;
          else errors++;
        } catch (e) {
          console.error('[NOTIFY-IMPACT] Split group cancellation email error:', e.message);
          errors++;
        }
      }

      // Remove these bookings from the normal loop (already handled)
      const siblingIds = new Set(siblings.rows.map(r => r.id));
      filtered = filtered.filter(f => !siblingIds.has(f.id));
    }

    // De-duplicate by client email/phone (a client might have multiple bookings)
    // But we send one email per booking so they know which specific appointment is impacted
    for (const bk of filtered) {
      const startLocal = new Date(bk.start_at).toLocaleString('fr-BE', {
        timeZone: 'Europe/Brussels',
        weekday: 'long', day: 'numeric', month: 'long',
        hour: '2-digit', minute: '2-digit'
      });
      const dateShort = new Date(bk.start_at).toLocaleDateString('fr-BE', {
        timeZone: 'Europe/Brussels', day: '2-digit', month: '2-digit'
      });
      const timeShort = new Date(bk.start_at).toLocaleTimeString('fr-BE', {
        timeZone: 'Europe/Brussels', hour: '2-digit', minute: '2-digit'
      });

      // Compute end time from end_at or start_at + duration_min
      let endTimeLocal = '';
      if (bk.end_at) {
        endTimeLocal = new Date(bk.end_at).toLocaleTimeString('fr-BE', {
          timeZone: 'Europe/Brussels', hour: '2-digit', minute: '2-digit'
        });
      } else if (bk.duration_min) {
        const endMs = new Date(bk.start_at).getTime() + bk.duration_min * 60000;
        endTimeLocal = new Date(endMs).toLocaleTimeString('fr-BE', {
          timeZone: 'Europe/Brussels', hour: '2-digit', minute: '2-digit'
        });
      }

      // Price display
      const priceCents = parseInt(bk.price_cents) || 0;
      const priceStr = priceCents > 0 ? (priceCents / 100).toFixed(2).replace('.', ',') + ' €' : '';

      // ── EMAIL ──
      if (bk.client_email) {
        try {
          const manageUrl = bk.public_token
            ? `${process.env.APP_BASE_URL || 'https://genda.be'}/booking/${bk.public_token}`
            : null;

          // Address line (only if appointment is at the business location)
          const addressLine = (bk.appointment_mode === 'cabinet' || !bk.appointment_mode) && business.address
            ? `<div style="font-size:13px;color:#3D3832;margin-top:2px">📍 ${escHtml(business.address)}</div>`
            : '';

          const bodyHTML = `
            <p>Bonjour <strong>${escHtml(bk.client_name || 'cher client')}</strong>,</p>
            <p>Nous vous informons que votre rendez-vous pourrait être impacté suite à l'indisponibilité de ${escHtml(pracName)} :</p>
            <div style="background:#FFF7ED;border-left:4px solid #F59E0B;border-radius:6px;padding:14px 16px;margin:16px 0">
              <div style="font-size:14px;font-weight:600;color:#1A1816;margin-bottom:4px">${escHtml(bk.service_name || 'Rendez-vous')}</div>
              <div style="font-size:13px;color:#3D3832">${escHtml(startLocal)}${endTimeLocal ? ' – ' + endTimeLocal : ''}</div>
              ${priceStr ? `<div style="font-size:13px;color:#3D3832;margin-top:2px">${priceStr}</div>` : ''}
              <div style="font-size:13px;color:#3D3832;margin-top:2px">avec ${escHtml(pracName)}</div>
              ${addressLine}
            </div>
            <p>Nous vous recontacterons prochainement pour reprogrammer votre rendez-vous à un créneau qui vous convient.</p>
            ${business.phone ? `<p style="font-size:13px;color:#3D3832">📞 Téléphone : <a href="tel:${escHtml(business.phone)}" style="color:#1A1816">${escHtml(business.phone)}</a></p>` : ''}
            ${business.email ? `<p style="font-size:13px;color:#3D3832;margin-top:-8px">✉️ Email : <a href="mailto:${escHtml(business.email)}" style="color:#1A1816">${escHtml(business.email)}</a></p>` : ''}`;

          const html = buildEmailHTML({
            title: 'Changement concernant votre rendez-vous',
            preheader: `Votre RDV du ${dateShort} chez ${business.name} est impacté`,
            bodyHTML,
            businessName: business.name,
            primaryColor,
            ...(manageUrl ? { ctaText: 'Gérer mon rendez-vous', ctaUrl: manageUrl } : {}),
            footerText: `${business.name}${business.address ? ' · ' + business.address : ''} — Via Genda.be`
          });

          const emailResult = await sendEmail({
            to: bk.client_email,
            toName: bk.client_name,
            subject: `Changement de RDV du ${dateShort} à ${timeShort} — ${business.name}`,
            html,
            fromName: business.name,
            replyTo: business.email
          });

          if (emailResult.success) sentEmail++;
          else errors++;
        } catch (e) {
          console.error('[NOTIFY-IMPACT] Email error:', e.message);
          errors++;
        }
      }

      // ── SMS (Pro/Premium + consent) ──
      if (hasSms && bk.client_phone && bk.consent_sms) {
        try {
          const _manageUrl = bk.public_token ? `${process.env.APP_BASE_URL || 'https://genda.be'}/booking/${bk.public_token}` : null;
          // Note: split group cancelled bookings are already removed from filtered and notified by email only (no SMS for cancellations)
          const smsBody = _manageUrl
            ? `${business.name}: Votre RDV "${bk.service_name || 'prestation'}" du ${dateShort} à ${timeShort} est impacté par une absence de votre praticien. Détails : ${_manageUrl}`
            : `${business.name}: Votre RDV du ${dateShort} à ${timeShort} (${bk.service_name || 'prestation'}) est impacté par une absence de votre praticien. Nous vous recontacterons.`;

          const smsResult = await sendSMS({
            to: bk.client_phone,
            body: smsBody,
            businessId: bid
          });

          if (smsResult.success) sentSms++;
          else errors++;
        } catch (e) {
          console.error('[NOTIFY-IMPACT] SMS error:', e.message);
          errors++;
        }
      }
    }

    res.json({
      sent_email: sentEmail,
      sent_sms: sentSms,
      total: filtered.length,
      split_groups_cancelled: splitGroupsCancelled,
      errors
    });
  } catch (err) { next(err); }
});

// ============================================================
// POST /api/planning/reassign — reassign a booking to another practitioner
// ============================================================
router.post('/reassign', requireOwner, async (req, res, next) => {
  try {
    const bid = req.businessId;
    const { booking_id, new_practitioner_id } = req.body;

    if (!booking_id || !new_practitioner_id) {
      return res.status(400).json({ error: 'booking_id et new_practitioner_id requis' });
    }

    // 1. Fetch the booking
    const bkResult = await queryWithRLS(bid,
      `SELECT b.id, b.start_at, b.end_at, b.practitioner_id, b.service_id, b.status,
              b.public_token, b.client_id,
              b.price_cents, b.promotion_label, b.promotion_discount_cents, b.duration_min,
              c.full_name AS client_name, c.email AS client_email, c.phone AS client_phone, c.consent_sms,
              s.name AS service_name,
              p.display_name AS old_practitioner_name
       FROM bookings b
       LEFT JOIN clients c ON c.id = b.client_id
       LEFT JOIN services s ON s.id = b.service_id
       LEFT JOIN practitioners p ON p.id = b.practitioner_id
       WHERE b.id = $1 AND b.business_id = $2`,
      [booking_id, bid]
    );
    if (bkResult.rows.length === 0) return res.status(404).json({ error: 'RDV introuvable' });
    const bk = bkResult.rows[0];
    if (!['confirmed', 'pending'].includes(bk.status)) {
      return res.status(400).json({ error: 'RDV non modifiable (statut: ' + bk.status + ')' });
    }
    if (bk.practitioner_id === new_practitioner_id) {
      return res.status(400).json({ error: 'Même praticien' });
    }

    // 2. Validate new practitioner: active, booking_enabled, can do the service
    const newPracResult = await queryWithRLS(bid,
      `SELECT p.id, p.display_name, p.color, p.is_active, p.booking_enabled
       FROM practitioners p
       WHERE p.id = $1 AND p.business_id = $2`,
      [new_practitioner_id, bid]
    );
    if (newPracResult.rows.length === 0) return res.status(404).json({ error: 'Praticien introuvable' });
    const newPrac = newPracResult.rows[0];
    if (!newPrac.is_active || !newPrac.booking_enabled) {
      return res.status(400).json({ error: 'Praticien inactif ou non disponible en ligne' });
    }

    // Check service competency
    if (bk.service_id) {
      const psCheck = await queryWithRLS(bid,
        `SELECT 1 FROM practitioner_services WHERE practitioner_id = $1 AND service_id = $2`,
        [new_practitioner_id, bk.service_id]
      );
      if (psCheck.rows.length === 0) {
        return res.status(400).json({ error: 'Ce praticien ne propose pas cette prestation' });
      }
    }

    // 3. Check availability
    const availCheck = await checkPracAvailability(bid, new_practitioner_id, bk.start_at, bk.end_at);
    if (!availCheck.ok) {
      return res.status(400).json({ error: 'Praticien non disponible: ' + availCheck.reason });
    }

    // 4. Check booking overlap for the new practitioner
    const overlapCheck = await queryWithRLS(bid,
      `SELECT id FROM bookings
       WHERE business_id = $1 AND practitioner_id = $2
         AND status IN ('confirmed','pending','modified_pending','pending_deposit')
         AND start_at < $4::timestamptz AND end_at > $3::timestamptz
         AND id != $5`,
      [bid, new_practitioner_id, bk.start_at, bk.end_at, booking_id]
    );
    if (overlapCheck.rows.length > 0) {
      return res.status(400).json({ error: 'Créneau occupé pour ce praticien' });
    }

    // 5. Update the booking
    await queryWithRLS(bid,
      `UPDATE bookings SET practitioner_id = $1, updated_at = NOW() WHERE id = $2 AND business_id = $3`,
      [new_practitioner_id, booking_id, bid]
    );

    // 6. Calendar sync
    try { await calSyncPush(bid, booking_id); } catch (e) {
      console.error('[REASSIGN] calSync error:', e.message);
    }

    // 7. Notify client by email
    if (bk.client_email) {
      try {
        const bizResult = await queryWithRLS(bid,
          `SELECT name, email, phone, address, theme FROM businesses WHERE id = $1`, [bid]
        );
        const business = bizResult.rows[0] || { name: 'Genda' };
        const primaryColor = business.theme?.primary_color;

        const startLocal = new Date(bk.start_at).toLocaleString('fr-BE', {
          timeZone: 'Europe/Brussels',
          weekday: 'long', day: 'numeric', month: 'long',
          hour: '2-digit', minute: '2-digit'
        });
        const endLocal = bk.end_at ? new Date(bk.end_at).toLocaleTimeString('fr-BE', {
          timeZone: 'Europe/Brussels', hour: '2-digit', minute: '2-digit'
        }) : null;

        // Build price/promo details
        const priceCents = parseInt(bk.price_cents) || 0;
        const promoDiscount = parseInt(bk.promotion_discount_cents) || 0;
        const promoLabel = bk.promotion_label || '';
        const durationMin = bk.duration_min;
        let detailParts = [];
        if (durationMin) detailParts.push(`${durationMin} min`);
        let priceInfo = '';
        if (priceCents > 0) {
          if (promoDiscount > 0 && promoLabel) {
            const finalPrice = priceCents - promoDiscount;
            priceInfo = `<s style="opacity:.6">${(priceCents / 100).toFixed(2).replace('.', ',')} €</s> ${(finalPrice / 100).toFixed(2).replace('.', ',')} €`;
          } else {
            priceInfo = `${(priceCents / 100).toFixed(2).replace('.', ',')} €`;
          }
          detailParts.push(priceInfo);
        }
        const detailStr = detailParts.length > 0 ? ` (${detailParts.join(' · ')})` : '';
        const promoLine = (promoDiscount > 0 && promoLabel) ? `<div style="font-size:12px;color:#7A7470;margin-top:4px">${escHtml(promoLabel)} : -${(promoDiscount / 100).toFixed(2).replace('.', ',')} €</div>` : '';

        const bodyHTML = `
          <p>Bonjour <strong>${escHtml(bk.client_name || 'cher client')}</strong>,</p>
          <p>Votre rendez-vous a été réassigné à un nouveau praticien :</p>
          <div style="background:#F0FDF4;border-left:4px solid #22C55E;border-radius:6px;padding:14px 16px;margin:16px 0">
            <div style="font-size:14px;font-weight:600;color:#1A1816;margin-bottom:4px">${escHtml(bk.service_name || 'Rendez-vous')}${detailStr}</div>${promoLine}
            <div style="font-size:13px;color:#3D3832">${escHtml(startLocal)}${endLocal ? ' – ' + escHtml(endLocal) : ''}</div>
            <div style="font-size:13px;color:#3D3832;margin-top:4px">
              <span style="text-decoration:line-through;opacity:.6">avec ${escHtml(bk.old_practitioner_name || '—')}</span>
              → <strong>avec ${escHtml(newPrac.display_name)}</strong>
            </div>
          </div>
          <p>Le créneau et la prestation restent inchangés.</p>`;

        const dateShort = new Date(bk.start_at).toLocaleDateString('fr-BE', {
          timeZone: 'Europe/Brussels', day: '2-digit', month: '2-digit'
        });

        const _baseUrl = process.env.APP_BASE_URL || 'https://genda.be';
        const _manageUrl = bk.public_token ? `${_baseUrl}/booking/${bk.public_token}` : null;
        const footerParts = [business.name, business.address, business.phone, business.email].filter(Boolean);
        const html = buildEmailHTML({
          title: 'Votre rendez-vous a été réassigné',
          preheader: `RDV du ${dateShort} réassigné chez ${business.name}`,
          bodyHTML,
          businessName: business.name,
          primaryColor,
          ...(_manageUrl ? { ctaText: 'Gérer mon rendez-vous', ctaUrl: _manageUrl } : {}),
          footerText: `${footerParts.join(' · ')} · Via Genda.be`
        });

        await sendEmail({
          to: bk.client_email,
          toName: bk.client_name,
          subject: `Votre RDV du ${dateShort} — nouveau praticien — ${business.name}`,
          html,
          fromName: business.name,
          replyTo: business.email
        });
      } catch (e) {
        console.error('[REASSIGN] Email error:', e.message);
      }
    }

    res.json({
      reassigned: true,
      booking_id,
      old_practitioner: bk.old_practitioner_name,
      new_practitioner: newPrac.display_name
    });
  } catch (err) { next(err); }
});

// ============================================================
// GET /api/planning/export?month=2026-03&format=csv
// Export planning as CSV
// ============================================================
router.get('/export', requireOwner, async (req, res, next) => {
  try {
    const bid = req.businessId;
    const { dateFrom, dateTo } = parseMonthRange(req.query.month);
    const monthLabel = req.query.month || `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}`;

    // Fetch practitioners
    const pracResult = await queryWithRLS(bid,
      `SELECT id, display_name FROM practitioners WHERE business_id = $1 AND is_active = true ORDER BY display_name`,
      [bid]
    );
    const pracs = pracResult.rows;
    const pracIds = pracs.map(p => p.id);

    // Fetch absences
    const absResult = await queryWithRLS(bid,
      `SELECT sa.* FROM staff_absences sa
       WHERE sa.business_id = $1 AND sa.date_from <= $3::date AND sa.date_to >= $2::date`,
      [bid, dateFrom, dateTo]
    );

    // Build absence map
    const absMap = {};
    absResult.rows.forEach(a => {
      if (!absMap[a.practitioner_id]) absMap[a.practitioner_id] = {};
      const from = new Date(a.date_from);
      const to = new Date(a.date_to);
      for (let d = new Date(from); d <= to; d.setDate(d.getDate() + 1)) {
        const ds = d.toLocaleDateString('en-CA', { timeZone: 'Europe/Brussels' });
        const ep = getEffectivePeriod(d, a.date_from, a.date_to, a.period, a.period_end);
        absMap[a.practitioner_id][ds] = { type: a.type, period: ep };
      }
    });

    // Fetch work days + holidays
    const workDaysMap = await getPractitionerWorkDays(bid, pracIds);
    const holidays = await getHolidays(bid, dateFrom, dateTo);

    const typeLabels = { conge: 'C', maladie: 'M', formation: 'F', autre: 'A' };
    const dayNames = ['Dim', 'Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam'];
    const daysInMonth = new Date(parseInt(dateFrom.slice(0, 4)), parseInt(dateFrom.slice(5, 7)), 0).getDate();

    // Build CSV
    let csv = '\uFEFF'; // BOM for Excel UTF-8
    // Header row: Praticien, then each day
    csv += 'Praticien';
    for (let d = 1; d <= daysInMonth; d++) {
      const dt = new Date(parseInt(dateFrom.slice(0, 4)), parseInt(dateFrom.slice(5, 7)) - 1, d);
      csv += `;${dayNames[dt.getDay()]} ${d}`;
    }
    csv += '\n';

    // Data rows
    pracs.forEach(p => {
      csv += `"${p.display_name.replace(/"/g, '""')}"`;
      const workDays = workDaysMap.get(p.id) || null;

      for (let d = 1; d <= daysInMonth; d++) {
        const dt = new Date(parseInt(dateFrom.slice(0, 4)), parseInt(dateFrom.slice(5, 7)) - 1, d);
        const ds = dt.toLocaleDateString('en-CA', { timeZone: 'Europe/Brussels' });

        if (holidays.dateSet.has(ds)) {
          csv += ';JF';
        } else if (!isWorkDay(dt, workDays, null)) {
          csv += ';—';
        } else {
          const abs = absMap[p.id]?.[ds];
          if (abs) {
            const label = typeLabels[abs.type] || 'A';
            csv += `;${label}${abs.period === 'am' ? '/AM' : abs.period === 'pm' ? '/PM' : ''}`;
          } else {
            csv += ';';
          }
        }
      }
      csv += '\n';
    });

    const filename = `planning-${monthLabel}.csv`;
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(csv);
  } catch (err) { next(err); }
});

// ============================================================
// POST /api/planning/send-planning — send monthly planning by email
// ============================================================
router.post('/send-planning', requireOwner, async (req, res, next) => {
  try {
    const bid = req.businessId;
    const { practitioner_id, month } = req.body;

    if (!practitioner_id) return res.status(400).json({ error: 'Praticien requis' });

    const pracResult = await queryWithRLS(bid,
      `SELECT id, display_name, email FROM practitioners WHERE id = $1 AND business_id = $2`,
      [practitioner_id, bid]
    );
    if (pracResult.rows.length === 0) return res.status(404).json({ error: 'Praticien introuvable' });
    const prac = pracResult.rows[0];
    if (!prac.email) return res.status(400).json({ error: 'Ce praticien n\'a pas d\'adresse email' });

    const { dateFrom, dateTo } = parseMonthRange(month);
    const monthLabel = month || `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}`;
    const [year, mon] = monthLabel.split('-').map(Number);
    const monthNames = ['Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin', 'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre'];
    const monthName = `${monthNames[mon - 1]} ${year}`;

    // Fetch absences
    const absResult = await queryWithRLS(bid,
      `SELECT sa.* FROM staff_absences sa
       WHERE sa.business_id = $1 AND sa.practitioner_id = $2
         AND sa.date_from <= $4::date AND sa.date_to >= $3::date
       ORDER BY sa.date_from`,
      [bid, practitioner_id, dateFrom, dateTo]
    );

    // Fetch work days + holidays
    const workDaysMap = await getPractitionerWorkDays(bid, [practitioner_id]);
    const workDays = workDaysMap.get(practitioner_id) || null;
    const holidays = await getHolidays(bid, dateFrom, dateTo);

    const bizResult = await queryWithRLS(bid,
      `SELECT name, email, theme FROM businesses WHERE id = $1`, [bid]
    );
    const business = bizResult.rows[0] || { name: 'Genda' };

    const typeLabels = { conge: 'Congé', maladie: 'Maladie', formation: 'Formation', autre: 'Autre' };
    const typeColors = { conge: '#3B82F6', maladie: '#EF4444', formation: '#8B5CF6', autre: '#6B7280' };
    const dayNamesShort = ['Dim', 'Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam'];
    const daysInMonth = new Date(year, mon, 0).getDate();

    // Build absence map for this practitioner
    const absMap = {};
    let totalAbsDays = 0;
    const typeCounts = { conge: 0, maladie: 0, formation: 0, autre: 0 };

    absResult.rows.forEach(a => {
      const from = new Date(Math.max(new Date(a.date_from), new Date(dateFrom)));
      const to = new Date(Math.min(new Date(a.date_to), new Date(dateTo)));
      for (let d = new Date(from); d <= to; d.setDate(d.getDate() + 1)) {
        if (!isWorkDay(d, workDays, holidays.dateSet)) continue;
        const ds = d.toLocaleDateString('en-CA', { timeZone: 'Europe/Brussels' });
        const ep = getEffectivePeriod(d, a.date_from, a.date_to, a.period, a.period_end);
        absMap[ds] = { type: a.type, period: ep };
        const dayVal = ep === 'full' ? 1 : 0.5;
        totalAbsDays += dayVal;
        typeCounts[a.type] = (typeCounts[a.type] || 0) + dayVal;
      }
    });

    // Count total working days in month
    let totalWorkDays = 0;
    for (let d = 1; d <= daysInMonth; d++) {
      const dt = new Date(year, mon - 1, d);
      if (isWorkDay(dt, workDays, holidays.dateSet)) totalWorkDays++;
    }

    // Build HTML table for the email
    let tableRows = '';
    for (let d = 1; d <= daysInMonth; d++) {
      const dt = new Date(year, mon - 1, d);
      const ds = dt.toLocaleDateString('en-CA', { timeZone: 'Europe/Brussels' });
      const dayName = dayNamesShort[dt.getDay()];
      const isHoliday = holidays.dateSet.has(ds);
      const isOff = !isWorkDay(dt, workDays, holidays.dateSet);
      const abs = absMap[ds];
      const holidayName = isHoliday ? holidays.list.find(h => h.date === ds)?.name : null;

      let status = '';
      let bgColor = '#FFFFFF';
      if (isHoliday) {
        status = `Férié${holidayName ? ' — ' + escHtml(holidayName) : ''}`;
        bgColor = '#FFF7ED';
      } else if (isOff) {
        status = 'Repos';
        bgColor = '#F9FAFB';
      } else if (abs) {
        status = escHtml(typeLabels[abs.type]) + (abs.period !== 'full' ? ` (${abs.period === 'am' ? 'Matin' : 'Après-midi'})` : '');
        bgColor = abs.type === 'conge' ? '#DBEAFE' : abs.type === 'maladie' ? '#FEE2E2' : abs.type === 'formation' ? '#EDE9FE' : '#F3F4F6';
      }

      tableRows += `<tr style="border-bottom:1px solid #E5E7EB">
        <td style="padding:6px 10px;font-size:13px;color:#374151;font-weight:500;background:${bgColor}">${dayName} ${d}</td>
        <td style="padding:6px 10px;font-size:13px;color:#374151;background:${bgColor}">${status}</td>
      </tr>`;
    }

    // Summary badges
    let summaryHTML = '';
    Object.entries(typeCounts).forEach(([type, count]) => {
      if (count > 0) {
        summaryHTML += `<span style="display:inline-block;padding:3px 10px;margin:2px 4px;border-radius:12px;font-size:12px;font-weight:600;background:${typeColors[type]}20;color:${typeColors[type]}">${escHtml(typeLabels[type])}: ${count % 1 === 0 ? count : count.toFixed(1)}j</span>`;
      }
    });

    const bodyHTML = `
      <p>Bonjour <strong>${escHtml(prac.display_name)}</strong>,</p>
      <p>Voici votre planning pour le mois de <strong>${escHtml(monthName)}</strong> :</p>
      <div style="background:#F5F4F1;border-radius:8px;padding:14px 16px;margin:16px 0">
        <div style="font-size:13px;color:#6B6560;margin-bottom:6px">Jours travaillés : <strong>${totalWorkDays - totalAbsDays}/${totalWorkDays}</strong></div>
        <div style="font-size:13px;color:#6B6560">Absences : <strong>${totalAbsDays % 1 === 0 ? totalAbsDays : totalAbsDays.toFixed(1)} jour${totalAbsDays > 1 ? 's' : ''}</strong></div>
        ${summaryHTML ? `<div style="margin-top:8px">${summaryHTML}</div>` : ''}
      </div>
      <table style="width:100%;border-collapse:collapse;border:1px solid #E5E7EB;border-radius:8px;overflow:hidden;margin:16px 0">
        <thead><tr style="background:#F3F4F6"><th style="padding:8px 10px;font-size:12px;font-weight:600;color:#6B7280;text-align:left">Jour</th><th style="padding:8px 10px;font-size:12px;font-weight:600;color:#6B7280;text-align:left">Statut</th></tr></thead>
        <tbody>${tableRows}</tbody>
      </table>
      <p style="font-size:13px;color:#9C958E">Planning généré automatiquement. Contactez votre responsable pour toute correction.</p>`;

    const html = buildEmailHTML({
      title: `Planning — ${monthName}`,
      preheader: `Votre planning ${monthName}`,
      bodyHTML,
      businessName: business.name,
      primaryColor: business.theme?.primary_color,
      footerText: `${business.name} · Via Genda.be`
    });

    const emailResult = await sendEmail({
      to: prac.email,
      toName: prac.display_name,
      subject: `Planning ${monthName} — ${business.name}`,
      html,
      fromName: business.name,
      replyTo: business.email
    });

    if (emailResult.success) {
      res.json({ sent: true, to: prac.email });
    } else {
      res.status(500).json({ error: emailResult.error || 'Erreur d\'envoi' });
    }
  } catch (err) { next(err); }
});

module.exports = router;
