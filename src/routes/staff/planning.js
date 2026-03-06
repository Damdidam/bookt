const router = require('express').Router();
const { queryWithRLS } = require('../../services/db');
const { requireAuth, requireOwner } = require('../../middleware/auth');
const { sendEmail, buildEmailHTML, escHtml } = require('../../services/email');

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
  const dayStr = dayDate.toISOString().slice(0, 10);
  const fromStr = new Date(absDateFrom).toISOString().slice(0, 10);
  const toStr = new Date(absDateTo).toISOString().slice(0, 10);
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
    const ds = date.toISOString().slice(0, 10);
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
      const ds = new Date(r.date).toISOString().slice(0, 10);
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

    // Fetch work days + holidays for overlap check
    const workDaysMap = await getPractitionerWorkDays(bid, [practitioner_id]);
    const workDays = workDaysMap.get(practitioner_id) || null;
    const holidays = await getHolidays(bid, date_from, date_to);

    // Fetch all existing absences that could overlap (date range intersection)
    const existingAbs = await queryWithRLS(bid,
      `SELECT id, date_from, date_to, period, period_end FROM staff_absences
       WHERE business_id = $1 AND practitioner_id = $2
         AND date_from <= $4::date AND date_to >= $3::date`,
      [bid, practitioner_id, date_from, date_to]
    );

    // Day-by-day overlap check (skips non-working days and holidays)
    if (hasOverlapConflict(existingAbs.rows, date_from, date_to, absPeriod, absPeriodEnd, null, workDays, holidays.dateSet)) {
      return res.status(409).json({ error: 'Une absence existe déjà sur cette période pour ce praticien' });
    }

    // Count impacted bookings
    const impacted = await queryWithRLS(bid,
      `SELECT COUNT(*) AS cnt FROM bookings
       WHERE business_id = $1 AND practitioner_id = $2
         AND start_at::date >= $3::date AND start_at::date <= $4::date
         AND status IN ('confirmed', 'pending')`,
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
      date_from, date_to, practitioner: pracName
    }, req.user?.name || req.user?.email || 'Système');

    res.status(201).json({
      absence,
      impacted_bookings: parseInt(impacted.rows[0].cnt)
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

    // Fetch work days + holidays
    const workDaysMap = await getPractitionerWorkDays(bid, [old.practitioner_id]);
    const workDays = workDaysMap.get(old.practitioner_id) || null;
    const holidays = await getHolidays(bid, newFrom, newTo);

    const existingAbs = await queryWithRLS(bid,
      `SELECT id, date_from, date_to, period, period_end FROM staff_absences
       WHERE business_id = $1 AND practitioner_id = $2
         AND date_from <= $4::date AND date_to >= $3::date`,
      [bid, old.practitioner_id, newFrom, newTo]
    );

    if (hasOverlapConflict(existingAbs.rows, newFrom, newTo, newPeriod, newPeriodEnd, id, workDays, holidays.dateSet)) {
      return res.status(409).json({ error: 'Une absence existe déjà sur cette période pour ce praticien' });
    }

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
    const { practitioner_id, date_from, date_to } = req.query;

    if (!practitioner_id || !date_from || !date_to) {
      return res.status(400).json({ error: 'practitioner_id, date_from, date_to requis' });
    }

    const bookings = await queryWithRLS(bid,
      `SELECT b.id, b.start_at, b.end_at, b.status,
              c.full_name AS client_name, s.name AS service_name
       FROM bookings b
       LEFT JOIN clients c ON c.id = b.client_id
       LEFT JOIN services s ON s.id = b.service_id
       WHERE b.business_id = $1 AND b.practitioner_id = $2
         AND b.start_at::date >= $3::date AND b.start_at::date <= $4::date
         AND b.status IN ('confirmed', 'pending')
       ORDER BY b.start_at`,
      [bid, practitioner_id, date_from, date_to]
    );

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

    res.json({
      impacted_bookings: bookings.rows,
      count: bookings.rows.length,
      coverage: uncoveredServices.length === 0 ? 'ok' : 'at_risk',
      uncovered_services: uncoveredServices
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
        const ds = d.toISOString().slice(0, 10);
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
        const ds = dt.toISOString().slice(0, 10);

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
        const ds = d.toISOString().slice(0, 10);
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
      const ds = dt.toISOString().slice(0, 10);
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
