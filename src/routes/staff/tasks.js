/**
 * Internal Tasks — CRUD for calendar tasks (no client attached).
 */
const router = require('express').Router();
const { queryWithRLS } = require('../../services/db');
const { requireAuth, resolvePractitionerScope } = require('../../middleware/auth');
const { broadcast } = require('../../services/sse');

router.use(requireAuth);
router.use(resolvePractitionerScope);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HEX_RE = /^#[0-9a-fA-F]{3,8}$/;

// ============================================================
// GET /api/tasks — list tasks (for calendar)
// ============================================================
router.get('/', async (req, res, next) => {
  try {
    const { from, to, practitioner_id } = req.query;
    const bid = req.businessId;
    const effectivePracId = req.practitionerFilter || practitioner_id;

    let sql = `
      SELECT t.*, p.display_name AS practitioner_name, p.color AS practitioner_color
      FROM internal_tasks t
      JOIN practitioners p ON p.id = t.practitioner_id
      WHERE t.business_id = $1`;
    const params = [bid];
    let idx = 2;

    if (from) { sql += ` AND t.start_at >= $${idx}`; params.push(from); idx++; }
    if (to) { sql += ` AND t.start_at <= $${idx}`; params.push(to); idx++; }
    if (effectivePracId) { sql += ` AND t.practitioner_id = $${idx}`; params.push(effectivePracId); idx++; }

    sql += ` ORDER BY t.start_at LIMIT 500`;

    const result = await queryWithRLS(bid, sql, params);
    res.json({ tasks: result.rows });
  } catch (err) { next(err); }
});

// ============================================================
// POST /api/tasks — create task
// ============================================================
router.post('/', async (req, res, next) => {
  try {
    const bid = req.businessId;
    const { title, start_at, end_at, practitioner_id, color, note } = req.body;

    if (!title || !title.trim()) return res.status(400).json({ error: 'Titre requis' });
    if (title.length > 150) return res.status(400).json({ error: 'Titre trop long (150 max)' });
    if (!start_at || !end_at) return res.status(400).json({ error: 'Dates requises' });
    if (new Date(end_at) <= new Date(start_at)) return res.status(400).json({ error: 'Fin doit être après début' });
    if (!practitioner_id || !UUID_RE.test(practitioner_id)) return res.status(400).json({ error: 'Praticien requis' });
    if (color && !HEX_RE.test(color)) return res.status(400).json({ error: 'Couleur invalide' });

    const result = await queryWithRLS(bid,
      `INSERT INTO internal_tasks (business_id, practitioner_id, title, start_at, end_at, color, note, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [bid, practitioner_id, title.trim(), start_at, end_at, color || null, note || null, req.userId]
    );

    broadcast(bid, 'booking_update', { action: 'task_created' });
    res.status(201).json(result.rows[0]);
  } catch (err) { next(err); }
});

// ============================================================
// GET /api/tasks/:id — single task
// ============================================================
router.get('/:id', async (req, res, next) => {
  try {
    const bid = req.businessId;
    const id = req.params.id;
    if (!UUID_RE.test(id)) return res.status(400).json({ error: 'ID invalide' });

    const result = await queryWithRLS(bid,
      `SELECT t.*, p.display_name AS practitioner_name
       FROM internal_tasks t
       JOIN practitioners p ON p.id = t.practitioner_id
       WHERE t.id = $1 AND t.business_id = $2`,
      [id, bid]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Tâche introuvable' });
    res.json(result.rows[0]);
  } catch (err) { next(err); }
});

// ============================================================
// PATCH /api/tasks/:id — edit task fields
// ============================================================
router.patch('/:id', async (req, res, next) => {
  try {
    const bid = req.businessId;
    const id = req.params.id;
    if (!UUID_RE.test(id)) return res.status(400).json({ error: 'ID invalide' });

    const allowed = ['title', 'start_at', 'end_at', 'practitioner_id', 'color', 'note', 'status'];
    const sets = []; const vals = [bid, id]; let idx = 3;
    for (const key of allowed) {
      if (req.body[key] !== undefined) {
        if (key === 'title' && (!req.body[key] || req.body[key].length > 150)) return res.status(400).json({ error: 'Titre invalide' });
        if (key === 'color' && req.body[key] && !HEX_RE.test(req.body[key])) return res.status(400).json({ error: 'Couleur invalide' });
        if (key === 'status' && !['planned', 'completed', 'cancelled'].includes(req.body[key])) return res.status(400).json({ error: 'Statut invalide' });
        if (key === 'practitioner_id' && !UUID_RE.test(req.body[key])) return res.status(400).json({ error: 'Praticien invalide' });
        sets.push(`${key} = $${idx}`);
        vals.push(key === 'color' ? (req.body[key] || null) : req.body[key]);
        idx++;
      }
    }
    if (sets.length === 0) return res.status(400).json({ error: 'Aucun champ à modifier' });
    sets.push(`updated_at = now()`);

    const result = await queryWithRLS(bid,
      `UPDATE internal_tasks SET ${sets.join(', ')} WHERE id = $2 AND business_id = $1 RETURNING *`,
      vals
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Tâche introuvable' });

    broadcast(bid, 'booking_update', { action: 'task_edited' });
    res.json(result.rows[0]);
  } catch (err) { next(err); }
});

// ============================================================
// PATCH /api/tasks/:id/move — drag & drop
// ============================================================
router.patch('/:id/move', async (req, res, next) => {
  try {
    const bid = req.businessId;
    const id = req.params.id;
    if (!UUID_RE.test(id)) return res.status(400).json({ error: 'ID invalide' });

    const { start_at, end_at, practitioner_id } = req.body;
    if (!start_at || !end_at) return res.status(400).json({ error: 'Dates requises' });
    if (new Date(end_at) <= new Date(start_at)) return res.status(400).json({ error: 'Fin doit être après début' });

    const sets = ['start_at = $3', 'end_at = $4', 'updated_at = now()'];
    const vals = [bid, id, start_at, end_at];
    let idx = 5;
    if (practitioner_id && UUID_RE.test(practitioner_id)) {
      sets.push(`practitioner_id = $${idx}`);
      vals.push(practitioner_id);
    }

    const result = await queryWithRLS(bid,
      `UPDATE internal_tasks SET ${sets.join(', ')} WHERE id = $2 AND business_id = $1 RETURNING *`,
      vals
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Tâche introuvable' });

    broadcast(bid, 'booking_update', { action: 'task_moved' });
    res.json(result.rows[0]);
  } catch (err) { next(err); }
});

// ============================================================
// DELETE /api/tasks/:id — delete task
// ============================================================
router.delete('/:id', async (req, res, next) => {
  try {
    const bid = req.businessId;
    const id = req.params.id;
    if (!UUID_RE.test(id)) return res.status(400).json({ error: 'ID invalide' });

    const result = await queryWithRLS(bid,
      `DELETE FROM internal_tasks WHERE id = $1 AND business_id = $2 RETURNING id`,
      [id, bid]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Tâche introuvable' });

    broadcast(bid, 'booking_update', { action: 'task_deleted' });
    res.json({ deleted: true });
  } catch (err) { next(err); }
});

module.exports = router;
