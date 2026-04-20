const router = require('express').Router();
const bcrypt = require('bcryptjs');
const fs = require('fs');
const path = require('path');
const { queryWithRLS, query, transactionWithRLS } = require('../../services/db');
const { requireAuth, requireOwner, blockIfImpersonated } = require('../../middleware/auth');
const { refundGiftCardForBooking } = require('../../services/gift-card-refund');
const { refundPassForBooking } = require('../../services/pass-refund');

router.use(requireAuth);

// ============================================================
// Helpers
// ============================================================

/**
 * Convert JS Date.getDay() (0=Sun) to availabilities weekday (0=Mon).
 */
function toAvailWeekday(jsDate) {
  return (jsDate.getDay() + 6) % 7;
}

/**
 * Check if a date is a working day for a practitioner.
 */
function isWorkDay(date, workDays, holidayDates) {
  if (holidayDates) {
    const ds = date.toLocaleDateString('en-CA', { timeZone: 'Europe/Brussels' });
    if (holidayDates.has(ds)) return false;
  }
  if (!workDays || workDays.size === 0) return true;
  return workDays.has(toAvailWeekday(date));
}

/**
 * Get the effective period for a specific day within an absence.
 */
function getEffectivePeriod(dayDate, absDateFrom, absDateTo, periodStart, periodEnd) {
  const dayStr = dayDate.toLocaleDateString('en-CA', { timeZone: 'Europe/Brussels' });
  const fromStr = new Date(absDateFrom).toLocaleDateString('en-CA', { timeZone: 'Europe/Brussels' });
  const toStr = new Date(absDateTo).toLocaleDateString('en-CA', { timeZone: 'Europe/Brussels' });
  if (fromStr === toStr) return periodStart || 'full';
  if (dayStr === fromStr) return periodStart || 'full';
  if (dayStr === toStr) return periodEnd || 'full';
  return 'full';
}

/**
 * Compute used leave days for practitioners in a given year.
 * Returns Map<pracId, { conge, maladie, formation, recuperation, autre }>
 */
async function computeUsedLeave(bid, practitionerIds, year) {
  const used = new Map();
  if (!practitionerIds || practitionerIds.length === 0) return used;

  const yearStart = `${year}-01-01`;
  const yearEnd = `${year}-12-31`;

  // Fetch absences for the year
  const absResult = await queryWithRLS(bid,
    `SELECT practitioner_id, type, date_from, date_to, period, period_end
     FROM staff_absences
     WHERE business_id = $1
       AND practitioner_id = ANY($2::uuid[])
       AND date_from <= $3::date AND date_to >= $4::date`,
    [bid, practitionerIds, yearEnd, yearStart]
  );

  if (absResult.rows.length === 0) return used;

  // Fetch work days for relevant practitioners
  const pracIds = [...new Set(absResult.rows.map(r => r.practitioner_id))];
  const wdResult = await queryWithRLS(bid,
    `SELECT DISTINCT practitioner_id, weekday FROM availabilities
     WHERE business_id = $1 AND is_active = true AND practitioner_id = ANY($2::uuid[])`,
    [bid, pracIds]
  );
  const workDaysMap = new Map();
  wdResult.rows.forEach(r => {
    if (!workDaysMap.has(r.practitioner_id)) workDaysMap.set(r.practitioner_id, new Set());
    workDaysMap.get(r.practitioner_id).add(r.weekday);
  });

  // Fetch holidays for the year
  let holidayDates = new Set();
  try {
    const holResult = await queryWithRLS(bid,
      `SELECT date FROM business_holidays WHERE business_id = $1 AND date >= $2::date AND date <= $3::date`,
      [bid, yearStart, yearEnd]
    );
    holResult.rows.forEach(r => holidayDates.add(new Date(r.date).toLocaleDateString('en-CA', { timeZone: 'Europe/Brussels' })));
  } catch (e) { /* table might not exist */ }

  // Count days per absence
  const yStart = new Date(yearStart);
  const yEnd = new Date(yearEnd);

  absResult.rows.forEach(row => {
    if (!used.has(row.practitioner_id)) {
      used.set(row.practitioner_id, { conge: 0, maladie: 0, formation: 0, recuperation: 0, autre: 0 });
    }
    const from = new Date(Math.max(new Date(row.date_from), yStart));
    const to = new Date(Math.min(new Date(row.date_to), yEnd));
    const workDays = workDaysMap.get(row.practitioner_id) || null;

    for (let d = new Date(from); d <= to; d.setDate(d.getDate() + 1)) {
      if (!isWorkDay(d, workDays, holidayDates)) continue;
      const dayPeriod = getEffectivePeriod(d, row.date_from, row.date_to, row.period, row.period_end);
      const val = dayPeriod === 'full' ? 1 : 0.5;
      const type = used.get(row.practitioner_id)[row.type] !== undefined ? row.type : 'autre';
      used.get(row.practitioner_id)[type] += val;
    }
  });

  return used;
}

