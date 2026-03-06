const router = require('express').Router();
const { queryWithRLS, transactionWithRLS } = require('../../services/db');
const { requireAuth } = require('../../middleware/auth');

router.use(requireAuth);

// GET /api/featured-slots — list featured slots
// Query: ?practitioner_id=X&week_start=2026-03-02
router.get('/', async (req, res, next) => {
  try {
    const bid = req.businessId;
    const { practitioner_id, week_start } = req.query;

    let sql = `
      SELECT fs.id, fs.practitioner_id, fs.date, fs.start_time, fs.created_at,
             p.display_name AS practitioner_name
      FROM featured_slots fs
      JOIN practitioners p ON p.id = fs.practitioner_id
      WHERE fs.business_id = $1`;
    const params = [bid];

    if (practitioner_id) {
      params.push(practitioner_id);
      sql += ` AND fs.practitioner_id = $${params.length}`;
    }

    if (week_start) {
      params.push(week_start);
      sql += ` AND fs.date >= $${params.length}::date`;
      params.push(week_start);
      sql += ` AND fs.date < ($${params.length}::date + interval '7 days')`;
    } else {
      sql += ` AND fs.date >= CURRENT_DATE`;
    }

    sql += ' ORDER BY fs.date, fs.start_time';

    const result = await queryWithRLS(bid, sql, params);
    res.json({ featured_slots: result.rows });
  } catch (err) {
    next(err);
  }
});

// PUT /api/featured-slots — replace featured slots for a practitioner + week
// Body: { practitioner_id, week_start, slots: [{date, start_time}] }
router.put('/', async (req, res, next) => {
  try {
    const bid = req.businessId;
    const { practitioner_id, week_start, slots } = req.body;

    if (!practitioner_id || !week_start) {
      return res.status(400).json({ error: 'practitioner_id et week_start requis' });
    }

    // Practitioner can only update their own featured slots
    if (req.user.role === 'practitioner' && practitioner_id !== req.user.practitionerId) {
      return res.status(403).json({ error: 'Vous ne pouvez modifier que vos propres créneaux vedettes' });
    }

    // Auto-enable featured mode if not yet active
    const pracCheck = await queryWithRLS(bid,
      `SELECT featured_enabled FROM practitioners WHERE id = $1 AND business_id = $2`,
      [practitioner_id, bid]
    );
    if (pracCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Praticien introuvable' });
    }
    if (!pracCheck.rows[0].featured_enabled) {
      await queryWithRLS(bid,
        `UPDATE practitioners SET featured_enabled = true WHERE id = $1 AND business_id = $2`,
        [practitioner_id, bid]
      );
    }

    // V11-005: Wrap DELETE + INSERT in a transaction for atomicity
    await transactionWithRLS(bid, async (client) => {
      // Delete existing for this practitioner + week
      await client.query(
        `DELETE FROM featured_slots
         WHERE business_id = $1 AND practitioner_id = $2
           AND date >= $3::date AND date < ($3::date + interval '7 days')`,
        [bid, practitioner_id, week_start]
      );

      // Insert new slots (start_time only, no end_time)
      if (slots && slots.length > 0) {
        for (const s of slots) {
          await client.query(
            `INSERT INTO featured_slots (business_id, practitioner_id, date, start_time)
             VALUES ($1, $2, $3, $4)`,
            [bid, practitioner_id, s.date, s.start_time]
          );
        }
      }
    });

    res.json({ updated: true, count: (slots || []).length });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/featured-slots — remove all featured slots for a practitioner + week
// Query: ?practitioner_id=X&week_start=2026-03-02
router.delete('/', async (req, res, next) => {
  try {
    const bid = req.businessId;
    const { practitioner_id, week_start } = req.query;

    if (!practitioner_id || !week_start) {
      return res.status(400).json({ error: 'practitioner_id et week_start requis' });
    }

    // Practitioner can only delete their own featured slots
    if (req.user.role === 'practitioner' && practitioner_id !== req.user.practitionerId) {
      return res.status(403).json({ error: 'Vous ne pouvez supprimer que vos propres créneaux vedettes' });
    }

    await queryWithRLS(bid,
      `DELETE FROM featured_slots
       WHERE business_id = $1 AND practitioner_id = $2
         AND date >= $3::date AND date < ($3::date + interval '7 days')`,
      [bid, practitioner_id, week_start]
    );

    res.json({ deleted: true });
  } catch (err) {
    next(err);
  }
});

// ============================================================
// LOCKED WEEKS
// ============================================================

// GET /api/featured-slots/lock — check if week is locked
// Query: ?practitioner_id=X&week_start=2026-03-02
router.get('/lock', async (req, res, next) => {
  try {
    const bid = req.businessId;
    const { practitioner_id, week_start } = req.query;

    if (!practitioner_id || !week_start) {
      return res.status(400).json({ error: 'practitioner_id et week_start requis' });
    }

    const result = await queryWithRLS(bid,
      `SELECT * FROM locked_weeks
       WHERE business_id = $1 AND practitioner_id = $2 AND week_start = $3::date`,
      [bid, practitioner_id, week_start]
    );

    res.json({ locked: result.rows.length > 0, lock: result.rows[0] || null });
  } catch (err) {
    next(err);
  }
});

// PUT /api/featured-slots/lock — lock a week
// Body: { practitioner_id, week_start }
router.put('/lock', async (req, res, next) => {
  try {
    const bid = req.businessId;
    const { practitioner_id, week_start } = req.body;

    if (!practitioner_id || !week_start) {
      return res.status(400).json({ error: 'practitioner_id et week_start requis' });
    }

    // V12-012: Practitioner can only lock their own weeks
    if (req.user.role === 'practitioner' && practitioner_id !== req.user.practitionerId) {
      return res.status(403).json({ error: 'Vous ne pouvez verrouiller que vos propres semaines' });
    }

    // Auto-enable featured mode if not yet active
    const pracLockCheck = await queryWithRLS(bid,
      `SELECT featured_enabled FROM practitioners WHERE id = $1 AND business_id = $2`,
      [practitioner_id, bid]
    );
    if (pracLockCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Praticien introuvable' });
    }
    if (!pracLockCheck.rows[0].featured_enabled) {
      await queryWithRLS(bid,
        `UPDATE practitioners SET featured_enabled = true WHERE id = $1 AND business_id = $2`,
        [practitioner_id, bid]
      );
    }

    await queryWithRLS(bid,
      `INSERT INTO locked_weeks (business_id, practitioner_id, week_start)
       VALUES ($1, $2, $3::date)
       ON CONFLICT (business_id, practitioner_id, week_start) DO NOTHING`,
      [bid, practitioner_id, week_start]
    );

    res.json({ locked: true });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/featured-slots/lock — unlock a week
// Query: ?practitioner_id=X&week_start=2026-03-02
router.delete('/lock', async (req, res, next) => {
  try {
    const bid = req.businessId;
    const { practitioner_id, week_start } = req.query;

    if (!practitioner_id || !week_start) {
      return res.status(400).json({ error: 'practitioner_id et week_start requis' });
    }

    // V12-012: Practitioner can only unlock their own weeks
    if (req.user.role === 'practitioner' && practitioner_id !== req.user.practitionerId) {
      return res.status(403).json({ error: 'Vous ne pouvez verrouiller que vos propres semaines' });
    }

    await queryWithRLS(bid,
      `DELETE FROM locked_weeks
       WHERE business_id = $1 AND practitioner_id = $2 AND week_start = $3::date`,
      [bid, practitioner_id, week_start]
    );

    res.json({ locked: false });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
