const router = require('express').Router();
const { queryWithRLS } = require('../../services/db');
const { requireAuth, requireOwner } = require('../../middleware/auth');
const { sendEmail, buildEmailHTML, escHtml } = require('../../services/email');

router.use(requireAuth);

// ============================================================
// Helper: log absence activity
// ============================================================
async function logAbsence(bid, absenceId, action, details, actorName) {
  try {
    await queryWithRLS(bid,
      `INSERT INTO absence_logs (business_id, absence_id, action, details, actor_name)
       VALUES ($1, $2, $3, $4, $5)`,
      [bid, absenceId, action, details ? JSON.stringify(details) : null, actorName || null]
    );
  } catch (e) {
    console.error('[PLANNING] Log error:', e.message);
  }
}

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
      `SELECT sa.*, p.display_name AS practitioner_name, p.color AS practitioner_color, p.email AS practitioner_email
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
      `SELECT sa.*, p.display_name AS practitioner_name, p.email AS practitioner_email
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
    const { practitioner_id, date_from, date_to, type, note, period } = req.body;

    if (!practitioner_id) return res.status(400).json({ error: 'Praticien requis' });
    if (!date_from || !date_to) return res.status(400).json({ error: 'Dates requises' });
    if (date_from > date_to) return res.status(400).json({ error: 'Date de début doit être avant la date de fin' });

    const validTypes = ['conge', 'maladie', 'formation', 'autre'];
    const absType = validTypes.includes(type) ? type : 'conge';

    const validPeriods = ['full', 'am', 'pm'];
    const absPeriod = validPeriods.includes(period) ? period : 'full';

    // Check practitioner belongs to this business
    const pracCheck = await queryWithRLS(bid,
      `SELECT id, display_name FROM practitioners WHERE id = $1 AND business_id = $2`,
      [practitioner_id, bid]
    );
    if (pracCheck.rows.length === 0) return res.status(404).json({ error: 'Praticien introuvable' });

    // Check for overlapping absences (with period awareness)
    const overlapQuery = `SELECT id, period FROM staff_absences
       WHERE business_id = $1 AND practitioner_id = $2
         AND date_from <= $4::date AND date_to >= $3::date`;
    const overlap = await queryWithRLS(bid, overlapQuery, [bid, practitioner_id, date_from, date_to]);

    // Allow overlap only if periods are complementary (am vs pm)
    const hasRealOverlap = overlap.rows.some(o => {
      if (absPeriod === 'full' || o.period === 'full') return true;
      if (absPeriod === o.period) return true;
      return false; // am + pm = OK
    });
    if (hasRealOverlap) {
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
      `INSERT INTO staff_absences (business_id, practitioner_id, date_from, date_to, type, note, period)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [bid, practitioner_id, date_from, date_to, absType, note || null, absPeriod]
    );

    const absence = result.rows[0];

    // Log creation
    const pracName = pracCheck.rows[0].display_name;
    await logAbsence(bid, absence.id, 'created', {
      type: absType, period: absPeriod, date_from, date_to, practitioner: pracName
    }, req.user?.name || req.user?.email || 'Système');

    res.status(201).json({
      absence,
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
    const { date_from, date_to, type, note, period } = req.body;

    // Fetch current values for change logging
    const current = await queryWithRLS(bid,
      `SELECT sa.*, p.display_name AS practitioner_name FROM staff_absences sa
       JOIN practitioners p ON p.id = sa.practitioner_id
       WHERE sa.id = $1 AND sa.business_id = $2`,
      [id, bid]
    );
    if (current.rows.length === 0) return res.status(404).json({ error: 'Absence introuvable' });
    const old = current.rows[0];

    const sets = [];
    const params = [id, bid];
    let idx = 3;
    const changes = {};

    if (date_from !== undefined) { sets.push(`date_from = $${idx}`); params.push(date_from); idx++; if (date_from !== old.date_from?.toISOString?.()?.slice(0,10)) changes.date_from = { from: old.date_from, to: date_from }; }
    if (date_to !== undefined) { sets.push(`date_to = $${idx}`); params.push(date_to); idx++; if (date_to !== old.date_to?.toISOString?.()?.slice(0,10)) changes.date_to = { from: old.date_to, to: date_to }; }
    if (type !== undefined) { sets.push(`type = $${idx}`); params.push(type); idx++; if (type !== old.type) changes.type = { from: old.type, to: type }; }
    if (note !== undefined) { sets.push(`note = $${idx}`); params.push(note); idx++; if (note !== old.note) changes.note = { from: old.note, to: note }; }
    if (period !== undefined) { sets.push(`period = $${idx}`); params.push(period); idx++; if (period !== old.period) changes.period = { from: old.period, to: period }; }

    if (sets.length === 0) return res.status(400).json({ error: 'Rien à modifier' });
    sets.push('updated_at = NOW()');

    const result = await queryWithRLS(bid,
      `UPDATE staff_absences SET ${sets.join(', ')} WHERE id = $1 AND business_id = $2 RETURNING *`,
      params
    );

    // Log modification
    if (Object.keys(changes).length > 0) {
      await logAbsence(bid, id, 'modified', { changes, practitioner: old.practitioner_name },
        req.user?.name || req.user?.email || 'Système');
    }

    res.json({ absence: result.rows[0] });
  } catch (err) { next(err); }
});

// ============================================================
// DELETE /api/planning/absences/:id — delete absence
// ============================================================
router.delete('/absences/:id', requireOwner, async (req, res, next) => {
  try {
    const bid = req.businessId;

    // Fetch before delete for logging
    const current = await queryWithRLS(bid,
      `SELECT sa.*, p.display_name AS practitioner_name FROM staff_absences sa
       JOIN practitioners p ON p.id = sa.practitioner_id
       WHERE sa.id = $1 AND sa.business_id = $2`,
      [req.params.id, bid]
    );
    if (current.rows.length === 0) return res.status(404).json({ error: 'Absence introuvable' });
    const old = current.rows[0];

    // Log BEFORE delete (FK cascade will remove logs otherwise)
    await logAbsence(bid, req.params.id, 'cancelled', {
      type: old.type, period: old.period, date_from: old.date_from, date_to: old.date_to,
      practitioner: old.practitioner_name
    }, req.user?.name || req.user?.email || 'Système');

    await queryWithRLS(bid,
      `DELETE FROM staff_absences WHERE id = $1 AND business_id = $2`,
      [req.params.id, bid]
    );
    res.json({ deleted: true });
  } catch (err) { next(err); }
});

// ============================================================
// GET /api/planning/absences/:id/logs — activity logs
// ============================================================
router.get('/absences/:id/logs', async (req, res, next) => {
  try {
    const bid = req.businessId;
    const result = await queryWithRLS(bid,
      `SELECT * FROM absence_logs
       WHERE absence_id = $1 AND business_id = $2
       ORDER BY created_at DESC`,
      [req.params.id, bid]
    );
    res.json({ logs: result.rows });
  } catch (err) { next(err); }
});

// ============================================================
// POST /api/planning/absences/:id/notify — send email to practitioner
// ============================================================
router.post('/absences/:id/notify', requireOwner, async (req, res, next) => {
  try {
    const bid = req.businessId;

    // Get absence + practitioner email
    const result = await queryWithRLS(bid,
      `SELECT sa.*, p.display_name AS practitioner_name, p.email AS practitioner_email
       FROM staff_absences sa
       JOIN practitioners p ON p.id = sa.practitioner_id
       WHERE sa.id = $1 AND sa.business_id = $2`,
      [req.params.id, bid]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Absence introuvable' });

    const abs = result.rows[0];
    if (!abs.practitioner_email) return res.status(400).json({ error: 'Ce praticien n\'a pas d\'adresse email' });

    // Get business info
    const bizResult = await queryWithRLS(bid,
      `SELECT name, email, theme FROM businesses WHERE id = $1`, [bid]
    );
    const business = bizResult.rows[0] || { name: 'Genda' };

    // Build type label
    const typeLabels = { conge: 'Congé', maladie: 'Maladie', formation: 'Formation', autre: 'Absence' };
    const periodLabels = { full: 'Journée complète', am: 'Matin uniquement', pm: 'Après-midi uniquement' };
    const typeLabel = typeLabels[abs.type] || 'Absence';
    const periodLabel = periodLabels[abs.period] || 'Journée complète';

    const dateFrom = new Date(abs.date_from).toLocaleDateString('fr-BE', {
      timeZone: 'Europe/Brussels', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
    });
    const dateTo = new Date(abs.date_to).toLocaleDateString('fr-BE', {
      timeZone: 'Europe/Brussels', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
    });

    const isSameDay = abs.date_from === abs.date_to ||
      new Date(abs.date_from).toDateString() === new Date(abs.date_to).toDateString();
    const dateRange = isSameDay ? dateFrom : `du ${dateFrom} au ${dateTo}`;

    const bodyHTML = `
      <p>Bonjour <strong>${escHtml(abs.practitioner_name)}</strong>,</p>
      <p>Ceci est une confirmation de votre absence enregistrée :</p>
      <div style="background:#F5F4F1;border-radius:8px;padding:16px;margin:16px 0">
        <div style="font-size:14px;font-weight:600;color:#1A1816;margin-bottom:6px">${escHtml(typeLabel)}</div>
        <div style="font-size:13px;color:#3D3832;margin-bottom:4px">📅 ${escHtml(dateRange)}</div>
        <div style="font-size:13px;color:#3D3832;margin-bottom:4px">🕐 ${escHtml(periodLabel)}</div>
        ${abs.note ? `<div style="font-size:13px;color:#6B6560;margin-top:8px;font-style:italic">📝 ${escHtml(abs.note)}</div>` : ''}
      </div>
      <p style="font-size:13px;color:#9C958E">Ce document fait office de confirmation. Conservez-le pour vos dossiers.</p>`;

    const html = buildEmailHTML({
      title: `Confirmation — ${typeLabel}`,
      preheader: `${typeLabel} ${dateRange}`,
      bodyHTML,
      businessName: business.name,
      primaryColor: business.theme?.primary_color,
      footerText: `${business.name} · Via Genda.be`
    });

    const emailResult = await sendEmail({
      to: abs.practitioner_email,
      toName: abs.practitioner_name,
      subject: `Confirmation ${typeLabel.toLowerCase()} — ${business.name}`,
      html,
      fromName: business.name,
      replyTo: business.email
    });

    // Log email sent
    await logAbsence(bid, abs.id, 'email_sent', {
      to: abs.practitioner_email, success: emailResult.success
    }, req.user?.name || req.user?.email || 'Système');

    if (emailResult.success) {
      res.json({ sent: true, to: abs.practitioner_email });
    } else {
      res.status(500).json({ error: emailResult.error || 'Erreur d\'envoi' });
    }
  } catch (err) { next(err); }
});

// ============================================================
// GET /api/planning/absences/stats?month=2026-03
// Counters per practitioner per type
// ============================================================
router.get('/stats', async (req, res, next) => {
  try {
    const bid = req.businessId;
    const monthParam = req.query.month;
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

    // Count days per practitioner per type, accounting for half-days
    const result = await queryWithRLS(bid,
      `SELECT sa.practitioner_id, sa.type, sa.period,
              sa.date_from, sa.date_to,
              p.display_name AS practitioner_name
       FROM staff_absences sa
       JOIN practitioners p ON p.id = sa.practitioner_id
       WHERE sa.business_id = $1
         AND sa.date_from <= $3::date
         AND sa.date_to >= $2::date
       ORDER BY sa.practitioner_id`,
      [bid, dateFrom, dateTo]
    );

    // Calculate days per practitioner per type
    const stats = {};
    const monthStart = new Date(dateFrom);
    const monthEnd = new Date(dateTo);

    result.rows.forEach(row => {
      if (!stats[row.practitioner_id]) {
        stats[row.practitioner_id] = {
          practitioner_name: row.practitioner_name,
          conge: 0, maladie: 0, formation: 0, autre: 0, total: 0
        };
      }
      const from = new Date(Math.max(new Date(row.date_from), monthStart));
      const to = new Date(Math.min(new Date(row.date_to), monthEnd));

      let days = 0;
      for (let d = new Date(from); d <= to; d.setDate(d.getDate() + 1)) {
        days += row.period === 'full' ? 1 : 0.5;
      }

      stats[row.practitioner_id][row.type] += days;
      stats[row.practitioner_id].total += days;
    });

    // Global totals
    const totals = { conge: 0, maladie: 0, formation: 0, autre: 0, total: 0 };
    Object.values(stats).forEach(s => {
      totals.conge += s.conge;
      totals.maladie += s.maladie;
      totals.formation += s.formation;
      totals.autre += s.autre;
      totals.total += s.total;
    });

    res.json({ stats, totals });
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
