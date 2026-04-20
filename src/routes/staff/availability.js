const router = require('express').Router();
const { queryWithRLS, transactionWithRLS } = require('../../services/db');
const { requireAuth, requireOwner, blockIfImpersonated } = require('../../middleware/auth');

router.use(requireAuth);

// GET /api/availabilities — weekly schedule for all practitioners
// UI: Dashboard > Disponibilités grid
router.get('/', async (req, res, next) => {
  try {
    const bid = req.businessId;
    const { practitioner_id } = req.query;

    let sql = `
      SELECT a.*, p.display_name AS practitioner_name
      FROM availabilities a
      JOIN practitioners p ON p.id = a.practitioner_id
      WHERE a.business_id = $1`;
    const params = [bid];

    if (practitioner_id) {
      sql += ' AND a.practitioner_id = $2';
      params.push(practitioner_id);
    }

    sql += ' ORDER BY a.practitioner_id, a.weekday, a.start_time';

    const result = await queryWithRLS(bid, sql, params);

    // Group by practitioner
    const byPractitioner = {};
    for (const row of result.rows) {
      if (!byPractitioner[row.practitioner_id]) {
        byPractitioner[row.practitioner_id] = {
          practitioner_name: row.practitioner_name,
          schedule: {}
        };
      }
      const weekday = row.weekday;
      if (!byPractitioner[row.practitioner_id].schedule[weekday]) {
        byPractitioner[row.practitioner_id].schedule[weekday] = [];
      }
      byPractitioner[row.practitioner_id].schedule[weekday].push({
        id: row.id,
        start_time: row.start_time,
        end_time: row.end_time,
        is_active: row.is_active
      });
    }

    res.json({ availabilities: byPractitioner });
  } catch (err) {
    next(err);
  }
});

// PUT /api/availabilities — replace full schedule for a practitioner
// UI: Disponibilités grid → "Enregistrer"
router.put('/', blockIfImpersonated, async (req, res, next) => {
  try {
    const bid = req.businessId;
    const { practitioner_id, schedule } = req.body;

    if (!practitioner_id || !schedule) {
      return res.status(400).json({ error: 'practitioner_id et schedule requis' });
    }

    // Practitioner can only update their own schedule
    if (req.user.role === 'practitioner' && practitioner_id !== req.user.practitionerId) {
      return res.status(403).json({ error: 'Vous ne pouvez modifier que votre propre disponibilité' });
    }

    // V11-004: Verify practitioner belongs to this business
    const pracCheck = await queryWithRLS(bid,
      `SELECT id FROM practitioners WHERE id = $1 AND business_id = $2`,
      [practitioner_id, bid]
    );
    if (pracCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Praticien introuvable dans ce salon' });
    }

    // V11-003: Wrap DELETE + INSERT in a transaction for atomicity
    await transactionWithRLS(bid, async (client) => {
      // Delete existing schedule
      await client.query(
        `DELETE FROM availabilities WHERE business_id = $1 AND practitioner_id = $2`,
        [bid, practitioner_id]
      );

      // Insert new schedule
      // schedule = { "0": [{ start_time: "09:00", end_time: "12:00" }, ...], "1": [...], ... }
      const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
      for (const [weekday, windows] of Object.entries(schedule)) {
        // V12-009: Validate weekday range
        const weekdayNum = parseInt(weekday);
        if (isNaN(weekdayNum) || weekdayNum < 0 || weekdayNum > 6) continue;

        // Validate time format + detect overlaps
        const validWindows = [];
        for (const win of windows) {
          if (!TIME_RE.test(win.start_time) || !TIME_RE.test(win.end_time)) continue;
          if (win.start_time >= win.end_time) continue;
          // Check overlap with already-added windows for this weekday
          const hasOverlap = validWindows.some(v => win.start_time < v.end_time && win.end_time > v.start_time);
          if (hasOverlap) continue;
          validWindows.push(win);
        }

        for (const win of validWindows) {
          await client.query(
            `INSERT INTO availabilities (business_id, practitioner_id, weekday, start_time, end_time)
             VALUES ($1, $2, $3, $4, $5)`,
            [bid, practitioner_id, weekdayNum, win.start_time, win.end_time]
          );
        }
      }
    });

    res.json({ updated: true });
  } catch (err) {
    next(err);
  }
});

// ===== EXCEPTIONS =====

// GET /api/availability-exceptions
router.get('/exceptions', async (req, res, next) => {
  try {
    const bid = req.businessId;
    const result = await queryWithRLS(bid,
      `SELECT ae.*, p.display_name AS practitioner_name
       FROM availability_exceptions ae
       JOIN practitioners p ON p.id = ae.practitioner_id
       WHERE ae.business_id = $1 AND ae.date >= CURRENT_DATE
       ORDER BY ae.date`,
      [bid]
    );
    res.json({ exceptions: result.rows });
  } catch (err) {
    next(err);
  }
});

