const router = require('express').Router();
const bcrypt = require('bcryptjs');
const fs = require('fs');
const path = require('path');
const { queryWithRLS, query } = require('../../services/db');
const { requireAuth, requireOwner } = require('../../middleware/auth');

router.use(requireAuth);

// ============================================================
// POST /api/practitioners/:id/photo — Upload practitioner photo
// Accepts: { photo: "data:image/jpeg;base64,..." }
// Saves to /public/uploads/practitioners/<id>.<ext>
// ============================================================
router.post('/:id/photo', requireOwner, async (req, res, next) => {
  try {
    const bid = req.businessId;
    const { id } = req.params;
    const { photo } = req.body;

    if (!photo) return res.status(400).json({ error: 'Photo requise' });

    // Parse data URI
    const match = photo.match(/^data:image\/(jpeg|jpg|png|webp);base64,(.+)$/);
    if (!match) return res.status(400).json({ error: 'Format invalide (JPEG, PNG ou WebP requis)' });

    const ext = match[1] === 'jpg' ? 'jpeg' : match[1];
    const buffer = Buffer.from(match[2], 'base64');

    // Max 2MB
    if (buffer.length > 2 * 1024 * 1024) {
      return res.status(400).json({ error: 'Photo trop lourde (max 2 Mo)' });
    }

    // Ensure dir exists
    const uploadDir = path.join(__dirname, '../../../public/uploads/practitioners');
    fs.mkdirSync(uploadDir, { recursive: true });

    // Delete old photo if exists
    const old = await queryWithRLS(bid,
      `SELECT photo_url FROM practitioners WHERE id = $1 AND business_id = $2`, [id, bid]
    );
    if (old.rows[0]?.photo_url) {
      const oldPath = path.join(__dirname, '../../../public', old.rows[0].photo_url);
      try { fs.unlinkSync(oldPath); } catch (e) { /* ignore */ }
    }

    // Save file
    const filename = `${id}.${ext}`;
    fs.writeFileSync(path.join(uploadDir, filename), buffer);

    // Update DB
    const photoUrl = `/uploads/practitioners/${filename}?t=${Date.now()}`;
    await queryWithRLS(bid,
      `UPDATE practitioners SET photo_url = $1, updated_at = NOW() WHERE id = $2 AND business_id = $3`,
      [photoUrl, id, bid]
    );

    res.json({ photo_url: photoUrl });
  } catch (err) { next(err); }
});

// DELETE photo
router.delete('/:id/photo', requireOwner, async (req, res, next) => {
  try {
    const bid = req.businessId;
    const { id } = req.params;

    const old = await queryWithRLS(bid,
      `SELECT photo_url FROM practitioners WHERE id = $1 AND business_id = $2`, [id, bid]
    );
    if (old.rows[0]?.photo_url) {
      const oldPath = path.join(__dirname, '../../../public', old.rows[0].photo_url.split('?')[0]);
      try { fs.unlinkSync(oldPath); } catch (e) { /* ignore */ }
    }

    await queryWithRLS(bid,
      `UPDATE practitioners SET photo_url = NULL, updated_at = NOW() WHERE id = $1 AND business_id = $2`,
      [id, bid]
    );

    res.json({ deleted: true });
  } catch (err) { next(err); }
});

// ============================================================
// GET /api/practitioners — list all practitioners with stats
// ============================================================
router.get('/', async (req, res, next) => {
  try {
    const bid = req.businessId;
    const result = await queryWithRLS(bid,
      `SELECT p.*,
        u.email AS user_email, u.role AS user_role, u.last_login_at, u.is_active AS user_active,
        COUNT(DISTINCT ps.service_id) AS service_count,
        COUNT(DISTINCT bk.id) FILTER (WHERE bk.status IN ('confirmed','completed') AND bk.start_at >= NOW() - INTERVAL '30 days') AS bookings_30d
       FROM practitioners p
       LEFT JOIN users u ON u.id = p.user_id
       LEFT JOIN practitioner_services ps ON ps.practitioner_id = p.id
       LEFT JOIN bookings bk ON bk.practitioner_id = p.id
       WHERE p.business_id = $1
       GROUP BY p.id, u.email, u.role, u.last_login_at, u.is_active
       ORDER BY p.sort_order, p.display_name`,
      [bid]
    );
    res.json({ practitioners: result.rows });
  } catch (err) { next(err); }
});

