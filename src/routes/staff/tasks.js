/**
 * Internal Tasks — CRUD for calendar tasks (no client attached).
 * v47: Multi-practitioner groups via shared group_id.
 */
const crypto = require('crypto');
const router = require('express').Router();
const { queryWithRLS, transactionWithRLS } = require('../../services/db');
const { requireAuth, resolvePractitionerScope, blockIfImpersonated } = require('../../middleware/auth');
const { broadcast } = require('../../services/sse');

router.use(requireAuth);
router.use(resolvePractitionerScope);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HEX_RE = /^#[0-9a-fA-F]{3,8}$/;

// ── Conflict check: does any practitioner have active bookings in [start, end)? ──
// `client` optionnel : si fourni (tx en cours), exécute via ce client pour bénéficier
// de l'advisory lock déjà posé. Sinon, query directe avec RLS.
async function _checkBookingConflicts(bid, pracIds, startAt, endAt, client) {
  const sql = `SELECT b.id, b.practitioner_id, b.start_at, b.end_at,
            COALESCE(c.full_name, 'Client') AS client_name,
            COALESCE(s.name, b.custom_label, 'RDV') AS service_name
     FROM bookings b
     LEFT JOIN clients c ON c.id = b.client_id
     LEFT JOIN services s ON s.id = b.service_id
     WHERE b.business_id = $1
       AND b.practitioner_id = ANY($2::uuid[])
       AND b.status IN ('pending','confirmed','modified_pending','pending_deposit')
       AND b.start_at < $4 AND b.end_at > $3
       AND NOT (b.processing_time > 0
         AND date_trunc('minute', $3::timestamptz) >= date_trunc('minute', b.start_at) + (COALESCE(s.buffer_before_min,0) + b.processing_start) * interval '1 minute'
         AND date_trunc('minute', $4::timestamptz) <= date_trunc('minute', b.start_at) + (COALESCE(s.buffer_before_min,0) + b.processing_start + b.processing_time) * interval '1 minute')`;
  const params = [bid, pracIds, startAt, endAt];
  const result = client
    ? await client.query(sql, params)
    : await queryWithRLS(bid, sql, params);
  return result.rows;
}

