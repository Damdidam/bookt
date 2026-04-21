const router = require('express').Router();
const { queryWithRLS, transactionWithRLS } = require('../../services/db');
const { requireAuth, requireOwner, resolvePractitionerScope, blockIfImpersonated } = require('../../middleware/auth');
const { normalizeE164 } = require('../../utils/phone');

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
router.post('/', blockIfImpersonated, async (req, res, next) => {
  try {
    const bid = req.businessId;
    const { full_name, phone, email } = req.body;
    if (!full_name?.trim()) return res.status(400).json({ error: 'Nom requis' });
    if (full_name.trim().length > 200) return res.status(400).json({ error: 'Nom trop long (max 200)' });

    // Normalize phone to E.164 (BUG-RGPD-phone-dedup fix): stored raw meant Twilio STOP/START
    // match by `WHERE phone = $1` missed opt-outs, public booking created dupes, SMS send fails.
    let normalizedPhone = null;
    if (phone && String(phone).trim()) {
      normalizedPhone = normalizeE164(phone, 'BE');
      if (!normalizedPhone) {
        return res.status(400).json({ error: 'Format téléphone invalide (BE/FR/LU)' });
      }
    }
    const normalizedEmail = email ? String(email).trim() : null;
    if (normalizedEmail && normalizedEmail.length > 320) {
      return res.status(400).json({ error: 'Email trop long' });
    }

    // Check for existing client with same phone or email
    if (normalizedPhone || normalizedEmail) {
      const existing = await queryWithRLS(bid,
        `SELECT id, full_name FROM clients WHERE business_id = $1 AND (($2::text IS NOT NULL AND phone = $2::text) OR ($3::text IS NOT NULL AND LOWER(email) = LOWER($3::text))) LIMIT 1`,
        [bid, normalizedPhone, normalizedEmail]
      );
      if (existing.rows.length > 0) {
        return res.status(409).json({ error: `Un client avec ce ${normalizedPhone && existing.rows[0] ? 'téléphone' : 'email'} existe déjà : ${existing.rows[0].full_name}` });
      }
    }
    const result = await queryWithRLS(bid,
      `INSERT INTO clients (business_id, full_name, phone, email)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [bid, full_name.trim(), normalizedPhone, normalizedEmail]
    );
    res.status(201).json({ client: result.rows[0] });
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Un client avec ce téléphone ou email existe déjà' });
    next(err);
  }
});

// POST /api/clients/import — bulk import from CSV data
router.post('/import', requireOwner, blockIfImpersonated, async (req, res, next) => {
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

    // CSV column order matches the frontend CSV importer (src/frontend/views/clients.js:457)
    // which parses positional columns as {full_name, phone, email}. Previous export put
    // Email before Téléphone — round-trip (export → re-import) swapped the two fields.
    const header = '"Nom";"Téléphone";"Email";"Langue";"Consentement SMS";"Consentement email";"Consentement marketing";"BCE";"Notes";"Remarques";"Date anniversaire";"VIP";"Créé le";"Source";"RDV total";"No-shows";"Annulations";"Dernière visite";"CA total (€)"\n';
    const rows = result.rows.map(r => [
      esc(r.full_name),
      esc(r.phone || ''),
      esc(r.email || ''),
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
router.patch('/:id', requireOwner, blockIfImpersonated, async (req, res, next) => {
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
    // Normalize phone to E.164 on edit (same reason as POST /api/clients) — prevents
    // RGPD opt-out silent-miss, Twilio 400 errors, and public-booking dedup drift.
    if ('phone' in req.body && req.body.phone) {
      const _ph = String(req.body.phone).trim();
      if (_ph.length > 30) {
        return res.status(400).json({ error: 'Téléphone trop long' });
      }
      const _norm = normalizeE164(_ph, 'BE');
      if (!_norm) {
        return res.status(400).json({ error: 'Format téléphone invalide (BE/FR/LU)' });
      }
      req.body.phone = _norm;
    }

    if ('full_name' in req.body && req.body.full_name && String(req.body.full_name).length > 200) {
      return res.status(400).json({ error: 'Nom trop long (max 200)' });
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

    // P1-04 RGPD art.30 : capturer l'état avant UPDATE pour tracer exactement
    // quels champs ont été modifiés (email/phone/notes/consent_*/is_vip/birthday).
    // Sans ça, aucune preuve que le pro a bien eu le consentement avant d'éditer
    // les données client.
    const auditKeys = Object.keys(req.body).filter(k => k in fieldMap);
    let beforeRow = null;
    if (auditKeys.length > 0) {
      const beforeRes = await queryWithRLS(bid,
        `SELECT ${auditKeys.map(k => fieldMap[k]).join(', ')} FROM clients WHERE id = $1 AND business_id = $2`,
        [req.params.id, bid]
      );
      beforeRow = beforeRes.rows[0] || null;
    }

    sets.push('updated_at = NOW()');
    params.push(req.params.id, bid);

    const result = await queryWithRLS(bid,
      `UPDATE clients SET ${sets.join(', ')}
       WHERE id = $${idx} AND business_id = $${idx + 1}
       RETURNING *`,
      params
    );

    if (result.rows.length === 0) return res.status(404).json({ error: 'Client introuvable' });

    // P1-04 RGPD : audit log de chaque modification client.
    if (beforeRow && auditKeys.length > 0) {
      try {
        const oldData = {};
        const newData = { actor_email: req.user.email, impersonated_by: req.user.impersonatedBy || null };
        for (const k of auditKeys) {
          oldData[k] = beforeRow[fieldMap[k]];
          newData[k] = req.body[k];
        }
        await queryWithRLS(bid,
          `INSERT INTO audit_logs (business_id, actor_user_id, entity_type, entity_id, action, old_data, new_data)
           VALUES ($1, $2, 'client', $3, 'client_update', $4, $5)`,
          [bid, req.user.id, req.params.id, JSON.stringify(oldData), JSON.stringify(newData)]
        );
      } catch (e) { console.error('[AUDIT] client_update audit insert failed:', e.message); }
    }

    res.json({ client: result.rows[0] });
  } catch (err) {
    next(err);
  }
});

// ============================================================
// POST /api/clients/:id/block — block client from online booking
// ============================================================
router.post('/:id/block', requireOwner, blockIfImpersonated, async (req, res, next) => {
  try {
    const bid = req.businessId;
    const { reason } = req.body;
    const finalReason = reason || 'Bloqué manuellement';

    // P1-04: capture état avant pour audit RGPD — client a le droit de savoir
    // QUI a pris la décision de le bloquer et POURQUOI.
    const before = await queryWithRLS(bid,
      `SELECT is_blocked, blocked_reason FROM clients WHERE id = $1 AND business_id = $2`,
      [req.params.id, bid]
    );

    const result = await queryWithRLS(bid,
      `UPDATE clients SET
        is_blocked = true,
        blocked_at = NOW(),
        blocked_reason = $1,
        updated_at = NOW()
       WHERE id = $2 AND business_id = $3
       RETURNING id, full_name, is_blocked`,
      [finalReason, req.params.id, bid]
    );

    if (result.rows.length === 0) return res.status(404).json({ error: 'Client introuvable' });

    // P1-04: audit log (RGPD — client/contrôleur peut retracer la décision).
    try {
      await queryWithRLS(bid,
        `INSERT INTO audit_logs (business_id, actor_user_id, entity_type, entity_id, action, old_data, new_data)
         VALUES ($1, $2, 'client', $3, 'client_blocked', $4, $5)`,
        [bid, req.user.id, req.params.id,
         JSON.stringify({ is_blocked: before.rows[0]?.is_blocked || false, blocked_reason: before.rows[0]?.blocked_reason || null }),
         JSON.stringify({ is_blocked: true, blocked_reason: finalReason, actor_email: req.user.email, impersonated_by: req.user.impersonatedBy || null })]
      );
    } catch (e) { console.error('[AUDIT] client action audit insert failed:', e.message); }

    res.json({ blocked: true, client: result.rows[0] });
  } catch (err) { next(err); }
});

// ============================================================
// POST /api/clients/:id/unblock — unblock client
// ============================================================
router.post('/:id/unblock', requireOwner, blockIfImpersonated, async (req, res, next) => {
  try {
    const bid = req.businessId;

    const before = await queryWithRLS(bid,
      `SELECT is_blocked, blocked_reason FROM clients WHERE id = $1 AND business_id = $2`,
      [req.params.id, bid]
    );

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

    // P1-04: audit log pour traçabilité RGPD.
    try {
      await queryWithRLS(bid,
        `INSERT INTO audit_logs (business_id, actor_user_id, entity_type, entity_id, action, old_data, new_data)
         VALUES ($1, $2, 'client', $3, 'client_unblocked', $4, $5)`,
        [bid, req.user.id, req.params.id,
         JSON.stringify({ is_blocked: before.rows[0]?.is_blocked || false, blocked_reason: before.rows[0]?.blocked_reason || null }),
         JSON.stringify({ is_blocked: false, actor_email: req.user.email, impersonated_by: req.user.impersonatedBy || null })]
      );
    } catch (e) { console.error('[AUDIT] client action audit insert failed:', e.message); }

    res.json({ unblocked: true, client: result.rows[0] });
  } catch (err) { next(err); }
});

// ============================================================
// POST /api/clients/:id/reset-noshow — reset no-show counter
// ============================================================
router.post('/:id/reset-noshow', requireOwner, blockIfImpersonated, async (req, res, next) => {
  try {
    const bid = req.businessId;

    const before = await queryWithRLS(bid,
      `SELECT no_show_count, is_blocked, blocked_reason FROM clients WHERE id = $1 AND business_id = $2`,
      [req.params.id, bid]
    );

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

    // P1-04: audit log pour traçabilité RGPD (contrairement à un simple reset UI,
    // ceci modifie un comportement business — blocage automatique auto-clear).
    try {
      await queryWithRLS(bid,
        `INSERT INTO audit_logs (business_id, actor_user_id, entity_type, entity_id, action, old_data, new_data)
         VALUES ($1, $2, 'client', $3, 'client_reset_noshow', $4, $5)`,
        [bid, req.user.id, req.params.id,
         JSON.stringify({ no_show_count: before.rows[0]?.no_show_count || 0, is_blocked: before.rows[0]?.is_blocked || false }),
         JSON.stringify({ no_show_count: 0, is_blocked: false, actor_email: req.user.email, impersonated_by: req.user.impersonatedBy || null })]
      );
    } catch (e) { console.error('[AUDIT] client action audit insert failed:', e.message); }

    res.json({ reset: true, client: result.rows[0] });
  } catch (err) { next(err); }
});

// ============================================================
// POST /api/clients/:id/reset-expired — reset expired pending counter
// ============================================================
router.post('/:id/reset-expired', requireOwner, blockIfImpersonated, async (req, res, next) => {
  try {
    const bid = req.businessId;

    const before = await queryWithRLS(bid,
      `SELECT expired_pending_count FROM clients WHERE id = $1 AND business_id = $2`,
      [req.params.id, bid]
    );

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

    // P1-04: audit log pour traçabilité RGPD.
    try {
      await queryWithRLS(bid,
        `INSERT INTO audit_logs (business_id, actor_user_id, entity_type, entity_id, action, old_data, new_data)
         VALUES ($1, $2, 'client', $3, 'client_reset_expired', $4, $5)`,
        [bid, req.user.id, req.params.id,
         JSON.stringify({ expired_pending_count: before.rows[0]?.expired_pending_count || 0 }),
         JSON.stringify({ expired_pending_count: 0, actor_email: req.user.email, impersonated_by: req.user.impersonatedBy || null })]
      );
    } catch (e) { console.error('[AUDIT] client action audit insert failed:', e.message); }

    res.json({ reset: true, client: result.rows[0] });
  } catch (err) { next(err); }
});

// ============================================================
// DELETE /api/clients/:id — RGPD art.17 droit à l'oubli
// ANONYMISATION (pas suppression physique) pour conserver la comptabilité
// 7 ans (art.R123-83 code de commerce FR + obligations fiscales BE).
// Les bookings passés sont préservés avec client_id conservé mais les PII
// (nom, email, phone) sont effacées de la table clients.
// ============================================================
router.delete('/:id', requireOwner, blockIfImpersonated, async (req, res, next) => {
  try {
    const bid = req.businessId;

    // Capture before state pour audit (preuve que la demande a été exécutée).
    const before = await queryWithRLS(bid,
      `SELECT id, full_name, email, phone, is_blocked FROM clients WHERE id = $1 AND business_id = $2`,
      [req.params.id, bid]
    );
    if (before.rows.length === 0) return res.status(404).json({ error: 'Client introuvable' });
    if (before.rows[0].full_name === '[supprimé]') {
      return res.status(409).json({ error: 'Client déjà anonymisé' });
    }

    const origEmail = (before.rows[0].email || '').toLowerCase().trim();
    const origPhone = before.rows[0].phone || '';

    // Anonymisation complète : full_name marker, PII null, consent_* false, blocked_reason clear.
    const result = await queryWithRLS(bid,
      `UPDATE clients SET
        full_name = '[supprimé]',
        email = NULL,
        phone = NULL,
        bce_number = NULL,
        notes = NULL,
        remarks = NULL,
        birthday = NULL,
        blocked_reason = NULL,
        consent_sms = false,
        consent_email = false,
        consent_marketing = false,
        oauth_provider = NULL,
        oauth_provider_id = NULL,
        language_preference = NULL,
        updated_at = NOW()
       WHERE id = $1 AND business_id = $2
       RETURNING id`,
      [req.params.id, bid]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Client introuvable' });

    // Cascade anonymisation sur tables sans client_id direct mais avec PII dénormalisées.
    // On match par email (case-insensitive) et phone — cible uniquement ce client.
    // Exception : invoices conserve les données (obligation légale 7 ans compta BE/FR
    // art.R123-83 + CIR BE). Les autres (waitlist, quote_requests, passes, gift_cards,
    // notifications) sont purgées des PII sans intérêt fiscal.
    // Chaque cascade est dans son PROPRE try/catch pour fail-safe : si une
    // UPDATE échoue (NOT NULL constraint, table absente en test, etc.), les
    // autres continuent quand même.
    // Utilisation de '' au lieu de NULL pour les colonnes NOT NULL (client_email,
    // description) — vaut marker de PII effacée sans violer la contrainte DB.
    if (origEmail) {
      try {
        await queryWithRLS(bid,
          `UPDATE waitlist_entries SET client_name = '[supprimé]', client_email = '', client_phone = NULL, note = NULL, staff_notes = NULL, updated_at = NOW()
           WHERE business_id = $1 AND LOWER(client_email) = $2`,
          [bid, origEmail]
        );
      } catch (e) { console.error('[RGPD] waitlist_entries cascade:', e.message); }
      try {
        await queryWithRLS(bid,
          `UPDATE quote_requests SET client_name = '[supprimé]', client_email = '', client_phone = NULL, description = ''
           WHERE business_id = $1 AND LOWER(client_email) = $2`,
          [bid, origEmail]
        );
      } catch (e) { console.error('[RGPD] quote_requests cascade:', e.message); }
      try {
        await queryWithRLS(bid,
          `UPDATE passes SET buyer_name = '[supprimé]', buyer_email = NULL
           WHERE business_id = $1 AND LOWER(buyer_email) = $2`,
          [bid, origEmail]
        );
      } catch (e) { console.error('[RGPD] passes cascade:', e.message); }
      try {
        await queryWithRLS(bid,
          `UPDATE gift_cards SET buyer_name = '[supprimé]', buyer_email = NULL, message = NULL
           WHERE business_id = $1 AND LOWER(buyer_email) = $2`,
          [bid, origEmail]
        );
      } catch (e) { console.error('[RGPD] gift_cards buyer cascade:', e.message); }
      try {
        await queryWithRLS(bid,
          `UPDATE gift_cards SET recipient_name = '[supprimé]', recipient_email = NULL
           WHERE business_id = $1 AND LOWER(recipient_email) = $2`,
          [bid, origEmail]
        );
      } catch (e) { console.error('[RGPD] gift_cards recipient cascade:', e.message); }
      try {
        await queryWithRLS(bid,
          `UPDATE notifications SET recipient_email = NULL, recipient_phone = NULL
           WHERE business_id = $1 AND LOWER(recipient_email) = $2`,
          [bid, origEmail]
        );
      } catch (e) { console.error('[RGPD] notifications email cascade:', e.message); }
    }
    if (origPhone) {
      try {
        await queryWithRLS(bid,
          `UPDATE notifications SET recipient_phone = NULL
           WHERE business_id = $1 AND recipient_phone = $2`,
          [bid, origPhone]
        );
      } catch (e) { console.error('[RGPD] notifications phone cascade:', e.message); }
      // v4 : call_logs (numéro appelant) + call_voicemails (numéro + transcription audio)
      try {
        await queryWithRLS(bid,
          `UPDATE call_logs SET from_phone = NULL
           WHERE business_id = $1 AND from_phone = $2`,
          [bid, origPhone]
        );
      } catch (e) { console.error('[RGPD] call_logs cascade:', e.message); }
      try {
        await queryWithRLS(bid,
          `UPDATE call_voicemails SET from_phone = NULL, transcription = NULL
           WHERE business_id = $1 AND from_phone = $2`,
          [bid, origPhone]
        );
      } catch (e) { console.error('[RGPD] call_voicemails cascade:', e.message); }
    }

    // Audit log — preuve vitale RGPD art.5(2) accountability.
    // old_data N'inclut PAS les PII en clair (leak dans audit_logs sinon) — juste
    // des markers `[present]` pour prouver que les champs étaient bien remplis.
    try {
      await queryWithRLS(bid,
        `INSERT INTO audit_logs (business_id, actor_user_id, entity_type, entity_id, action, old_data, new_data)
         VALUES ($1, $2, 'client', $3, 'client_anonymized_rgpd', $4, $5)`,
        [bid, req.user.id, req.params.id,
         JSON.stringify({
           full_name: before.rows[0].full_name ? '[present]' : null,
           email: before.rows[0].email ? '[present]' : null,
           phone: before.rows[0].phone ? '[present]' : null,
           is_blocked: before.rows[0].is_blocked || false
         }),
         JSON.stringify({
           full_name: '[supprimé]',
           actor_email: req.user.email,
           impersonated_by: req.user.impersonatedBy || null,
           reason: 'rgpd_art17_right_to_erasure'
         })]
      );
    } catch (e) { console.error('[AUDIT] client_anonymized_rgpd audit insert failed:', e.message); }

    res.json({ anonymized: true, id: req.params.id });
  } catch (err) { next(err); }
});

module.exports = router;