// ============================================================
// GET /api/practitioners/:id/tasks — todos + reminders for a practitioner
// UI: Team page → "📋 Tâches" button
// ============================================================
router.get('/:id/tasks', async (req, res, next) => {
  try {
    const bid = req.businessId;
    const { id } = req.params;

    // Todos linked to this practitioner's bookings
    const todos = await queryWithRLS(bid,
      `SELECT t.id, t.content, t.is_done, t.done_at, t.created_at, t.booking_id,
              b.start_at AS booking_start, b.end_at AS booking_end,
              c.full_name AS client_name,
              s.name AS service_name
       FROM practitioner_todos t
       LEFT JOIN bookings b ON b.id = t.booking_id
       LEFT JOIN clients c ON c.id = b.client_id
       LEFT JOIN services s ON s.id = b.service_id
       WHERE t.business_id = $1
         AND (b.practitioner_id = $2 OR t.user_id IN (
           SELECT user_id FROM practitioners WHERE id = $2 AND business_id = $1
         ))
       ORDER BY t.is_done ASC, b.start_at ASC NULLS LAST, t.created_at DESC`,
      [bid, id]
    );

    // Reminders for this practitioner's bookings
    const reminders = await queryWithRLS(bid,
      `SELECT r.id, r.remind_at, r.message, r.channel, r.is_sent, r.sent_at, r.booking_id,
              b.start_at AS booking_start,
              c.full_name AS client_name,
              s.name AS service_name
       FROM booking_reminders r
       JOIN bookings b ON b.id = r.booking_id
       LEFT JOIN clients c ON c.id = b.client_id
       LEFT JOIN services s ON s.id = b.service_id
       WHERE r.business_id = $1 AND b.practitioner_id = $2
       ORDER BY r.is_sent ASC, r.remind_at ASC`,
      [bid, id]
    );

    res.json({ todos: todos.rows, reminders: reminders.rows });
  } catch (err) { next(err); }
});

// ============================================================
// POST /api/practitioners — create new practitioner
// ============================================================
router.post('/', requireOwner, async (req, res, next) => {
  try {
    const bid = req.businessId;
    const { display_name, title, bio, color, email, phone,
            years_experience, linkedin_url, booking_enabled } = req.body;

    if (!display_name) return res.status(400).json({ error: 'Nom requis' });

    const result = await queryWithRLS(bid,
      `INSERT INTO practitioners (business_id, display_name, title, bio, color,
        email, phone, years_experience, linkedin_url, booking_enabled)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING *`,
      [bid, display_name, title || null, bio || null, color || '#0D7377',
       email || null, phone || null, years_experience || null,
       linkedin_url || null, booking_enabled !== false]
    );

    res.status(201).json({ practitioner: result.rows[0] });
  } catch (err) { next(err); }
});