// Helper : acquire advisory locks sur (pracIds × startAt) + re-check conflict inside tx.
// Throw avec _conflict=true si collision. pracIds sont sortés pour deadlock-free ordering.
async function _lockAndCheckConflict(txClient, bid, pracIds, startAt, endAt) {
  const sorted = [...new Set(pracIds)].sort();
  const startISO = new Date(startAt).toISOString();
  for (const pid of sorted) {
    await txClient.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`${pid}_${startISO}`]);
  }
  const conflicts = await _checkBookingConflicts(bid, pracIds, startAt, endAt, txClient);
  if (conflicts.length > 0) {
    const names = conflicts.map(c => `${c.client_name} (${c.service_name})`);
    const err = new Error(`Conflit avec ${[...new Set(names)].join(', ')}`);
    err._conflict = true;
    throw err;
  }
}

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
// POST /api/tasks — create task (single or multi-practitioner)
// ============================================================
router.post('/', blockIfImpersonated, async (req, res, next) => {
  try {
    const bid = req.businessId;
    const { title, start_at, end_at, practitioner_id, practitioner_ids, color, note } = req.body;

    // Resolve practitioner list
    let pracIds;
    if (Array.isArray(practitioner_ids) && practitioner_ids.length > 0) {
      if (!practitioner_ids.every(id => UUID_RE.test(id))) return res.status(400).json({ error: 'Praticien(s) invalide(s)' });
      pracIds = [...new Set(practitioner_ids)];
    } else if (practitioner_id && UUID_RE.test(practitioner_id)) {
      pracIds = [practitioner_id];
    } else {
      return res.status(400).json({ error: 'Praticien requis' });
    }

    if (!title || !title.trim()) return res.status(400).json({ error: 'Titre requis' });
    if (title.length > 150) return res.status(400).json({ error: 'Titre trop long (150 max)' });
    if (!start_at || !end_at) return res.status(400).json({ error: 'Dates requises' });
    if (new Date(end_at) <= new Date(start_at)) return res.status(400).json({ error: 'Fin doit être après début' });
    if (color && !HEX_RE.test(color)) return res.status(400).json({ error: 'Couleur invalide' });

    // Validate all practitioner IDs belong to this business
    const pracValidation = await queryWithRLS(bid,
      `SELECT id FROM practitioners WHERE id = ANY($1::uuid[]) AND business_id = $2`,
      [pracIds, bid]
    );
    if (pracValidation.rows.length !== pracIds.length) {
      return res.status(400).json({ error: 'Un ou plusieurs praticiens sont invalides' });
    }

    // BUG-TASK-CONFLICT-RACE : conflict check + INSERT dans tx + advisory lock.
    const groupId = pracIds.length > 1 ? crypto.randomUUID() : null;
    let created;
    try {
      created = await transactionWithRLS(bid, async (txClient) => {
        await _lockAndCheckConflict(txClient, bid, pracIds, start_at, end_at);
        const results = [];
        for (const pid of pracIds) {
          const r = await txClient.query(
            groupId
              ? `INSERT INTO internal_tasks (business_id, practitioner_id, title, start_at, end_at, color, note, created_by, group_id)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`
              : `INSERT INTO internal_tasks (business_id, practitioner_id, title, start_at, end_at, color, note, created_by)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
            groupId
              ? [bid, pid, title.trim(), start_at, end_at, color || null, note || null, req.userId, groupId]
              : [bid, pid, title.trim(), start_at, end_at, color || null, note || null, req.userId]
          );
          results.push(r.rows[0]);
        }
        return results;
      });
    } catch (err) {
      if (err._conflict) return res.status(409).json({ error: err.message });
      throw err;
    }
    broadcast(bid, 'booking_update', { action: 'task_created' });
    if (groupId) return res.status(201).json({ tasks: created, group_id: groupId });
    return res.status(201).json(created[0]);
  } catch (err) { next(err); }
});

// ============================================================
// GET /api/tasks/:id — single task (+ group siblings if any)
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
    const task = result.rows[0];

    // Fetch group siblings if this task belongs to a group
    if (task.group_id) {
      const siblings = await queryWithRLS(bid,
        `SELECT t.id, t.practitioner_id, p.display_name AS practitioner_name
         FROM internal_tasks t
         JOIN practitioners p ON p.id = t.practitioner_id
         WHERE t.group_id = $1 AND t.business_id = $2
         ORDER BY p.display_name`,
        [task.group_id, bid]
      );
      task.group_members = siblings.rows;
    }

    res.json(task);
  } catch (err) { next(err); }
});

// ============================================================
// Helper: sync group practitioners (add/remove)
// ============================================================
async function _syncGroupPractitioners(bid, taskId, currentGroupId, newPracIds, userId) {
  if (!newPracIds.every(id => UUID_RE.test(id))) throw new Error('Praticien(s) invalide(s)');
  const uniquePracIds = [...new Set(newPracIds)];
  if (uniquePracIds.length === 0) throw new Error('Au moins un praticien requis');

  await transactionWithRLS(bid, async (txClient) => {
    // Fetch source task to copy shared fields
    const source = await txClient.query(
      `SELECT * FROM internal_tasks WHERE id = $1 AND business_id = $2`, [taskId, bid]);
    if (source.rows.length === 0) throw new Error('Tâche introuvable');
    const src = source.rows[0];

    if (currentGroupId) {
      // Already a group — diff current vs desired
      const members = await txClient.query(
        `SELECT practitioner_id FROM internal_tasks WHERE group_id = $1 AND business_id = $2`,
        [currentGroupId, bid]);
      const currentPracIds = members.rows.map(r => r.practitioner_id);

      const toAdd = uniquePracIds.filter(id => !currentPracIds.includes(id));
      const toRemove = currentPracIds.filter(id => !uniquePracIds.includes(id));

      for (const pid of toAdd) {
        await txClient.query(
          `INSERT INTO internal_tasks (business_id, practitioner_id, title, start_at, end_at, color, note, status, created_by, group_id)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
          [bid, pid, src.title, src.start_at, src.end_at, src.color, src.note, src.status, userId, currentGroupId]);
      }
      for (const pid of toRemove) {
        await txClient.query(
          `DELETE FROM internal_tasks WHERE group_id = $1 AND practitioner_id = $2 AND business_id = $3`,
          [currentGroupId, pid, bid]);
      }

      // If only 1 remains, downgrade to single (remove group_id)
      if (uniquePracIds.length === 1) {
        await txClient.query(
          `UPDATE internal_tasks SET group_id = NULL, updated_at = now() WHERE group_id = $1 AND business_id = $2`,
          [currentGroupId, bid]);
      }
    } else {
      // Single task → upgrading to group
      if (uniquePracIds.length > 1) {
        const groupId = crypto.randomUUID();
        // Tag existing row with group_id
        await txClient.query(
          `UPDATE internal_tasks SET group_id = $1, updated_at = now() WHERE id = $2 AND business_id = $3`,
          [groupId, taskId, bid]);
        // Insert new rows for additional practitioners
        const toAdd = uniquePracIds.filter(id => id !== src.practitioner_id);
        for (const pid of toAdd) {
          await txClient.query(
            `INSERT INTO internal_tasks (business_id, practitioner_id, title, start_at, end_at, color, note, status, created_by, group_id)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
            [bid, pid, src.title, src.start_at, src.end_at, src.color, src.note, src.status, userId, groupId]);
        }
      } else if (uniquePracIds[0] !== src.practitioner_id) {
        // Single prac change (no group needed)
        await txClient.query(
          `UPDATE internal_tasks SET practitioner_id = $1, updated_at = now() WHERE id = $2 AND business_id = $3`,
          [uniquePracIds[0], taskId, bid]);
      }
    }
  });
}

// ============================================================
// PATCH /api/tasks/:id — edit task fields (propagates to group)
// ============================================================
router.patch('/:id', blockIfImpersonated, async (req, res, next) => {
  try {
    const bid = req.businessId;
    const id = req.params.id;
    if (!UUID_RE.test(id)) return res.status(400).json({ error: 'ID invalide' });

    // Fetch current task
    const existing = await queryWithRLS(bid,
      `SELECT * FROM internal_tasks WHERE id = $1 AND business_id = $2`, [id, bid]);
    if (existing.rows.length === 0) return res.status(404).json({ error: 'Tâche introuvable' });
    const task = existing.rows[0];

    // Practitioner scope: verify task belongs to this practitioner
    if (req.practitionerFilter && task.practitioner_id !== req.practitionerFilter) {
      return res.status(404).json({ error: 'Tâche introuvable' });
    }

    // Handle practitioner_ids sync (add/remove practitioners)
    if (Array.isArray(req.body.practitioner_ids)) {
      await _syncGroupPractitioners(bid, id, task.group_id, req.body.practitioner_ids, req.userId);
      // Re-fetch group_id (may have been created/removed)
      const refreshed = await queryWithRLS(bid,
        `SELECT group_id FROM internal_tasks WHERE id = $1 AND business_id = $2`, [id, bid]);
      if (refreshed.rows.length > 0) task.group_id = refreshed.rows[0].group_id;
    }

    // ── Conflict check if time changes — wrap check + UPDATE dans tx avec advisory lock ──
    const newStart = req.body.start_at || task.start_at;
    const newEnd = req.body.end_at || task.end_at;
    const timeChanged = !!(req.body.start_at || req.body.end_at);

    // Build SET clause for shared fields
    const sharedFields = ['title', 'start_at', 'end_at', 'color', 'note', 'status'];
    const singleOnlyFields = ['practitioner_id'];
    const allowed = task.group_id ? sharedFields : [...sharedFields, ...singleOnlyFields];

    const sets = []; const vals = []; let idx = 1;
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

    if (sets.length > 0) {
      sets.push(`updated_at = now()`);

      try {
        await transactionWithRLS(bid, async (txClient) => {
          if (timeChanged) {
            let affectedPracIds;
            if (task.group_id) {
              const members = await txClient.query(
                `SELECT practitioner_id FROM internal_tasks WHERE group_id = $1 AND business_id = $2`,
                [task.group_id, bid]);
              affectedPracIds = members.rows.map(r => r.practitioner_id);
            } else {
              affectedPracIds = [req.body.practitioner_id || task.practitioner_id];
            }
            await _lockAndCheckConflict(txClient, bid, affectedPracIds, newStart, newEnd);
          }

          if (task.group_id) {
            // Propagate to ALL siblings
            const _vals = [...vals, task.group_id, bid];
            await txClient.query(
              `UPDATE internal_tasks SET ${sets.join(', ')} WHERE group_id = $${idx} AND business_id = $${idx + 1}`,
              _vals
            );
          } else {
            // Single task update
            const _vals = [...vals, id, bid];
            await txClient.query(
              `UPDATE internal_tasks SET ${sets.join(', ')} WHERE id = $${idx} AND business_id = $${idx + 1}`,
              _vals
            );
          }
        });
      } catch (err) {
        if (err._conflict) return res.status(409).json({ error: err.message });
        throw err;
      }
    }

    // Bail early if nothing to update (only practitioner_ids sync happened above)
    if (sets.length === 0 && !Array.isArray(req.body.practitioner_ids)) {
      return res.status(400).json({ error: 'Aucun champ à modifier' });
    }

    broadcast(bid, 'booking_update', { action: 'task_edited' });

    // Return updated task
    const updated = await queryWithRLS(bid,
      `SELECT t.*, p.display_name AS practitioner_name
       FROM internal_tasks t JOIN practitioners p ON p.id = t.practitioner_id
       WHERE t.id = $1 AND t.business_id = $2`, [id, bid]);
    res.json(updated.rows[0] || { updated: true });
  } catch (err) { next(err); }
});

// ============================================================
// PATCH /api/tasks/:id/move — drag & drop (propagates to group)
// ============================================================
router.patch('/:id/move', blockIfImpersonated, async (req, res, next) => {
  try {
    const bid = req.businessId;
    const id = req.params.id;
    if (!UUID_RE.test(id)) return res.status(400).json({ error: 'ID invalide' });

    const { start_at, end_at, practitioner_id } = req.body;
    if (!start_at || !end_at) return res.status(400).json({ error: 'Dates requises' });
    if (new Date(end_at) <= new Date(start_at)) return res.status(400).json({ error: 'Fin doit être après début' });

    // Fetch current task for group_id
    const existing = await queryWithRLS(bid,
      `SELECT group_id, practitioner_id FROM internal_tasks WHERE id = $1 AND business_id = $2`, [id, bid]);
    if (existing.rows.length === 0) return res.status(404).json({ error: 'Tâche introuvable' });
    const task = existing.rows[0];

    // Practitioner scope: verify task belongs to this practitioner
    if (req.practitionerFilter && task.practitioner_id !== req.practitionerFilter) {
      return res.status(404).json({ error: 'Tâche introuvable' });
    }

    // ── Conflict check + UPDATE wrappé dans tx + advisory lock (anti-race) ──
    try {
      if (task.group_id) {
        const groupMoveResult = await transactionWithRLS(bid, async (txClient) => {
          const members = await txClient.query(
            `SELECT practitioner_id FROM internal_tasks WHERE group_id = $1 AND business_id = $2`,
            [task.group_id, bid]);
          const pracIds = members.rows.map(r => r.practitioner_id);
          await _lockAndCheckConflict(txClient, bid, pracIds, start_at, end_at);

          // Group move: update ALL siblings with same time
          await txClient.query(
            `UPDATE internal_tasks SET start_at = $1, end_at = $2, updated_at = now()
             WHERE group_id = $3 AND business_id = $4`,
            [start_at, end_at, task.group_id, bid]
          );
          // If practitioner changed (cross-column drag), only update THIS task
          if (practitioner_id && UUID_RE.test(practitioner_id) && practitioner_id !== task.practitioner_id) {
            await txClient.query(
              `UPDATE internal_tasks SET practitioner_id = $1, updated_at = now() WHERE id = $2 AND business_id = $3`,
              [practitioner_id, id, bid]
            );
          }
          return true;
        });
        if (groupMoveResult) {
          broadcast(bid, 'booking_update', { action: 'task_moved' });
          return res.json({ updated: true, group_moved: true });
        }
      }

      // Single task: conflict check + UPDATE in tx
      const movePracId = (practitioner_id && UUID_RE.test(practitioner_id)) ? practitioner_id : task.practitioner_id;
      const result = await transactionWithRLS(bid, async (txClient) => {
        await _lockAndCheckConflict(txClient, bid, [movePracId], start_at, end_at);
        const sets = ['start_at = $3', 'end_at = $4', 'updated_at = now()'];
        const vals = [bid, id, start_at, end_at];
        let idx = 5;
        if (practitioner_id && UUID_RE.test(practitioner_id)) {
          sets.push(`practitioner_id = $${idx}`);
          vals.push(practitioner_id);
        }
        const r = await txClient.query(
          `UPDATE internal_tasks SET ${sets.join(', ')} WHERE id = $2 AND business_id = $1 RETURNING *`,
          vals
        );
        return r.rows[0] || null;
      });
      if (!result) return res.status(404).json({ error: 'Tâche introuvable' });
      broadcast(bid, 'booking_update', { action: 'task_moved' });
      res.json(result);
    } catch (err) {
      if (err._conflict) return res.status(409).json({ error: err.message });
      throw err;
    }
  } catch (err) { next(err); }
});

// ============================================================
// DELETE /api/tasks/:id — delete task (or entire group)
// ============================================================
router.delete('/:id', blockIfImpersonated, async (req, res, next) => {
  try {
    const bid = req.businessId;
    const id = req.params.id;
    if (!UUID_RE.test(id)) return res.status(400).json({ error: 'ID invalide' });

    // Check for group_id
    const existing = await queryWithRLS(bid,
      `SELECT group_id, practitioner_id FROM internal_tasks WHERE id = $1 AND business_id = $2`, [id, bid]);
    if (existing.rows.length === 0) return res.status(404).json({ error: 'Tâche introuvable' });

    // Practitioner scope: verify task belongs to this practitioner
    if (req.practitionerFilter && existing.rows[0].practitioner_id !== req.practitionerFilter) {
      return res.status(404).json({ error: 'Tâche introuvable' });
    }

    if (existing.rows[0].group_id) {
      // Delete ALL group members
      await queryWithRLS(bid,
        `DELETE FROM internal_tasks WHERE group_id = $1 AND business_id = $2`,
        [existing.rows[0].group_id, bid]
      );
    } else {
      // Single task delete
      await queryWithRLS(bid,
        `DELETE FROM internal_tasks WHERE id = $1 AND business_id = $2 RETURNING id`,
        [id, bid]
      );
    }

    broadcast(bid, 'booking_update', { action: 'task_deleted' });
    res.json({ deleted: true });
  } catch (err) { next(err); }
});

module.exports = router;
