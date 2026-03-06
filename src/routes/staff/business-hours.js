/**
 * Business Hours routes — salon-level opening hours & exceptional closures.
 * Mounted at /api/business-hours
 */
const router = require('express').Router();
const { queryWithRLS, transactionWithRLS } = require('../../services/db');

// GET /api/business-hours — salon schedule + closures
router.get('/', async (req, res, next) => {
  try {
    const bid = req.businessId;

    const [schedResult, closureResult] = await Promise.all([
      queryWithRLS(bid,
        `SELECT id, weekday, start_time, end_time
         FROM business_schedule
         WHERE business_id = $1 AND is_active = true
         ORDER BY weekday, start_time`,
        [bid]
      ),
      queryWithRLS(bid,
        `SELECT id, date_from, date_to, reason, created_at
         FROM business_closures
         WHERE business_id = $1 AND date_to >= CURRENT_DATE
         ORDER BY date_from`,
        [bid]
      )
    ]);

    // Group schedule by weekday (same pattern as GET /api/availabilities)
    const schedule = {};
    for (const row of schedResult.rows) {
      if (!schedule[row.weekday]) schedule[row.weekday] = [];
      schedule[row.weekday].push({
        id: row.id,
        start_time: row.start_time,
        end_time: row.end_time
      });
    }

    res.json({ schedule, closures: closureResult.rows });
  } catch (err) { next(err); }
});

// PUT /api/business-hours — save salon weekly schedule (atomic replace)
router.put('/', async (req, res, next) => {
  try {
    const bid = req.businessId;
    const { schedule } = req.body;

    if (!schedule) {
      return res.status(400).json({ error: 'schedule requis' });
    }

    // Admin/owner only
    if (req.user.role === 'practitioner') {
      return res.status(403).json({ error: 'Seul un administrateur peut modifier les horaires du salon' });
    }

    await transactionWithRLS(bid, async (client) => {
      // Delete existing schedule
      await client.query(
        `DELETE FROM business_schedule WHERE business_id = $1`,
        [bid]
      );

      // Insert new schedule
      for (const [weekday, windows] of Object.entries(schedule)) {
        const weekdayNum = parseInt(weekday);
        if (isNaN(weekdayNum) || weekdayNum < 0 || weekdayNum > 6) continue;

        for (const win of windows) {
          if (!win.start_time || !win.end_time) continue;
          await client.query(
            `INSERT INTO business_schedule (business_id, weekday, start_time, end_time)
             VALUES ($1, $2, $3, $4)`,
            [bid, weekdayNum, win.start_time, win.end_time]
          );
        }
      }
    });

    res.json({ updated: true });
  } catch (err) { next(err); }
});

// ===== CLOSURES =====

// POST /api/business-hours/closures — add an exceptional closure
router.post('/closures', async (req, res, next) => {
  try {
    const bid = req.businessId;
    const { date_from, date_to, reason } = req.body;

    if (!date_from || !date_to) {
      return res.status(400).json({ error: 'date_from et date_to requis' });
    }

    if (req.user.role === 'practitioner') {
      return res.status(403).json({ error: 'Seul un administrateur peut ajouter une fermeture' });
    }

    const result = await queryWithRLS(bid,
      `INSERT INTO business_closures (business_id, date_from, date_to, reason)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [bid, date_from, date_to, reason || null]
    );

    res.status(201).json({ closure: result.rows[0] });
  } catch (err) { next(err); }
});

// DELETE /api/business-hours/closures/:id — remove a closure
router.delete('/closures/:id', async (req, res, next) => {
  try {
    if (req.user.role === 'practitioner') {
      return res.status(403).json({ error: 'Seul un administrateur peut supprimer une fermeture' });
    }

    await queryWithRLS(req.businessId,
      `DELETE FROM business_closures WHERE id = $1 AND business_id = $2`,
      [req.params.id, req.businessId]
    );
    res.json({ deleted: true });
  } catch (err) { next(err); }
});

module.exports = router;