// ============================================================
// GET /api/practitioners/me — current practitioner's own profile
// UI: Practitioner dashboard > Mon profil
// ============================================================
router.get('/me', async (req, res, next) => {
  try {
    const bid = req.businessId;
    const pracId = req.user.practitionerId;
    if (!pracId) return res.status(403).json({ error: 'Pas de profil praticien lié' });

    const result = await queryWithRLS(bid,
      `SELECT p.*, u.email AS login_email, u.role, u.last_login_at
       FROM practitioners p
       LEFT JOIN users u ON u.id = p.user_id
       WHERE p.id = $1 AND p.business_id = $2`,
      [pracId, bid]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Profil introuvable' });
    res.json({ practitioner: result.rows[0] });
  } catch (err) { next(err); }
});

// ============================================================
// PATCH /api/practitioners/me — update own profile (limited fields)
// ============================================================
router.patch('/me', async (req, res, next) => {
  try {
    const bid = req.businessId;
    const pracId = req.user.practitionerId;
    if (!pracId) return res.status(403).json({ error: 'Pas de profil praticien lié' });

    // Practitioners can only update these fields
    const { display_name, title, bio, phone, email } = req.body;
    const updates = [];
    const params = [];
    let idx = 1;

    if (display_name !== undefined) { updates.push(`display_name = $${idx}`); params.push(display_name); idx++; }
    if (title !== undefined) { updates.push(`title = $${idx}`); params.push(title); idx++; }
    if (bio !== undefined) { updates.push(`bio = $${idx}`); params.push(bio); idx++; }
    if (phone !== undefined) { updates.push(`phone = $${idx}`); params.push(phone); idx++; }
    if (email !== undefined) { updates.push(`email = $${idx}`); params.push(email); idx++; }

    if (updates.length === 0) return res.json({ updated: false, message: 'Rien à modifier' });

    updates.push('updated_at = NOW()');
    params.push(pracId, bid);

    const result = await queryWithRLS(bid,
      `UPDATE practitioners SET ${updates.join(', ')} WHERE id = $${idx} AND business_id = $${idx + 1} RETURNING *`,
      params
    );

    res.json({ updated: true, practitioner: result.rows[0] });
  } catch (err) { next(err); }
});

// ============================================================
// POST /api/practitioners/:id/photo — Upload practitioner photo
// Accepts: { photo: "data:image/jpeg;base64,..." }
// Saves to UPLOADS_BASE/practitioners/<id>.<ext> (env UPLOADS_DIR or default public/uploads)
// ============================================================
router.post('/:id/photo', requireOwner, async (req, res, next) => {
  try {
    const bid = req.businessId;
    const { id } = req.params;
    const { photo } = req.body;

    if (!photo) return res.status(400).json({ error: 'Photo requise' });

    const pracCheck = await queryWithRLS(bid, `SELECT id FROM practitioners WHERE id = $1 AND business_id = $2`, [id, bid]);
    if (pracCheck.rows.length === 0) return res.status(404).json({ error: 'Praticien introuvable' });

    const match = photo.match(/^data:image\/(jpeg|jpg|png|webp);base64,(.+)$/);
    if (!match) return res.status(400).json({ error: 'Format invalide (JPEG, PNG ou WebP requis)' });

    const ext = match[1] === 'jpg' ? 'jpeg' : match[1];
    const buffer = Buffer.from(match[2], 'base64');

    if (buffer.length > 2 * 1024 * 1024) {
      return res.status(400).json({ error: 'Photo trop lourde (max 2 Mo)' });
    }

    const { UPLOADS_BASE, ensureSubdir } = require('../../services/uploads');
    const uploadDir = ensureSubdir('practitioners');

    const old = await queryWithRLS(bid,
      `SELECT photo_url FROM practitioners WHERE id = $1 AND business_id = $2`, [id, bid]
    );
    if (old.rows[0]?.photo_url) {
      const rel = old.rows[0].photo_url.split('?')[0].replace(/^\/uploads\//, '');
      const resolved = path.resolve(UPLOADS_BASE, rel);
      if (resolved.startsWith(UPLOADS_BASE)) {
        try { fs.unlinkSync(resolved); } catch (e) { /* ignore */ }
      }
    }

    const filename = path.basename(`${id}.${ext}`);
    if (filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
      return res.status(400).json({ error: 'Nom de fichier invalide' });
    }
    fs.writeFileSync(path.join(uploadDir, filename), buffer);

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

    const { UPLOADS_BASE } = require('../../services/uploads');
    const old = await queryWithRLS(bid,
      `SELECT photo_url FROM practitioners WHERE id = $1 AND business_id = $2`, [id, bid]
    );
    if (old.rows[0]?.photo_url) {
      const rel = old.rows[0].photo_url.split('?')[0].replace(/^\/uploads\//, '');
      const resolved = path.resolve(UPLOADS_BASE, rel);
      if (resolved.startsWith(UPLOADS_BASE)) {
        try { fs.unlinkSync(resolved); } catch (e) { /* ignore */ }
      }
    }

    await queryWithRLS(bid,
      `UPDATE practitioners SET photo_url = NULL, updated_at = NOW() WHERE id = $1 AND business_id = $2`,
      [id, bid]
    );

    res.json({ deleted: true });
  } catch (err) { next(err); }
});

// ============================================================
// GET /api/practitioners — list all practitioners with enriched data
// Returns: practitioners + skills + work_days + leave_balance
// ============================================================
router.get('/', async (req, res, next) => {
  try {
    const bid = req.businessId;
    const currentYear = new Date().getFullYear();

    // 1. Main practitioners query (existing)
    const result = await queryWithRLS(bid,
      `SELECT p.*,
        u.email AS user_email, u.role AS user_role, u.last_login_at, u.is_active AS user_active,
        COUNT(DISTINCT ps.service_id) AS service_count,
        COUNT(DISTINCT bk.id) FILTER (WHERE bk.status IN ('confirmed','completed','pending_deposit') AND bk.start_at >= NOW() - INTERVAL '30 days') AS bookings_30d
       FROM practitioners p
       LEFT JOIN users u ON u.id = p.user_id
       LEFT JOIN practitioner_services ps ON ps.practitioner_id = p.id
       LEFT JOIN bookings bk ON bk.practitioner_id = p.id
       WHERE p.business_id = $1
       GROUP BY p.id, u.email, u.role, u.last_login_at, u.is_active
       ORDER BY p.sort_order, p.display_name`,
      [bid]
    );

    const practitioners = result.rows;
    const pracIds = practitioners.map(p => p.id);

    if (pracIds.length === 0) {
      return res.json({ practitioners: [] });
    }

    // 2. Batch fetch skills
    let skillsMap = {};
    try {
      const skillsResult = await queryWithRLS(bid,
        `SELECT practitioner_id, skill_name, level, sort_order
         FROM practitioner_skills
         WHERE business_id = $1
         ORDER BY practitioner_id, sort_order`,
        [bid]
      );
      skillsResult.rows.forEach(r => {
        if (!skillsMap[r.practitioner_id]) skillsMap[r.practitioner_id] = [];
        skillsMap[r.practitioner_id].push({ skill_name: r.skill_name, level: r.level, sort_order: r.sort_order });
      });
    } catch (e) { /* table might not exist yet */ }

    // 3. Batch fetch work days (from availabilities)
    const workDaysMap = {};
    try {
      const wdResult = await queryWithRLS(bid,
        `SELECT DISTINCT practitioner_id, weekday
         FROM availabilities
         WHERE business_id = $1 AND is_active = true`,
        [bid]
      );
      wdResult.rows.forEach(r => {
        if (!workDaysMap[r.practitioner_id]) workDaysMap[r.practitioner_id] = [];
        if (!workDaysMap[r.practitioner_id].includes(r.weekday)) {
          workDaysMap[r.practitioner_id].push(r.weekday);
        }
      });
      // Sort each array
      Object.values(workDaysMap).forEach(arr => arr.sort((a, b) => a - b));
    } catch (e) { /* ignore */ }

    // 4. Batch fetch leave balances for current year
    let leaveBalancesMap = {};
    try {
      const lbResult = await queryWithRLS(bid,
        `SELECT practitioner_id, type, total_days
         FROM leave_balances
         WHERE business_id = $1 AND year = $2`,
        [bid, currentYear]
      );
      lbResult.rows.forEach(r => {
        if (!leaveBalancesMap[r.practitioner_id]) leaveBalancesMap[r.practitioner_id] = {};
        leaveBalancesMap[r.practitioner_id][r.type] = { total: parseFloat(r.total_days), used: 0 };
      });
    } catch (e) { /* table might not exist yet */ }

    // 5. Compute used leave days
    const usedMap = await computeUsedLeave(bid, pracIds, currentYear);

    // 6. Merge used into leave balances
    usedMap.forEach((usedObj, pracId) => {
      if (!leaveBalancesMap[pracId]) leaveBalancesMap[pracId] = {};
      for (const [type, days] of Object.entries(usedObj)) {
        if (days > 0) {
          if (!leaveBalancesMap[pracId][type]) {
            leaveBalancesMap[pracId][type] = { total: 0, used: days };
          } else {
            leaveBalancesMap[pracId][type].used = days;
          }
        }
      }
    });

    // 7. Enrich each practitioner
    practitioners.forEach(p => {
      p.skills = skillsMap[p.id] || [];
      p.work_days = workDaysMap[p.id] || [];
      p.leave_balance = leaveBalancesMap[p.id] || {};
    });

    res.json({ practitioners });
  } catch (err) { next(err); }
});

// ============================================================
// GET /api/practitioners/:id/tasks — todos + reminders for a practitioner
// ============================================================
router.get('/:id/tasks', async (req, res, next) => {
  try {
    const bid = req.businessId;
    const { id } = req.params;

    if (req.user.role === 'practitioner' && id !== req.user.practitionerId) {
      return res.status(403).json({ error: 'Accès non autorisé' });
    }

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
// PUT /api/practitioners/:id/skills — replace all skills
// Body: { skills: [{ skill_name, level, sort_order }] }
// ============================================================
router.put('/:id/skills', requireOwner, blockIfImpersonated, async (req, res, next) => {
  try {
    const bid = req.businessId;
    const { id } = req.params;
    const { skills } = req.body;

    if (!Array.isArray(skills)) {
      return res.status(400).json({ error: 'skills doit être un tableau' });
    }

    // Verify practitioner belongs to business
    const pracCheck = await queryWithRLS(bid,
      `SELECT id FROM practitioners WHERE id = $1 AND business_id = $2`, [id, bid]
    );
    if (pracCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Praticien introuvable' });
    }

    await transactionWithRLS(bid, async (client) => {
      // Delete existing skills
      await client.query(
        `DELETE FROM practitioner_skills WHERE business_id = $1 AND practitioner_id = $2`,
        [bid, id]
      );

      // Insert new skills
      for (let i = 0; i < skills.length; i++) {
        const s = skills[i];
        if (!s.skill_name || !s.skill_name.trim()) continue;
        const level = Math.max(1, Math.min(3, parseInt(s.level) || 2));
        await client.query(
          `INSERT INTO practitioner_skills (business_id, practitioner_id, skill_name, level, sort_order)
           VALUES ($1, $2, $3, $4, $5)`,
          [bid, id, s.skill_name.trim(), level, s.sort_order ?? i]
        );
      }
    });

    // Return updated skills
    const result = await queryWithRLS(bid,
      `SELECT skill_name, level, sort_order FROM practitioner_skills
       WHERE business_id = $1 AND practitioner_id = $2 ORDER BY sort_order`,
      [bid, id]
    );

    res.json({ skills: result.rows });
  } catch (err) { next(err); }
});

// ============================================================
// PUT /api/practitioners/:id/services — replace all service assignments
// Body: { service_ids: [uuid, ...] }
// ============================================================
router.put('/:id/services', requireOwner, blockIfImpersonated, async (req, res, next) => {
  try {
    const bid = req.businessId;
    const { id } = req.params;
    const { service_ids } = req.body;

    if (!Array.isArray(service_ids)) {
      return res.status(400).json({ error: 'service_ids doit être un tableau' });
    }

    // Verify practitioner belongs to business
    const pracCheck = await queryWithRLS(bid,
      `SELECT id FROM practitioners WHERE id = $1 AND business_id = $2`, [id, bid]
    );
    if (pracCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Praticien introuvable' });
    }

    await transactionWithRLS(bid, async (client) => {
      // Remove all existing service links for this practitioner
      await client.query(
        `DELETE FROM practitioner_services
         WHERE practitioner_id = $1
           AND service_id IN (SELECT id FROM services WHERE business_id = $2)`,
        [id, bid]
      );

      if (service_ids.length > 0) {
        // Validate service IDs belong to this business
        const validSvcs = await client.query(
          `SELECT id FROM services WHERE id = ANY($1) AND business_id = $2 AND is_active != false`,
          [service_ids, bid]
        );
        const validIds = validSvcs.rows.map(r => r.id);
        for (const svcId of validIds) {
          await client.query(
            `INSERT INTO practitioner_services (practitioner_id, service_id) VALUES ($1, $2)`,
            [id, svcId]
          );
        }
      }
    });

    res.json({ ok: true, count: service_ids.length });
  } catch (err) { next(err); }
});

// ============================================================
// GET /api/practitioners/:id/leave-balance?year=2026
// Returns quotas + computed used days
// ============================================================
router.get('/:id/leave-balance', async (req, res, next) => {
  try {
    const bid = req.businessId;
    const { id } = req.params;
    const year = parseInt(req.query.year) || new Date().getFullYear();

    // Practitioner can only view their own
    if (req.user.role === 'practitioner' && id !== req.user.practitionerId) {
      return res.status(403).json({ error: 'Accès non autorisé' });
    }

    // Fetch quotas
    const lbResult = await queryWithRLS(bid,
      `SELECT type, total_days FROM leave_balances
       WHERE business_id = $1 AND practitioner_id = $2 AND year = $3`,
      [bid, id, year]
    );

    const balances = {};
    lbResult.rows.forEach(r => {
      balances[r.type] = { total: parseFloat(r.total_days), used: 0 };
    });

    // Compute used days
    const usedMap = await computeUsedLeave(bid, [id], year);
    const used = usedMap.get(id);
    if (used) {
      for (const [type, days] of Object.entries(used)) {
        if (days > 0) {
          if (!balances[type]) balances[type] = { total: 0, used: days };
          else balances[type].used = days;
        }
      }
    }

    // Recent absences for this practitioner
    const absResult = await queryWithRLS(bid,
      `SELECT id, date_from, date_to, type, period, period_end, note, created_at
       FROM staff_absences
       WHERE business_id = $1 AND practitioner_id = $2
       ORDER BY date_from DESC LIMIT 5`,
      [bid, id]
    );

    res.json({ year, balances, recent_absences: absResult.rows });
  } catch (err) { next(err); }
});

// ============================================================
// PUT /api/practitioners/:id/leave-balance — set/update quotas
// Body: { year, balances: { conge: 20, formation: 5, recuperation: 3 } }
// ============================================================
router.put('/:id/leave-balance', requireOwner, blockIfImpersonated, async (req, res, next) => {
  try {
    const bid = req.businessId;
    const { id } = req.params;
    const { year, balances } = req.body;

    if (!year || !balances) {
      return res.status(400).json({ error: 'year et balances requis' });
    }

    const pracCheck = await queryWithRLS(bid,
      `SELECT id FROM practitioners WHERE id = $1 AND business_id = $2`, [id, bid]
    );
    if (pracCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Praticien introuvable' });
    }

    const validTypes = ['conge', 'maladie', 'formation', 'recuperation'];
    for (const [type, totalDays] of Object.entries(balances)) {
      if (!validTypes.includes(type)) continue;
      const total = parseFloat(totalDays);
      if (isNaN(total) || total < 0) continue;

      await queryWithRLS(bid,
        `INSERT INTO leave_balances (business_id, practitioner_id, year, type, total_days)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (practitioner_id, year, type)
         DO UPDATE SET total_days = EXCLUDED.total_days, updated_at = NOW()`,
        [bid, id, year, type, total]
      );
    }

    res.json({ updated: true });
  } catch (err) { next(err); }
});

// ============================================================
// POST /api/practitioners — create new practitioner
// ============================================================
router.post('/', requireOwner, blockIfImpersonated, async (req, res, next) => {
  try {
    const bid = req.businessId;
    const { display_name, title, bio, color, email, phone,
            years_experience, linkedin_url, booking_enabled, featured_enabled, max_concurrent,
            contract_type, weekly_hours_target, hire_date,
            emergency_contact_name, emergency_contact_phone, internal_note } = req.body;

    if (!display_name) return res.status(400).json({ error: 'Nom requis' });

    // Plan guard: free tier limited to 1 practitioner
    const bizPlanCheck = await queryWithRLS(bid,
      `SELECT b.plan, (SELECT COUNT(*)::int FROM practitioners WHERE business_id = b.id AND is_active = true) AS prac_count
       FROM businesses b WHERE b.id = $1`, [bid]);
    if (bizPlanCheck.rows[0]?.plan === 'free' && bizPlanCheck.rows[0]?.prac_count >= 1) {
      return res.status(403).json({ error: 'Le plan gratuit est limité à 1 praticien. Passez au Pro pour en ajouter.' });
    }

    const result = await queryWithRLS(bid,
      `INSERT INTO practitioners (business_id, display_name, title, bio, color,
        email, phone, years_experience, linkedin_url, booking_enabled, featured_enabled, max_concurrent,
        contract_type, weekly_hours_target, hire_date,
        emergency_contact_name, emergency_contact_phone, internal_note)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
       RETURNING *`,
      [bid, display_name, title || null, bio || null, color || '#0D7377',
       email || null, phone || null, years_experience || null,
       linkedin_url || null, booking_enabled !== false, featured_enabled === true,
       parseInt(max_concurrent) || 1,
       contract_type || 'cdi', weekly_hours_target ? parseFloat(weekly_hours_target) : null,
       hire_date || null, emergency_contact_name || null, emergency_contact_phone || null,
       internal_note || null]
    );

    res.status(201).json({ practitioner: result.rows[0] });
  } catch (err) { next(err); }
});

// ============================================================
// PATCH /api/practitioners/:id — update practitioner
// ============================================================
router.patch('/:id', requireOwner, blockIfImpersonated, async (req, res, next) => {
  try {
    const bid = req.businessId;
    const { id } = req.params;
    const fields = req.body;
    const allowed = ['display_name', 'title', 'bio', 'color', 'email', 'phone',
      'years_experience', 'linkedin_url', 'booking_enabled', 'featured_enabled',
      'is_active', 'sort_order', 'waitlist_mode', 'slot_increment_min', 'vacation_until', 'max_concurrent',
      'contract_type', 'weekly_hours_target', 'hire_date',
      'emergency_contact_name', 'emergency_contact_phone', 'internal_note'];

    // Plan guard: Free tier cannot reactivate practitioners beyond limit of 1
    if (fields.is_active === true || fields.is_active === 'true') {
      const bizPlanCheck = await queryWithRLS(bid,
        `SELECT b.plan, (SELECT COUNT(*) FROM practitioners p2 WHERE p2.business_id = b.id AND p2.is_active = true AND p2.id != $2) AS active_count
         FROM businesses b WHERE b.id = $1`, [bid, id]);
      if (bizPlanCheck.rows[0]?.plan === 'free' && bizPlanCheck.rows[0]?.active_count >= 1) {
        return res.status(403).json({ error: 'Le plan gratuit est limité à 1 praticien actif. Passez au Pro pour en activer davantage.' });
      }
    }

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
// Checks for future bookings; returns 409 if found (unless
// ?cancel_bookings=true or ?keep_bookings=true is passed).
// ============================================================
router.delete('/:id', requireOwner, blockIfImpersonated, async (req, res, next) => {
  try {
    const bid = req.businessId;
    const pracId = req.params.id;
    const cancelBookings = req.query.cancel_bookings === 'true';
    const keepBookings = req.query.keep_bookings === 'true';

    // Count future active bookings for this practitioner
    const futureRes = await queryWithRLS(bid,
      `SELECT COUNT(*)::int AS cnt FROM bookings
       WHERE practitioner_id = $1 AND business_id = $2
       AND start_at > NOW()
       AND status IN ('pending', 'confirmed', 'modified_pending', 'pending_deposit')`,
      [pracId, bid]
    );
    const futureCount = futureRes.rows[0].cnt;

    // If future bookings exist and no explicit choice made → 409 with count
    if (futureCount > 0 && !cancelBookings && !keepBookings) {
      return res.status(409).json({
        error: `Ce praticien a ${futureCount} RDV à venir.`,
        future_bookings_count: futureCount
      });
    }

    // Cancel future bookings if requested
    // N8 fix: cascade proper (cancel_reason + Stripe refund + GC/pass refund + void invoices +
    // email client/pro + broadcast + calSyncDelete). Avant: simple UPDATE silencieux = deposit
    // retenu + GC/pass non remboursés + pas d'email + invoices orphelines.
    let cancelledCount = 0;
    let cancelledDetails = [];
    if (cancelBookings && futureCount > 0) {
      // 1) Lister les bookings à cancel + snapshot refund targets dans une TX
      const txTargets = await transactionWithRLS(bid, async (client) => {
        const listRes = await client.query(
          `SELECT id, group_id, client_id, deposit_status, deposit_amount_cents, deposit_payment_intent_id
           FROM bookings
           WHERE practitioner_id = $1 AND business_id = $2
             AND start_at > NOW()
             AND status IN ('pending', 'confirmed', 'modified_pending', 'pending_deposit')
           FOR UPDATE`,
          [pracId, bid]
        );
        const cancelReasonPrac = 'Praticien retiré du planning';
        await client.query(
          `UPDATE bookings SET status = 'cancelled', cancel_reason = $3,
            deposit_status = CASE WHEN deposit_status = 'pending' THEN 'cancelled' ELSE deposit_status END,
            updated_at = NOW()
           WHERE practitioner_id = $1 AND business_id = $2
             AND start_at > NOW()
             AND status IN ('pending', 'confirmed', 'modified_pending', 'pending_deposit')`,
          [pracId, bid, cancelReasonPrac]
        );
        // Refund GC + pass dans la même TX
        for (const bk of listRes.rows) {
          try { await refundGiftCardForBooking(bk.id, client); } catch (e) { console.warn('[PRAC DEL] GC:', e.message); }
          try { await refundPassForBooking(bk.id, client); } catch (e) { console.warn('[PRAC DEL] Pass:', e.message); }
        }
        // Void draft/sent invoices des bookings cancelled
        const bkIds = listRes.rows.map(r => r.id);
        if (bkIds.length > 0) {
          await client.query(
            `UPDATE invoices SET status = 'cancelled', updated_at = NOW()
             WHERE booking_id = ANY($1::uuid[]) AND status IN ('draft', 'sent')`,
            [bkIds]
          );
        }
        return listRes.rows;
      });
      cancelledCount = txTargets.length;
      cancelledDetails = txTargets;

      // 2) Post-TX : Stripe refunds + emails + SSE + calSync (external APIs, hors tx)
      const _stripeKeyPrac = process.env.STRIPE_SECRET_KEY;
      for (const bk of cancelledDetails) {
        // Stripe refund si deposit paid via pi_/cs_
        if (bk.deposit_status === 'paid' && bk.deposit_payment_intent_id && _stripeKeyPrac &&
            (bk.deposit_payment_intent_id.startsWith('pi_') || bk.deposit_payment_intent_id.startsWith('cs_'))) {
          try {
            const _s = require('stripe')(_stripeKeyPrac);
            let _piId = bk.deposit_payment_intent_id;
            if (_piId.startsWith('cs_')) {
              const _sess = await _s.checkout.sessions.retrieve(_piId);
              _piId = _sess.payment_intent;
            }
            if (_piId && _piId.startsWith('pi_')) {
              await _s.refunds.create({ payment_intent: _piId });
              await queryWithRLS(bid,
                `UPDATE bookings SET deposit_status = 'refunded' WHERE id = $1`, [bk.id]
              );
            }
          } catch (e) {
            if (e.code !== 'charge_already_refunded') console.warn(`[PRAC DEL] Stripe refund ${bk.id}:`, e.message);
          }
        }
        // calSyncDelete
        try { const { calSyncDelete } = require('./bookings-helpers'); calSyncDelete(bid, bk.id); } catch (_) {}
        // Queue email_cancellation_pro
        try {
          await query(
            `INSERT INTO notifications (business_id, booking_id, type, status) VALUES ($1, $2, 'email_cancellation_pro', 'queued')`,
            [bid, bk.id]
          );
        } catch (_) {}
      }
      // Broadcast SSE (un seul pour le batch)
      try {
        const { broadcast } = require('../../services/sse');
        if (broadcast) broadcast(bid, 'booking_update', { action: 'practitioner_removed_cascade', practitioner_id: pracId, count: cancelledCount });
      } catch (_) {}
      // Invalidate minisite cache (bookings libérés)
      try { const { invalidateMinisiteCache } = require('../public/helpers'); invalidateMinisiteCache(bid); } catch (_) {}
    }

    if (req.query.permanent === 'true') {
      // Block if future bookings still exist (must cancel them first)
      if (futureCount > 0 && !cancelBookings) {
        return res.status(409).json({
          error: `Ce praticien a encore ${futureCount} RDV à venir. Annulez-les d'abord pour pouvoir supprimer.`,
          future_bookings_count: futureCount
        });
      }

      // Permanent delete: remove linked user account + practitioner record
      const pracData = await queryWithRLS(bid,
        `SELECT user_id FROM practitioners WHERE id = $1 AND business_id = $2`,
        [pracId, bid]
      );

      // Remove linked user account if exists
      if (pracData.rows[0]?.user_id) {
        await query(
          `DELETE FROM users WHERE id = $1 AND business_id = $2`,
          [pracData.rows[0].user_id, bid]
        );
      }

      // practitioner_services has ON DELETE CASCADE — cleaned up automatically

      // Nullify practitioner_id on past bookings to avoid FK violation on delete
      await queryWithRLS(bid,
        `UPDATE bookings SET practitioner_id = NULL, updated_at = NOW()
         WHERE practitioner_id = $1 AND business_id = $2
           AND (start_at <= NOW() OR status IN ('cancelled', 'no_show', 'completed'))`,
        [pracId, bid]
      );

      // Delete the practitioner record
      await queryWithRLS(bid,
        `DELETE FROM practitioners WHERE id = $1 AND business_id = $2`,
        [pracId, bid]
      );

      return res.json({ deleted: true, permanent: true, cancelled_count: cancelledCount });
    }

    // Deactivate the practitioner
    await queryWithRLS(bid,
      `UPDATE practitioners SET is_active = false, booking_enabled = false, updated_at = NOW()
       WHERE id = $1 AND business_id = $2`,
      [pracId, bid]
    );

    // Keep practitioner_services intact so competencies are preserved on reactivation

    // Cancel active waitlist entries for this practitioner (no point offering slots for inactive prac)
    await queryWithRLS(bid,
      `UPDATE waitlist_entries SET status = 'cancelled', updated_at = NOW()
       WHERE practitioner_id = $1 AND business_id = $2 AND status IN ('waiting', 'offered')`,
      [pracId, bid]
    ).catch(() => {});

    res.json({ deleted: true, cancelled_count: cancelledCount, future_bookings_kept: keepBookings ? futureCount : 0 });
  } catch (err) { next(err); }
});

// ============================================================
// POST /api/practitioners/:id/invite — create login for practitioner
// ============================================================
router.post('/:id/invite', requireOwner, blockIfImpersonated, async (req, res, next) => {
  try {
    const bid = req.businessId;
    const { id } = req.params;
    const { email, password, role } = req.body;

    if (!email) return res.status(400).json({ error: 'Email requis' });
    if (!password) return res.status(400).json({ error: 'Mot de passe requis' });
    if (password.length < 8) return res.status(400).json({ error: 'Mot de passe trop court (minimum 8 caractères)' });

    const validRoles = ['owner', 'practitioner'];
    const userRole = validRoles.includes(role) ? role : 'practitioner';

    const pract = await queryWithRLS(bid,
      `SELECT id, user_id, display_name FROM practitioners WHERE id = $1 AND business_id = $2`,
      [id, bid]
    );
    if (pract.rows.length === 0) return res.status(404).json({ error: 'Praticien introuvable' });
    if (pract.rows[0].user_id) return res.status(400).json({ error: 'Ce praticien a déjà un compte' });

    const existing = await query(
      `SELECT id FROM users WHERE LOWER(email) = $1 AND business_id = $2`,
      [email.toLowerCase().trim(), bid]
    );
    if (existing.rows.length > 0) return res.status(409).json({ error: 'Cet email est déjà utilisé' });

    const hash = password ? await bcrypt.hash(password, 12) : null;
    const userResult = await query(
      `INSERT INTO users (business_id, email, password_hash, role)
       VALUES ($1, $2, $3, $4)
       RETURNING id, email, role`,
      [bid, email.toLowerCase().trim(), hash, userRole]
    );
    const userId = userResult.rows[0].id;

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
router.patch('/:id/role', requireOwner, blockIfImpersonated, async (req, res, next) => {
  try {
    const bid = req.businessId;
    const { id } = req.params;
    const { role } = req.body;

    const validRoles = ['owner', 'practitioner'];
    if (!validRoles.includes(role)) {
      return res.status(400).json({ error: `Rôle invalide. Valeurs acceptées : ${validRoles.join(', ')}` });
    }

    const pract = await queryWithRLS(bid,
      `SELECT p.id, p.user_id, p.display_name, u.role AS current_role
       FROM practitioners p
       LEFT JOIN users u ON u.id = p.user_id
       WHERE p.id = $1 AND p.business_id = $2`,
      [id, bid]
    );

    if (pract.rows.length === 0) return res.status(404).json({ error: 'Praticien introuvable' });
    if (!pract.rows[0].user_id) return res.status(400).json({ error: 'Ce praticien n\'a pas de compte utilisateur' });

    if (pract.rows[0].current_role === 'owner') {
      return res.status(403).json({ error: 'Impossible de modifier le rôle du propriétaire' });
    }

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
