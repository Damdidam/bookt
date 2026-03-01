const router = require('express').Router();
const { queryWithRLS } = require('../../services/db');
const { requireAuth } = require('../../middleware/auth');

router.use(requireAuth);

// GET /api/featured-slots — list featured slots
// Query: ?practitioner_id=X&week_start=2026-03-02
router.get('/', async (req, res, next) => {
  try {
    const bid = req.businessId;
    const { practitioner_id, week_start } = req.query;

    let sql = `
      SELECT fs.*, p.display_name AS practitioner_name
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
// Body: { practitioner_id, week_start, slots: [{date, start_time, end_time}] }
router.put('/', async (req, res, next) => {
  try {
    const bid = req.businessId;
    const { practitioner_id, week_start, slots } = req.body;

    if (!practitioner_id || !week_start) {
      return res.status(400).json({ error: 'practitioner_id et week_start requis' });
    }

    // Delete existing for this practitioner + week
    await queryWithRLS(bid,
      `DELETE FROM featured_slots
       WHERE business_id = $1 AND practitioner_id = $2
         AND date >= $3::date AND date < ($3::date + interval '7 days')`,
      [bid, practitioner_id, week_start]
    );

    // Insert new slots
    if (slots && slots.length > 0) {
      for (const s of slots) {
        await queryWithRLS(bid,
          `INSERT INTO featured_slots (business_id, practitioner_id, date, start_time, end_time)
           VALUES ($1, $2, $3, $4, $5)`,
          [bid, practitioner_id, s.date, s.start_time, s.end_time]
        );
      }
    }

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

module.exports = router;
