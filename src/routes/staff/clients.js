const router = require('express').Router();
const { queryWithRLS, transactionWithRLS } = require('../../services/db');
const { requireAuth, requireOwner, resolvePractitionerScope } = require('../../middleware/auth');

router.use(requireAuth);
router.use(resolvePractitionerScope);

// GET /api/clients — list clients with search + stats
// UI: Dashboard > Clients table
router.get('/', async (req, res, next) => {
  try {
    const bid = req.businessId;
    const { search, limit, offset, filter } = req.query;

    const params = [bid];
    let idx = 2;
    // N14 fix: si pracFilter, le JOIN doit aussi filtrer par practitioner_id pour que les
    // stats (total_bookings, completed_count, last_visit, tag) reflètent UNIQUEMENT les bookings
    // que le practitioner a avec ce client. Avant: stats globales business leakaient.
    let joinFilter = '';
    if (req.practitionerFilter) {
      params.push(req.practitionerFilter);
      joinFilter = ` AND b.practitioner_id = $${idx}`;
      idx++;
    }

    let sql = `
      SELECT c.*,
        COUNT(b.id) AS total_bookings,
        COUNT(b.id) FILTER (WHERE b.status = 'completed') AS completed_count,
        MAX(b.start_at) AS last_visit
      FROM clients c
      LEFT JOIN bookings b ON b.client_id = c.id AND b.business_id = c.business_id${joinFilter}
      WHERE c.business_id = $1`;

    // Practitioner scope: only show clients who have bookings with this practitioner
    if (req.practitionerFilter) {
      // Réutilise $2 (pracId déjà pushé ci-dessus)
      sql += ` AND c.id IN (SELECT DISTINCT client_id FROM bookings WHERE practitioner_id = $2 AND business_id = $1)`;
    }

    if (search) {
      const escapedSearch = search.replace(/[%_\\]/g, '\\$&');
      sql += ` AND (c.full_name ILIKE $${idx} OR c.phone ILIKE $${idx} OR c.email ILIKE $${idx})`;
      params.push(`%${escapedSearch}%`);
      idx++;
    }

    // Filters
    if (filter === 'blocked') {
      sql += ` AND c.is_blocked = true`;
    } else if (filter === 'flagged') {
      sql += ` AND c.no_show_count > 0`;
    } else if (filter === 'fantome') {
      sql += ` AND c.expired_pending_count > 0`;
    } else if (filter === 'vip') {
      sql += ` AND c.is_vip = true`;
    } else if (filter === 'birthday_week') {
      sql += ` AND c.birthday IS NOT NULL AND (
        TO_CHAR(c.birthday, 'MM-DD') BETWEEN TO_CHAR(CURRENT_DATE, 'MM-DD') AND TO_CHAR(CURRENT_DATE + INTERVAL '7 days', 'MM-DD')
        OR (TO_CHAR(CURRENT_DATE, 'MM-DD') > TO_CHAR(CURRENT_DATE + INTERVAL '7 days', 'MM-DD')
            AND (TO_CHAR(c.birthday, 'MM-DD') >= TO_CHAR(CURRENT_DATE, 'MM-DD') OR TO_CHAR(c.birthday, 'MM-DD') <= TO_CHAR(CURRENT_DATE + INTERVAL '7 days', 'MM-DD')))
      )`;
    }

    sql += ` GROUP BY c.id ORDER BY last_visit DESC NULLS LAST`;
    // Bornes alignées sur invoices/gift-cards/passes/reviews/waitlist :
    // limit ∈ [1, 200] default 50, offset ≥ 0. Empêche DoS / exfil par `?limit=99999`.
    const limitVal = Math.min(Math.max(parseInt(limit) || 50, 1), 200);
    const offsetVal = Math.max(parseInt(offset) || 0, 0);
    sql += ` LIMIT $${idx} OFFSET $${idx + 1}`;
    params.push(limitVal, offsetVal);

    const result = await queryWithRLS(bid, sql, params);

    // Total count
    let countSql = `SELECT COUNT(*) FROM clients WHERE business_id = $1`;
    const countParams = [bid];
    let countIdx = 2;
    if (req.practitionerFilter) {
      countSql += ` AND id IN (SELECT DISTINCT client_id FROM bookings WHERE practitioner_id = $${countIdx} AND business_id = $1)`;
      countParams.push(req.practitionerFilter);
      countIdx++;
    }
    if (search) {
      const escapedCountSearch = search.replace(/[%_\\]/g, '\\$&');
      countSql += ` AND (full_name ILIKE $${countIdx} OR phone ILIKE $${countIdx} OR email ILIKE $${countIdx})`;
      countParams.push(`%${escapedCountSearch}%`);
      countIdx++;
    }
    if (filter === 'blocked') { countSql += ` AND is_blocked = true`; }
    else if (filter === 'flagged') { countSql += ` AND no_show_count > 0`; }
    else if (filter === 'fantome') { countSql += ` AND expired_pending_count > 0`; }
    else if (filter === 'vip') { countSql += ` AND is_vip = true`; }
    else if (filter === 'birthday_week') {
      countSql += ` AND birthday IS NOT NULL AND (
        TO_CHAR(birthday, 'MM-DD') BETWEEN TO_CHAR(CURRENT_DATE, 'MM-DD') AND TO_CHAR(CURRENT_DATE + INTERVAL '7 days', 'MM-DD')
        OR (TO_CHAR(CURRENT_DATE, 'MM-DD') > TO_CHAR(CURRENT_DATE + INTERVAL '7 days', 'MM-DD')
            AND (TO_CHAR(birthday, 'MM-DD') >= TO_CHAR(CURRENT_DATE, 'MM-DD') OR TO_CHAR(birthday, 'MM-DD') <= TO_CHAR(CURRENT_DATE + INTERVAL '7 days', 'MM-DD')))
      )`;
    }
    const countResult = await queryWithRLS(bid, countSql, countParams);

    // Stats
    const statsResult = await queryWithRLS(bid,
      `SELECT
        COUNT(*) AS total,
        COUNT(*) FILTER (WHERE is_blocked = true) AS blocked,
        COUNT(*) FILTER (WHERE no_show_count > 0 AND is_blocked = false) AS flagged,
        COUNT(*) FILTER (WHERE expired_pending_count > 0 AND is_blocked = false) AS fantome,
        COUNT(*) FILTER (WHERE no_show_count = 0 AND expired_pending_count = 0 AND is_blocked = false) AS clean,
        COUNT(*) FILTER (WHERE is_vip = true) AS vip,
        COUNT(*) FILTER (WHERE birthday IS NOT NULL AND (
          TO_CHAR(birthday, 'MM-DD') BETWEEN TO_CHAR(CURRENT_DATE, 'MM-DD') AND TO_CHAR(CURRENT_DATE + INTERVAL '7 days', 'MM-DD')
          OR (TO_CHAR(CURRENT_DATE, 'MM-DD') > TO_CHAR(CURRENT_DATE + INTERVAL '7 days', 'MM-DD')
              AND (TO_CHAR(birthday, 'MM-DD') >= TO_CHAR(CURRENT_DATE, 'MM-DD') OR TO_CHAR(birthday, 'MM-DD') <= TO_CHAR(CURRENT_DATE + INTERVAL '7 days', 'MM-DD')))
        )) AS birthday_week
       FROM clients WHERE business_id = $1`,
      [bid]
    );

    const total_count = parseInt(countResult.rows[0].count) || 0;
    // limitVal/offsetVal déjà validés ci-dessus (bornés)
    res.json({
      clients: result.rows.map(c => ({
        ...c,
        total_bookings: parseInt(c.total_bookings),
        completed_count: parseInt(c.completed_count),
        tag: c.is_blocked ? 'bloqué'
           : c.no_show_count >= 3 ? 'récidiviste'
           : c.no_show_count >= 1 ? 'à surveiller'
           : c.expired_pending_count >= 3 ? 'fantôme'
           : parseInt(c.completed_count) >= 5 ? 'fidèle'
           : parseInt(c.total_bookings) === 0 ? 'nouveau'
           : 'actif'
      })),
      total: total_count, // backward compat (frontend fallback)
      stats: statsResult.rows[0],
      pagination: { total_count, limit: limitVal, offset: offsetVal }
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/clients — quick create client (from calendar quick-create)
router.post('/', async (req, res, next) => {
  try {
    const bid = req.businessId;
    const { full_name, phone, email } = req.body;
    if (!full_name?.trim()) return res.status(400).json({ error: 'Nom requis' });

    // Check for existing client with same phone or email
    if (phone || email) {
      const existing = await queryWithRLS(bid,
        `SELECT id, full_name FROM clients WHERE business_id = $1 AND (($2::text IS NOT NULL AND phone = $2::text) OR ($3::text IS NOT NULL AND LOWER(email) = LOWER($3::text))) LIMIT 1`,
        [bid, phone || null, email || null]
      );
      if (existing.rows.length > 0) {
        return res.status(409).json({ error: `Un client avec ce ${phone && existing.rows[0] ? 'téléphone' : 'email'} existe déjà : ${existing.rows[0].full_name}` });
      }
    }
    const result = await queryWithRLS(bid,
      `INSERT INTO clients (business_id, full_name, phone, email)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [bid, full_name.trim(), phone || null, email || null]
    );
    res.status(201).json({ client: result.rows[0] });
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Un client avec ce téléphone ou email existe déjà' });
    next(err);
  }
});

// POST /api/clients/import — bulk import from CSV data
router.post('/import', requireOwner, async (req, res, next) => {
  try {
    const bid = req.businessId;
    const { clients } = req.body;
    if (!Array.isArray(clients) || clients.length === 0) {
      return res.status(400).json({ error: 'clients[] requis' });
    }
    if (clients.length > 500) {
      return res.status(400).json({ error: 'Maximum 500 clients par import' });
    }

    const { normalizeE164 } = require('../../utils/phone');
    // Get existing phones and emails for duplicate detection.
    // Phones are normalized to E.164 to avoid format-only false negatives.
    const existing = await queryWithRLS(bid,
      `SELECT phone, LOWER(TRIM(email)) AS email FROM clients WHERE business_id = $1`,
      [bid]
    );
    const existingPhones = new Set(
      existing.rows.map(r => normalizeE164(r.phone, 'BE')).filter(Boolean)
    );
    const existingEmails = new Set(existing.rows.map(r => r.email).filter(Boolean));

    const _emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    let imported = 0, skipped = 0;
    const errors = []; // { line, reason } for the frontend preview
    // Wrap the entire batch in a single transaction so a fatal error rolls back partial inserts.
    await transactionWithRLS(bid, async (txClient) => {
      for (let i = 0; i < clients.length; i++) {
        const c = clients[i];
        const line = i + 1; // 1-indexed for user display
        const name = (c.full_name || '').trim();
        if (!name) { skipped++; errors.push({ line, reason: 'nom manquant' }); continue; }
        const rawPhone = (c.phone || '').trim();
        if (rawPhone && !normalizeE164(rawPhone, 'BE')) {
          skipped++; errors.push({ line, reason: 'téléphone invalide (formats BE/FR/LU)' }); continue;
        }
        const phone = rawPhone ? normalizeE164(rawPhone, 'BE') : null;
        const email = (c.email || '').trim() || null;
        if (email && !_emailRe.test(email)) {
          skipped++; errors.push({ line, reason: 'email invalide' }); continue;
        }

        // Dedup
        if (phone && existingPhones.has(phone)) { skipped++; errors.push({ line, reason: 'doublon (téléphone)' }); continue; }
        if (email && existingEmails.has(email.toLowerCase())) { skipped++; errors.push({ line, reason: 'doublon (email)' }); continue; }

        try {
          await txClient.query(
            `INSERT INTO clients (business_id, full_name, phone, email) VALUES ($1, $2, $3, $4)`,
            [bid, name, phone, email]
          );
          if (phone) existingPhones.add(phone);
          if (email) existingEmails.add(email.toLowerCase());
          imported++;
        } catch (e) {
          if (e.code === '23505') {
            skipped++; errors.push({ line, reason: 'doublon DB' }); continue;
          }
          throw e; // bubble up — transaction rollbacks
        }
      }
    });

    res.json({ imported, skipped, total: clients.length, errors: errors.slice(0, 50) });
  } catch (err) {
    next(err);
  }
});

// ============================================================
// GET /api/clients/export — CSV export (MUST be before /:id)
// UI: Settings > Zone danger > Exporter mes données
// ============================================================
router.get('/export', requireOwner, async (req, res, next) => {
  try {
    const bid = req.businessId;
    const result = await queryWithRLS(bid,
      `SELECT c.*,
              (SELECT COUNT(*) FROM bookings b WHERE b.client_id = c.id AND b.status IN ('confirmed', 'completed')) AS total_bookings,
              (SELECT COUNT(*) FROM bookings b WHERE b.client_id = c.id AND b.status = 'no_show') AS no_shows,
              (SELECT COUNT(*) FROM bookings b WHERE b.client_id = c.id AND b.status = 'cancelled') AS cancellations,
              (SELECT MAX(b.start_at) FROM bookings b WHERE b.client_id = c.id AND b.status IN ('confirmed', 'completed')) AS last_visit,
              (SELECT COALESCE(SUM(COALESCE(b.booked_price_cents, 0) - COALESCE(b.promotion_discount_cents, 0)), 0)
               FROM bookings b WHERE b.client_id = c.id AND b.status IN ('confirmed', 'completed')) AS total_revenue_cents
       FROM clients c
       WHERE c.business_id = $1
       ORDER BY c.full_name`,
      [bid]
    );

    const fmt = (d) => d ? new Date(d).toLocaleDateString('fr-BE', { timeZone: 'Europe/Brussels' }) : '';
    const fmtEur = (c) => ((c || 0) / 100).toFixed(2).replace('.', ',');
    const esc = (s) => `"${(s || '').replace(/"/g, '""')}"`;

    const header = '"Nom";"Email";"Téléphone";"Langue";"Consentement SMS";"Consentement email";"Consentement marketing";"BCE";"Notes";"Remarques";"Date anniversaire";"VIP";"Créé le";"Source";"RDV total";"No-shows";"Annulations";"Dernière visite";"CA total (€)"\n';
    const rows = result.rows.map(r => [
      esc(r.full_name),
      esc(r.email || ''),
      esc(r.phone || ''),
      esc(r.language_preference || ''),
      esc(r.consent_sms ? 'Oui' : 'Non'),
      esc(r.consent_email !== false ? 'Oui' : 'Non'),
      esc(r.consent_marketing ? 'Oui' : 'Non'),
      esc(r.bce_number || ''),
      esc(r.notes),
      esc(r.remarks),
      esc(r.birthday || ''),
      esc(r.is_vip ? 'Oui' : ''),
      esc(fmt(r.created_at)),
      esc(r.created_from || ''),
      esc(String(r.total_bookings || 0)),
      esc(String(r.no_shows || 0)),
      esc(String(r.cancellations || 0)),
      esc(fmt(r.last_visit)),
      esc(fmtEur(parseInt(r.total_revenue_cents) || 0))
    ].join(';')).join('\n');

    const csv = '\uFEFF' + header + rows;
    const filename = `clients-${new Date().toISOString().split('T')[0]}.csv`;
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(csv);
  } catch (err) { next(err); }
});

// GET /api/clients/:id — client detail with booking history
router.get('/:id', async (req, res, next) => {
  try {
    // L5: UUID validation
    const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!UUID_RE.test(req.params.id)) return res.status(400).json({ error: 'ID invalide' });
    const bid = req.businessId;

    const client = await queryWithRLS(bid,
      `SELECT id, business_id, full_name, phone, email, bce_number, notes, remarks, birthday,
              consent_sms, consent_marketing, no_show_count, is_blocked,
              blocked_at, blocked_reason, last_no_show_at, is_vip,
              expired_pending_count, last_expired_pending_at,
              created_at, updated_at
       FROM clients WHERE id = $1 AND business_id = $2`,
      [req.params.id, bid]
    );
    if (client.rows.length === 0) return res.status(404).json({ error: 'Client introuvable' });

    // V12-022: Add practitioner scope to bookings query
    let bkSql = `SELECT b.id, b.start_at, b.end_at, b.status, b.appointment_mode,
              b.deposit_required, b.deposit_status, b.deposit_amount_cents,
              b.promotion_label, b.promotion_discount_cents,
              b.custom_label, b.internal_note, b.comment_client, b.session_notes, b.session_notes_sent_at,
              b.created_at, b.channel,
              s.name AS service_name, p.display_name AS practitioner_name,
              (SELECT COALESCE(pr.display_name, u.email)
               FROM audit_logs al
               LEFT JOIN users u ON u.id = al.actor_user_id
               LEFT JOIN practitioners pr ON pr.user_id = u.id AND pr.business_id = al.business_id
               WHERE al.entity_type = 'booking' AND al.entity_id = b.id AND al.action = 'create'
               LIMIT 1
              ) AS created_by_name
       FROM bookings b
       LEFT JOIN services s ON s.id = b.service_id
       JOIN practitioners p ON p.id = b.practitioner_id
       WHERE b.client_id = $1 AND b.business_id = $2`;
    const bkParams = [req.params.id, bid];

    if (req.practitionerFilter) {
      bkSql += ` AND b.practitioner_id = $${bkParams.length + 1}`;
      bkParams.push(req.practitionerFilter);
    }

    bkSql += ` ORDER BY b.start_at DESC`;

    const bookings = await queryWithRLS(bid, bkSql, bkParams);

    // Gift card balances for this client
    const email = client.rows[0].email;
    let giftCards = [];
    if (email) {
      const gcRes = await queryWithRLS(bid,
        `SELECT gc.id, gc.code, gc.amount_cents, gc.balance_cents, gc.status, gc.expires_at, gc.created_at,
                (SELECT json_agg(json_build_object(
                  'id', t.id, 'amount_cents', t.amount_cents, 'type', t.type,
                  'note', t.note, 'booking_id', t.booking_id, 'created_at', t.created_at
                ) ORDER BY t.created_at DESC)
                FROM gift_card_transactions t WHERE t.gift_card_id = gc.id) AS transactions
         FROM gift_cards gc
         WHERE gc.business_id = $1 AND (LOWER(gc.recipient_email) = LOWER($2) OR LOWER(gc.buyer_email) = LOWER($2))
           AND gc.status IN ('active', 'used')
         ORDER BY gc.created_at DESC`,
        [bid, email]
      );
      giftCards = gcRes.rows;
    }

    // Pass balances for this client
    let passes = [];
    if (email) {
      const passRes = await queryWithRLS(bid,
        `SELECT p.id, p.code, p.name, p.sessions_total, p.sessions_remaining, p.status, p.expires_at, p.created_at,
                s.name AS service_name,
                (SELECT json_agg(json_build_object(
                  'id', t.id, 'sessions', t.sessions, 'type', t.type,
                  'note', t.note, 'booking_id', t.booking_id, 'created_at', t.created_at
                ) ORDER BY t.created_at DESC)
                FROM pass_transactions t WHERE t.pass_id = p.id) AS transactions
         FROM passes p
         LEFT JOIN services s ON s.id = p.service_id
         WHERE p.business_id = $1 AND LOWER(p.buyer_email) = LOWER($2)
           AND p.status IN ('active', 'used')
         ORDER BY p.created_at DESC`,
        [bid, email]
      );
      passes = passRes.rows;
    }

    res.json({ client: client.rows[0], bookings: bookings.rows, gift_cards: giftCards, passes });
  } catch (err) {
    next(err);
  }
});

// PATCH /api/clients/:id — update client
// V11-013: Only owner can edit client details
router.patch('/:id', requireOwner, async (req, res, next) => {
  try {
    const bid = req.businessId;
    const sets = [];
    const params = [];
    let idx = 1;

    // N19 fix: validation format email/phone avant UPDATE (parité avec POST /import L184).
    // Avant: un pro pouvait sauver "pas un email" → notification silencieuses ensuite.
    const _emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if ('email' in req.body && req.body.email) {
      const _em = String(req.body.email).trim();
      if (_em.length > 320 || !_emailRe.test(_em)) {
        return res.status(400).json({ error: 'Format email invalide' });
      }
    }
    if ('phone' in req.body && req.body.phone) {
      const _ph = String(req.body.phone).trim();
      if (_ph.length > 30) {
        return res.status(400).json({ error: 'Téléphone trop long' });
      }
    }

    const fieldMap = { full_name: 'full_name', phone: 'phone', email: 'email',
      bce_number: 'bce_number', notes: 'notes', remarks: 'remarks', birthday: 'birthday',
      consent_sms: 'consent_sms', consent_marketing: 'consent_marketing', is_vip: 'is_vip' };
    for (const [bodyKey, col] of Object.entries(fieldMap)) {
      if (bodyKey in req.body) {
        sets.push(`${col} = $${idx}`);
        params.push(req.body[bodyKey]);
        idx++;
      }
    }

    if (sets.length === 0) return res.status(400).json({ error: 'Aucun champ à modifier' });

    sets.push('updated_at = NOW()');
    params.push(req.params.id, bid);

    const result = await queryWithRLS(bid,
      `UPDATE clients SET ${sets.join(', ')}
       WHERE id = $${idx} AND business_id = $${idx + 1}
       RETURNING *`,
      params
    );

    if (result.rows.length === 0) return res.status(404).json({ error: 'Client introuvable' });
    res.json({ client: result.rows[0] });
  } catch (err) {
    next(err);
  }
});

// ============================================================
// POST /api/clients/:id/block — block client from online booking
// ============================================================
router.post('/:id/block', requireOwner, async (req, res, next) => {
  try {
    const bid = req.businessId;
    const { reason } = req.body;

    const result = await queryWithRLS(bid,
      `UPDATE clients SET
        is_blocked = true,
        blocked_at = NOW(),
        blocked_reason = $1,
        updated_at = NOW()
       WHERE id = $2 AND business_id = $3
       RETURNING id, full_name, is_blocked`,
      [reason || 'Bloqué manuellement', req.params.id, bid]
    );

    if (result.rows.length === 0) return res.status(404).json({ error: 'Client introuvable' });
    res.json({ blocked: true, client: result.rows[0] });
  } catch (err) { next(err); }
});

// ============================================================
// POST /api/clients/:id/unblock — unblock client
// ============================================================
router.post('/:id/unblock', requireOwner, async (req, res, next) => {
  try {
    const bid = req.businessId;

    const result = await queryWithRLS(bid,
      `UPDATE clients SET
        is_blocked = false,
        blocked_at = NULL,
        blocked_reason = NULL,
        updated_at = NOW()
       WHERE id = $1 AND business_id = $2
       RETURNING id, full_name, is_blocked`,
      [req.params.id, bid]
    );

    if (result.rows.length === 0) return res.status(404).json({ error: 'Client introuvable' });
    res.json({ unblocked: true, client: result.rows[0] });
  } catch (err) { next(err); }
});

// ============================================================
// POST /api/clients/:id/reset-noshow — reset no-show counter
// ============================================================
router.post('/:id/reset-noshow', requireOwner, async (req, res, next) => {
  try {
    const bid = req.businessId;

    const result = await queryWithRLS(bid,
      `UPDATE clients SET
        no_show_count = 0,
        is_blocked = false,
        blocked_at = NULL,
        blocked_reason = NULL,
        last_no_show_at = NULL,
        updated_at = NOW()
       WHERE id = $1 AND business_id = $2
       RETURNING id, full_name, no_show_count, is_blocked`,
      [req.params.id, bid]
    );

    if (result.rows.length === 0) return res.status(404).json({ error: 'Client introuvable' });
    res.json({ reset: true, client: result.rows[0] });
  } catch (err) { next(err); }
});

// ============================================================
// POST /api/clients/:id/reset-expired — reset expired pending counter
// ============================================================
router.post('/:id/reset-expired', requireOwner, async (req, res, next) => {
  try {
    const bid = req.businessId;

    const result = await queryWithRLS(bid,
      `UPDATE clients SET
        expired_pending_count = 0,
        last_expired_pending_at = NULL,
        updated_at = NOW()
       WHERE id = $1 AND business_id = $2
       RETURNING id, full_name, expired_pending_count`,
      [req.params.id, bid]
    );

    if (result.rows.length === 0) return res.status(404).json({ error: 'Client introuvable' });
    res.json({ reset: true, client: result.rows[0] });
  } catch (err) { next(err); }
});

module.exports = router;