// POST /api/availability-exceptions
router.post('/exceptions', blockIfImpersonated, async (req, res, next) => {
  try {
    const bid = req.businessId;
    const { practitioner_id, date, type, start_time, end_time, note } = req.body;

    if (!practitioner_id || !date) {
      return res.status(400).json({ error: 'practitioner_id et date requis' });
    }

    // Practitioner can only create exceptions for themselves
    if (req.user.role === 'practitioner' && practitioner_id !== req.user.practitionerId) {
      return res.status(403).json({ error: 'Vous ne pouvez créer des exceptions que pour vous-même' });
    }

    // V12-008: Validate practitioner belongs to this business
    const pracCheck = await queryWithRLS(bid,
      `SELECT id FROM practitioners WHERE id = $1 AND business_id = $2`,
      [practitioner_id, bid]
    );
    if (pracCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Praticien introuvable' });
    }

    const result = await queryWithRLS(bid,
      `INSERT INTO availability_exceptions
        (business_id, practitioner_id, date, type, start_time, end_time, note)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [bid, practitioner_id, date, type || 'closed',
       start_time || null, end_time || null, note || null]
    );

    res.status(201).json({ exception: result.rows[0] });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/availability-exceptions/:id
router.delete('/exceptions/:id', blockIfImpersonated, async (req, res, next) => {
  try {
    // V13-015: Add practitioner ownership check for practitioner role
    let sql = `DELETE FROM availability_exceptions WHERE id = $1 AND business_id = $2`;
    const params = [req.params.id, req.businessId];
    if (req.user.role === 'practitioner') {
      sql += ` AND practitioner_id = $3`;
      params.push(req.user.practitionerId);
    }
    await queryWithRLS(req.businessId, sql, params);
    res.json({ deleted: true });
  } catch (err) {
    next(err);
  }
});

// ===== HOLIDAYS (jours fériés) =====

/**
 * Compute Easter Sunday for a given year (Anonymous Gregorian algorithm / Meeus).
 * Returns a Date object.
 */
function computeEaster(year) {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(year, month - 1, day);
}

/**
 * Get Belgian legal holidays for a given year.
 * Returns array of { date: 'YYYY-MM-DD', name: '...' }
 */
function getBelgianHolidays(year) {
  const fmt = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const addDays = (d, n) => { const r = new Date(d); r.setDate(r.getDate() + n); return r; };

  const easter = computeEaster(year);

  return [
    { date: `${year}-01-01`, name: 'Nouvel An' },
    { date: fmt(addDays(easter, 1)), name: 'Lundi de Pâques' },
    { date: `${year}-05-01`, name: 'Fête du Travail' },
    { date: fmt(addDays(easter, 39)), name: 'Ascension' },
    { date: fmt(addDays(easter, 50)), name: 'Lundi de Pentecôte' },
    { date: `${year}-07-21`, name: 'Fête nationale' },
    { date: `${year}-08-15`, name: 'Assomption' },
    { date: `${year}-11-01`, name: 'Toussaint' },
    { date: `${year}-11-11`, name: 'Armistice' },
    { date: `${year}-12-25`, name: 'Noël' }
  ];
}

// GET /api/availabilities/holidays?year=2026
router.get('/holidays', async (req, res, next) => {
  try {
    const bid = req.businessId;
    const year = req.query.year || new Date().getFullYear();
    const result = await queryWithRLS(bid,
      `SELECT * FROM business_holidays
       WHERE business_id = $1 AND EXTRACT(YEAR FROM date) = $2
       ORDER BY date`,
      [bid, year]
    );
    res.json({ holidays: result.rows });
  } catch (err) { next(err); }
});

// POST /api/availabilities/holidays — add a single holiday (owner only)
router.post('/holidays', requireOwner, blockIfImpersonated, async (req, res, next) => {
  try {
    const bid = req.businessId;
    const { date, name } = req.body;
    if (!date || !name) return res.status(400).json({ error: 'Date et nom requis' });

    const result = await queryWithRLS(bid,
      `INSERT INTO business_holidays (business_id, date, name)
       VALUES ($1, $2, $3)
       ON CONFLICT (business_id, date) DO UPDATE SET name = EXCLUDED.name
       RETURNING *`,
      [bid, date, name]
    );
    res.status(201).json({ holiday: result.rows[0] });
  } catch (err) { next(err); }
});

// DELETE /api/availabilities/holidays/:id (owner only)
router.delete('/holidays/:id', requireOwner, blockIfImpersonated, async (req, res, next) => {
  try {
    await queryWithRLS(req.businessId,
      `DELETE FROM business_holidays WHERE id = $1 AND business_id = $2`,
      [req.params.id, req.businessId]
    );
    res.json({ deleted: true });
  } catch (err) { next(err); }
});

// POST /api/availabilities/holidays/prefill — prefill Belgian legal holidays (owner only)
router.post('/holidays/prefill', requireOwner, blockIfImpersonated, async (req, res, next) => {
  try {
    const bid = req.businessId;
    const year = parseInt(req.body.year) || new Date().getFullYear();
    const holidays = getBelgianHolidays(year);

    // Insert in parallel — each row independent
    const _results = await Promise.all(holidays.map(h => queryWithRLS(bid,
        `INSERT INTO business_holidays (business_id, date, name)
         VALUES ($1, $2, $3)
         ON CONFLICT (business_id, date) DO NOTHING
         RETURNING id`,
        [bid, h.date, h.name]
      )));
    const inserted = _results.reduce((acc, r) => acc + (r.rows.length > 0 ? 1 : 0), 0);

    res.json({ inserted, total: holidays.length, year });
  } catch (err) { next(err); }
});

module.exports = router;
