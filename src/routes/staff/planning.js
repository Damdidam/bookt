const router = require('express').Router();
const { queryWithRLS } = require('../../services/db');
const { requireAuth, requireOwner } = require('../../middleware/auth');

router.use(requireAuth);

// ============================================================
// GET /api/planning/absences?month=2026-03
// Returns absences for the given month (or current month)
// ============================================================
router.get('/absences', async (req, res, next) => {
  try {
    const bid = req.businessId;
    const monthParam = req.query.month; // e.g. "2026-03"
    let dateFrom, dateTo;

    if (monthParam && /^\d{4}-\d{2}$/.test(monthParam)) {
      dateFrom = `${monthParam}-01`;
      const [y, m] = monthParam.split('-').map(Number);
      const lastDay = new Date(y, m, 0).getDate();
      dateTo = `${monthParam}-${String(lastDay).padStart(2, '0')}`;
    } else {
      const now = new Date();
      const y = now.getFullYear();
      const m = String(now.getMonth() + 1).padStart(2, '0');
      dateFrom = `${y}-${m}-01`;
      const lastDay = new Date(y, now.getMonth() + 1, 0).getDate();
      dateTo = `${y}-${m}-${String(lastDay).padStart(2, '0')}`;
    }

    const result = await queryWithRLS(bid,
      `SELECT sa.*, p.display_name AS practitioner_name, p.color AS practitioner_color
       FROM staff_absences sa
       JOIN practitioners p ON p.id = sa.practitioner_id
       WHERE sa.business_id = $1
         AND sa.date_from <= $3::date
         AND sa.date_to >= $2::date
       ORDER BY sa.date_from`,
      [bid, dateFrom, dateTo]
    );

    res.json({ absences: result.rows });
  } catch (err) { next(err); }
});

// ============================================================
// GET /api/planning/absences/:id — single absence
// ============================================================
router.get('/absences/:id', async (req, res, next) => {
  try {
    const bid = req.businessId;
    const result = await queryWithRLS(bid,
      `SELECT sa.*, p.display_name AS practitioner_name
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
    const { practitioner_id, date_from, date_to, type, note } = req.body;

    if (!practitioner_id) return res.status(400).json({ error: 'Praticien requis' });
    if (!date_from || !date_to) return res.status(400).json({ error: 'Dates requises' });
    if (date_from > date_to) return res.status(400).json({ error: 'Date de début doit être avant la date de fin' });

    const validTypes = ['conge', 'maladie', 'formation', 'autre'];
    const absType = validTypes.includes(type) ? type : 'conge';

    // Check practitioner belongs to this business
    const pracCheck = await queryWithRLS(bid,
      `SELECT id FROM practitioners WHERE id = $1 AND business_id = $2`,
      [practitioner_id, bid]
    );
    if (pracCheck.rows.length === 0) return res.status(404).json({ error: 'Praticien introuvable' });

    // Check for overlapping absences
    const overlap = await queryWithRLS(bid,
      `SELECT id FROM staff_absences
       WHERE business_id = $1 AND practitioner_id = $2
         AND date_from <= $4::date AND date_to >= $3::date`,
      [bid, practitioner_id, date_from, date_to]
    );
    if (overlap.rows.length > 0) {
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
      `INSERT INTO staff_absences (business_id, practitioner_id, date_from, date_to, type, note)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [bid, practitioner_id, date_from, date_to, absType, note || null]
    );

    res.status(201).json({
      absence: result.rows[0],
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
    const { date_from, date_to, type, note } = req.body;

    const sets = [];
    const params = [id, bid];
    let idx = 3;

    if (date_from !== undefined) { sets.push(`date_from = $${idx}`); params.push(date_from); idx++; }
    if (date_to !== undefined) { sets.push(`date_to = $${idx}`); params.push(date_to); idx++; }
    if (type !== undefined) { sets.push(`type = $${idx}`); params.push(type); idx++; }
    if (note !== undefined) { sets.push(`note = $${idx}`); params.push(note); idx++; }

    if (sets.length === 0) return res.status(400).json({ error: 'Rien à modifier' });
    sets.push('updated_at = NOW()');

    const result = await queryWithRLS(bid,
      `UPDATE staff_absences SET ${sets.join(', ')} WHERE id = $1 AND business_id = $2 RETURNING *`,
      params
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Absence introuvable' });

    res.json({ absence: result.rows[0] });
  } catch (err) { next(err); }
});

// ============================================================
// DELETE /api/planning/absences/:id — delete absence
// ============================================================
router.delete('/absences/:id', requireOwner, async (req, res, next) => {
  try {
    const bid = req.businessId;
    const result = await queryWithRLS(bid,
      `DELETE FROM staff_absences WHERE id = $1 AND business_id = $2 RETURNING id`,
      [req.params.id, bid]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Absence introuvable' });
    res.json({ deleted: true });
  } catch (err) { next(err); }
});

// ============================================================
// GET /api/planning/impact?practitioner_id=xxx&date_from=...&date_to=...
// Preview impact before creating absence
// ============================================================
router.get('/impact', async (req, res, next) => {
  try {
    const bid = req.businessId;
    const { practitioner_id, date_from, date_to } = req.query;

    if (!practitioner_id || !date_from || !date_to) {
      return res.status(400).json({ error: 'practitioner_id, date_from, date_to requis' });
    }

    // Impacted bookings
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

    res.json({
      impacted_bookings: bookings.rows,
      count: bookings.rows.length
    });
  } catch (err) { next(err); }
});

module.exports = router;