// ============================================================
// PATCH /api/practitioners/:id — update practitioner
// ============================================================
router.patch('/:id', requireOwner, async (req, res, next) => {
  try {
    const bid = req.businessId;
    const { id } = req.params;
    const fields = req.body;
    const allowed = ['display_name', 'title', 'bio', 'color', 'email', 'phone',
      'years_experience', 'linkedin_url', 'booking_enabled', 'is_active', 'sort_order', 'waitlist_mode', 'slot_increment_min'];

    const sets = [];
    const params = [id, bid];
    let idx = 3;

    for (const [key, val] of Object.entries(fields)) {
      if (allowed.includes(key)) {
        sets.push(`${key} = $${idx}`);
        params.push(val);
        idx++;
      }
    }

    if (sets.length === 0) return res.status(400).json({ error: 'Rien à modifier' });
    sets.push('updated_at = NOW()');

    const result = await queryWithRLS(bid,
      `UPDATE practitioners SET ${sets.join(', ')} WHERE id = $1 AND business_id = $2 RETURNING *`,
      params
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Praticien introuvable' });

    res.json({ practitioner: result.rows[0] });
  } catch (err) { next(err); }
});

// ============================================================
// DELETE /api/practitioners/:id — deactivate practitioner
// ============================================================
router.delete('/:id', requireOwner, async (req, res, next) => {
  try {
    await queryWithRLS(req.businessId,
      `UPDATE practitioners SET is_active = false, booking_enabled = false, updated_at = NOW()
       WHERE id = $1 AND business_id = $2`,
      [req.params.id, req.businessId]
    );
    res.json({ deleted: true });
  } catch (err) { next(err); }
});

// ============================================================
// POST /api/practitioners/:id/invite — create login for practitioner
// Sends an invite (creates user account linked to practitioner)
// ============================================================
router.post('/:id/invite', requireOwner, async (req, res, next) => {
  try {
    const bid = req.businessId;
    const { id } = req.params;
    const { email, password, role } = req.body;

    if (!email) return res.status(400).json({ error: 'Email requis' });

    // Validate role
    const validRoles = ['manager', 'practitioner', 'receptionist'];
    const userRole = validRoles.includes(role) ? role : 'practitioner';

    // Check practitioner exists
    const pract = await queryWithRLS(bid,
      `SELECT id, user_id, display_name FROM practitioners WHERE id = $1 AND business_id = $2`,
      [id, bid]
    );
    if (pract.rows.length === 0) return res.status(404).json({ error: 'Praticien introuvable' });
    if (pract.rows[0].user_id) return res.status(400).json({ error: 'Ce praticien a déjà un compte' });

    // Check email not taken in this business
    const existing = await query(
      `SELECT id FROM users WHERE email = $1 AND business_id = $2`,
      [email.toLowerCase().trim(), bid]
    );
    if (existing.rows.length > 0) return res.status(409).json({ error: 'Cet email est déjà utilisé' });

    // Create user
    const hash = password ? await bcrypt.hash(password, 12) : null;
    const userResult = await query(
      `INSERT INTO users (business_id, email, password_hash, role)
       VALUES ($1, $2, $3, $4)
       RETURNING id, email, role`,
      [bid, email.toLowerCase().trim(), hash, userRole]
    );
    const userId = userResult.rows[0].id;

    // Link to practitioner
    await queryWithRLS(bid,
      `UPDATE practitioners SET user_id = $1, email = $2, updated_at = NOW()
       WHERE id = $3 AND business_id = $4`,
      [userId, email.toLowerCase().trim(), id, bid]
    );

    res.status(201).json({
      user: userResult.rows[0],
      practitioner_id: id,
      message: `Compte créé pour ${pract.rows[0].display_name}`
    });
  } catch (err) { next(err); }
});

// ============================================================
// PATCH /api/practitioners/:id/role — change linked user's role
// ============================================================
router.patch('/:id/role', requireOwner, async (req, res, next) => {
  try {
    const bid = req.businessId;
    const { id } = req.params;
    const { role } = req.body;

    const validRoles = ['manager', 'practitioner', 'receptionist'];
    if (!validRoles.includes(role)) {
      return res.status(400).json({ error: `Rôle invalide. Valeurs acceptées : ${validRoles.join(', ')}` });
    }

    // Find practitioner + linked user
    const pract = await queryWithRLS(bid,
      `SELECT p.id, p.user_id, p.display_name, u.role AS current_role
       FROM practitioners p
       LEFT JOIN users u ON u.id = p.user_id
       WHERE p.id = $1 AND p.business_id = $2`,
      [id, bid]
    );

    if (pract.rows.length === 0) return res.status(404).json({ error: 'Praticien introuvable' });
    if (!pract.rows[0].user_id) return res.status(400).json({ error: 'Ce praticien n\'a pas de compte utilisateur' });

    // Prevent changing owner role
    if (pract.rows[0].current_role === 'owner') {
      return res.status(403).json({ error: 'Impossible de modifier le rôle du propriétaire' });
    }

    // Update role
    await query(
      `UPDATE users SET role = $1, updated_at = NOW() WHERE id = $2 AND business_id = $3`,
      [role, pract.rows[0].user_id, bid]
    );

    res.json({
      updated: true,
      practitioner_id: id,
      new_role: role,
      message: `Rôle de ${pract.rows[0].display_name} modifié en ${role}`
    });
  } catch (err) { next(err); }
});

module.exports = router;
