const router = require('express').Router();
const { queryWithRLS, transactionWithRLS } = require('../../services/db');
const { requireAuth } = require('../../middleware/auth');

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
router.put('/', async (req, res, next) => {
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
      return res.status(404).json({ error: 'Praticien introuvable dans ce cabinet' });
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
      for (const [weekday, windows] of Object.entries(schedule)) {
        // V12-009: Validate weekday range
        const weekdayNum = parseInt(weekday);
        if (isNaN(weekdayNum) || weekdayNum < 0 || weekdayNum > 6) continue;

        for (const win of windows) {
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
router.post('/exceptions', async (req, res, next) => {
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
router.delete('/exceptions/:id', async (req, res, next) => {
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

module.exports = router;
