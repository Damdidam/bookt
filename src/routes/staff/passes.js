const router = require('express').Router();
const crypto = require('crypto');
const { queryWithRLS, transactionWithRLS } = require('../../services/db');
const { requireAuth, requireOwner, requirePro, blockIfImpersonated } = require('../../middleware/auth');

router.use(requireAuth);
router.use(requireOwner);
router.use(requirePro);

/** Read passes_enabled from business settings. Defaults to false if unset. */
async function isPassesFeatureEnabled(bid) {
  const r = await queryWithRLS(bid, `SELECT settings FROM businesses WHERE id = $1`, [bid]);
  return !!r.rows[0]?.settings?.passes_enabled;
}

/** Generate unique pass code: PS-XXXX-XXXX */
function generateCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no I/O/0/1
  let code = 'PS-';
  for (let i = 0; i < 4; i++) code += chars[crypto.randomInt(chars.length)];
  code += '-';
  for (let i = 0; i < 4; i++) code += chars[crypto.randomInt(chars.length)];
  return code;
}

// ============================================================
// GET /api/passes/templates — list pass templates
// ============================================================
router.get('/templates', async (req, res, next) => {
  try {
    const bid = req.businessId;
    const { service_id } = req.query;

    let sql = `
      SELECT pt.*, s.name AS service_name
      FROM pass_templates pt
      LEFT JOIN services s ON s.id = pt.service_id
      WHERE pt.business_id = $1 AND pt.is_active = true`;
    const params = [bid];
    let idx = 2;

    if (service_id) {
      sql += ` AND pt.service_id = $${idx}`;
      params.push(service_id);
      idx++;
    }

    sql += ` ORDER BY pt.sort_order ASC, pt.created_at ASC`;
    const result = await queryWithRLS(bid, sql, params);

    res.json({ templates: result.rows });
  } catch (err) { next(err); }
});

// ============================================================
// POST /api/passes/templates — create a pass template
// ============================================================
router.post('/templates', blockIfImpersonated, async (req, res, next) => {
  try {
    const bid = req.businessId;
    if (!(await isPassesFeatureEnabled(bid))) {
      return res.status(403).json({ error: 'Les abonnements sont désactivés. Activez-les dans Paramètres > Abonnements.' });
    }
    const { service_id, service_variant_id, name, description, sessions_count, price_cents, validity_days } = req.body;

    if (!name || !sessions_count || !price_cents) {
      return res.status(400).json({ error: 'Champs requis: name, sessions_count, price_cents' });
    }

    // Validate service belongs to this business
    if (service_id) {
      const svc = await queryWithRLS(bid, 'SELECT 1 FROM services WHERE id = $1 AND business_id = $2', [service_id, bid]);
      if (svc.rows.length === 0) return res.status(400).json({ error: 'Service introuvable' });
    }

    const result = await queryWithRLS(bid,
      `INSERT INTO pass_templates (business_id, service_id, service_variant_id, name, description, sessions_count, price_cents, validity_days)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
      [bid, service_id || null, service_variant_id || null, name, description || null, sessions_count, price_cents, validity_days || null]
    );

    res.status(201).json(result.rows[0]);
  } catch (err) { next(err); }
});

// ============================================================
// PATCH /api/passes/templates/:id — update a pass template
// ============================================================
router.patch('/templates/:id', blockIfImpersonated, async (req, res, next) => {
  try {
    const bid = req.businessId;
    const { id } = req.params;
    const { name, description, service_variant_id, sessions_count, price_cents, validity_days, is_active } = req.body;

    const fields = [];
    const values = [];
    let idx = 1;

    if (name !== undefined) { fields.push(`name = $${idx}`); values.push(name); idx++; }
    if (description !== undefined) { fields.push(`description = $${idx}`); values.push(description || null); idx++; }
    if (service_variant_id !== undefined) { fields.push(`service_variant_id = $${idx}`); values.push(service_variant_id || null); idx++; }
    if (sessions_count !== undefined) { fields.push(`sessions_count = $${idx}`); values.push(sessions_count); idx++; }
    if (price_cents !== undefined) { fields.push(`price_cents = $${idx}`); values.push(price_cents); idx++; }
    if (validity_days !== undefined) { fields.push(`validity_days = $${idx}`); values.push(validity_days); idx++; }
    if (is_active !== undefined) { fields.push(`is_active = $${idx}`); values.push(is_active); idx++; }

    if (fields.length === 0) return res.status(400).json({ error: 'Aucun champ à mettre à jour' });

    fields.push(`updated_at = NOW()`);
    values.push(id, bid);

    const result = await queryWithRLS(bid,
      `UPDATE pass_templates SET ${fields.join(', ')}
       WHERE id = $${idx} AND business_id = $${idx + 1} RETURNING *`,
      values
    );

    if (result.rows.length === 0) return res.status(404).json({ error: 'Modèle introuvable' });
    res.json(result.rows[0]);
  } catch (err) { next(err); }
});

// ============================================================
// DELETE /api/passes/templates/:id — soft delete (is_active = false)
// ============================================================
router.delete('/templates/:id', blockIfImpersonated, async (req, res, next) => {
  try {
    const bid = req.businessId;
    const { id } = req.params;

    const result = await queryWithRLS(bid,
      `UPDATE pass_templates SET is_active = false, updated_at = NOW()
       WHERE id = $1 AND business_id = $2 RETURNING *`,
      [id, bid]
    );

    if (result.rows.length === 0) return res.status(404).json({ error: 'Modèle introuvable' });
    res.json(result.rows[0]);
  } catch (err) { next(err); }
});

// ============================================================
// POST /api/passes/templates/sync — bulk upsert templates for a service
// ============================================================
router.post('/templates/sync', blockIfImpersonated, async (req, res, next) => {
  try {
    const bid = req.businessId;
    const { service_id, templates } = req.body;

    if (!service_id) return res.status(400).json({ error: 'service_id requis' });
    if (!Array.isArray(templates)) return res.status(400).json({ error: 'templates doit être un tableau' });

    // Validate service belongs to this business
    const svc = await queryWithRLS(bid, 'SELECT 1 FROM services WHERE id = $1 AND business_id = $2', [service_id, bid]);
    if (svc.rows.length === 0) return res.status(400).json({ error: 'Service introuvable' });

    // Feature gate: if passes are disabled, skip INSERT of NEW templates but still
    // allow UPDATE/deactivation of existing ones (legacy management).
    const featureEnabled = await isPassesFeatureEnabled(bid);
    const upsertedIds = [];
    let skippedNew = 0;

    for (const tpl of templates) {
      const { id, name, description, service_variant_id, sessions_count, price_cents, validity_days } = tpl;

      if (id) {
        const r = await queryWithRLS(bid,
          `UPDATE pass_templates
           SET name = $1, description = $2, service_variant_id = $3, sessions_count = $4, price_cents = $5, validity_days = $6,
               is_active = true, updated_at = NOW()
           WHERE id = $7 AND business_id = $8 AND service_id = $9
           RETURNING id`,
          [name, description || null, service_variant_id || null, sessions_count, price_cents, validity_days || null, id, bid, service_id]
        );
        if (r.rows.length > 0) upsertedIds.push(r.rows[0].id);
      } else if (featureEnabled) {
        const r = await queryWithRLS(bid,
          `INSERT INTO pass_templates (business_id, service_id, service_variant_id, name, description, sessions_count, price_cents, validity_days)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
          [bid, service_id, service_variant_id || null, name, description || null, sessions_count, price_cents, validity_days || null]
        );
        upsertedIds.push(r.rows[0].id);
      } else {
        skippedNew++;
      }
    }

    // Deactivate templates for this service not in the list.
    // Important: distinguish "explicit empty list" (deactivate all) from
    // "list had items but all were skipped due to feature-off" (do nothing —
    // do NOT wipe existing templates silently).
    if (upsertedIds.length > 0) {
      await queryWithRLS(bid,
        `UPDATE pass_templates SET is_active = false, updated_at = NOW()
         WHERE business_id = $1 AND service_id = $2 AND id != ALL($3::uuid[])`,
        [bid, service_id, upsertedIds]
      );
    } else if (templates.length === 0) {
      // Explicit empty list from caller — deactivate all for this service
      await queryWithRLS(bid,
        `UPDATE pass_templates SET is_active = false, updated_at = NOW()
         WHERE business_id = $1 AND service_id = $2`,
        [bid, service_id]
      );
    }
    // else: templates were sent but all skipped (feature off + only new items)
    //       → leave existing templates untouched

    // Return updated list
    const result = await queryWithRLS(bid,
      `SELECT pt.*, s.name AS service_name
       FROM pass_templates pt
       LEFT JOIN services s ON s.id = pt.service_id
       WHERE pt.business_id = $1 AND pt.service_id = $2
       ORDER BY pt.sort_order ASC, pt.created_at ASC`,
      [bid, service_id]
    );

    res.json({ templates: result.rows, feature_disabled_skipped: skippedNew > 0 ? skippedNew : undefined });
  } catch (err) { next(err); }
});

// ============================================================
// GET /api/passes — list passes + stats
// ============================================================
router.get('/', async (req, res, next) => {
  try {
    const bid = req.businessId;
    const { status, search } = req.query;

    let sql = `
      SELECT p.*,
             s.name AS service_name,
             (SELECT json_agg(json_build_object(
               'id', t.id, 'sessions', t.sessions, 'type', t.type,
               'note', t.note, 'booking_id', t.booking_id, 'created_at', t.created_at
             ) ORDER BY t.created_at DESC)
             FROM pass_transactions t WHERE t.pass_id = p.id) AS transactions
      FROM passes p
      LEFT JOIN services s ON s.id = p.service_id
      WHERE p.business_id = $1`;
    const params = [bid];
    let idx = 2;

    if (status && status !== 'all') {
      sql += ` AND p.status = $${idx}`;
      params.push(status);
      idx++;
    }
    if (search) {
      sql += ` AND (p.code ILIKE $${idx} OR p.buyer_name ILIKE $${idx} OR p.buyer_email ILIKE $${idx})`;
      params.push(`%${search}%`);
      idx++;
    }

    sql += ` ORDER BY p.created_at DESC LIMIT 200`;
    const result = await queryWithRLS(bid, sql, params);

    // Stats
    const stats = await queryWithRLS(bid, `
      SELECT
        COUNT(*) AS total_count,
        COUNT(*) FILTER (WHERE status = 'active') AS active_count,
        COUNT(*) FILTER (WHERE status = 'used') AS used_count,
        COUNT(*) FILTER (WHERE status = 'expired') AS expired_count,
        COALESCE(SUM(sessions_total), 0) AS total_sessions_sold,
        COALESCE(SUM(sessions_remaining) FILTER (WHERE status = 'active'), 0) AS total_sessions_remaining
      FROM passes WHERE business_id = $1
    `, [bid]);

    const feature_enabled = await isPassesFeatureEnabled(bid);
    res.json({ passes: result.rows, stats: stats.rows[0], feature_enabled });
  } catch (err) { next(err); }
});

// ============================================================
// POST /api/passes — create pass manually (staff)
// ============================================================
router.post('/', async (req, res, next) => {
  try {
    const bid = req.businessId;
    if (!(await isPassesFeatureEnabled(bid))) {
      return res.status(403).json({ error: 'Les abonnements sont désactivés. Activez-les dans Paramètres > Abonnements.' });
    }
    const {
      pass_template_id,
      service_id, name, sessions_total, price_cents, validity_days,
      buyer_name, buyer_email, expires_at: body_expires_at
    } = req.body;

    let resolvedServiceId, resolvedName, resolvedSessionsTotal, resolvedPriceCents, resolvedValidityDays;

    if (pass_template_id) {
      // Load from template
      const tplResult = await queryWithRLS(bid,
        'SELECT * FROM pass_templates WHERE id = $1 AND business_id = $2 AND is_active = true',
        [pass_template_id, bid]
      );
      if (tplResult.rows.length === 0) return res.status(400).json({ error: 'Modèle introuvable ou inactif' });
      const tpl = tplResult.rows[0];
      resolvedServiceId = tpl.service_id;
      resolvedName = tpl.name;
      resolvedSessionsTotal = tpl.sessions_count;
      resolvedPriceCents = tpl.price_cents;
      resolvedValidityDays = tpl.validity_days;
    } else {
      // Manual fields
      if (!name || !sessions_total || !price_cents) {
        return res.status(400).json({ error: 'Champs requis: name, sessions_total, price_cents (ou pass_template_id)' });
      }
      if (service_id) {
        const svc = await queryWithRLS(bid, 'SELECT 1 FROM services WHERE id = $1 AND business_id = $2', [service_id, bid]);
        if (svc.rows.length === 0) return res.status(400).json({ error: 'Service introuvable' });
      }
      resolvedServiceId = service_id || null;
      resolvedName = name;
      resolvedSessionsTotal = sessions_total;
      resolvedPriceCents = price_cents;
      resolvedValidityDays = validity_days || null;
    }

    // Generate unique code (retry on collision)
    let code, codeIsUnique = false;
    for (let i = 0; i < 10; i++) {
      code = generateCode();
      const exists = await queryWithRLS(bid, 'SELECT 1 FROM passes WHERE code = $1', [code]);
      if (exists.rows.length === 0) { codeIsUnique = true; break; }
    }
    if (!codeIsUnique) return res.status(500).json({ error: 'Impossible de générer un code unique. Veuillez réessayer.' });

    const expires_at = body_expires_at
      ? new Date(body_expires_at)
      : resolvedValidityDays
        ? new Date(Date.now() + resolvedValidityDays * 86400000)
        : null;

    const result = await transactionWithRLS(bid, async (client) => {
      const pass = await client.query(
        `INSERT INTO passes (business_id, pass_template_id, service_id, code, name,
          sessions_total, sessions_remaining, price_cents, buyer_name, buyer_email,
          expires_at, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $6, $7, $8, $9, $10, $11) RETURNING *`,
        [bid, pass_template_id || null, resolvedServiceId, code, resolvedName,
         resolvedSessionsTotal, resolvedPriceCents,
         buyer_name || null, buyer_email || null,
         expires_at, req.user.id]
      );

      await client.query(
        `INSERT INTO pass_transactions (pass_id, business_id, sessions, type, note, created_by)
         VALUES ($1, $2, $3, 'purchase', 'Création manuelle', $4)`,
        [pass.rows[0].id, bid, resolvedSessionsTotal, req.user.id]
      );

      return pass.rows[0];
    });

    // Send email to buyer if provided
    if (buyer_email) {
      try {
        const bizResult = await queryWithRLS(bid, 'SELECT name, slug, theme, email FROM businesses WHERE id = $1', [bid]);
        // Fetch service name for the email
        let serviceName = '';
        if (result.service_id) {
          const svcR = await queryWithRLS(bid, 'SELECT name FROM services WHERE id = $1', [result.service_id]);
          if (svcR.rows.length) serviceName = svcR.rows[0].name;
        }
        const { sendPassPurchaseEmail } = require('../../services/email');
        await sendPassPurchaseEmail({ pass: { ...result, service_name: serviceName }, business: bizResult.rows[0] });
      } catch (emailErr) {
        console.error('[PASS] Email failed:', emailErr.message);
      }
    }

    res.status(201).json(result);
  } catch (err) { next(err); }
});

// ============================================================
// PATCH /api/passes/:id — cancel pass (active → cancelled only)
// ============================================================
router.patch('/:id', blockIfImpersonated, async (req, res, next) => {
  try {
    const bid = req.businessId;
    const { id } = req.params;
    const { status } = req.body;

    if (status !== 'cancelled') {
      return res.status(400).json({ error: 'Seule l\'annulation est autorisée via cette route' });
    }

    // H-10 fix: protéger contre perte d'argent client (parité avec M3 gift-cards.js:157).
    // Si pass acheté via Stripe avec sessions_remaining > 0, forcer usage de POST /:id/refund-full
    // qui fait le remboursement Stripe pro-rata proprement.
    const passRes = await queryWithRLS(bid,
      `SELECT sessions_remaining, stripe_payment_intent_id, price_cents, status FROM passes WHERE id = $1 AND business_id = $2`,
      [id, bid]
    );
    if (passRes.rows.length === 0) return res.status(404).json({ error: 'Pass introuvable' });
    const pass = passRes.rows[0];
    if (pass.status !== 'active') return res.status(404).json({ error: 'Pass introuvable ou déjà non-actif' });
    if ((pass.sessions_remaining || 0) > 0 && pass.stripe_payment_intent_id && (pass.price_cents || 0) > 0) {
      return res.status(400).json({
        error: 'Ce pass a des séances non utilisées et a été payé par carte bancaire. Utilisez plutôt "Rembourser intégralement" pour restituer le montant pro-rata au client.',
        code: 'use_refund_full_endpoint'
      });
    }

    const result = await queryWithRLS(bid,
      `UPDATE passes SET status = 'cancelled', updated_at = NOW()
       WHERE id = $1 AND business_id = $2 AND status = 'active' RETURNING *`,
      [id, bid]
    );

    if (result.rows.length === 0) return res.status(404).json({ error: 'Pass introuvable ou déjà non-actif' });

    // Audit log
    try {
      await queryWithRLS(bid,
        `INSERT INTO audit_logs (business_id, actor_user_id, entity_type, entity_id, action, new_data)
         VALUES ($1, $2, 'pass', $3, 'pass_cancelled', $4)`,
        [bid, req.user?.id || null, id,
         JSON.stringify({ status: 'cancelled', sessions_remaining: pass.sessions_remaining, had_stripe_pi: !!pass.stripe_payment_intent_id })]
      );
    } catch (_) { /* non-critical */ }

    res.json(result.rows[0]);
  } catch (err) { next(err); }
});

// ============================================================
// POST /api/passes/:id/debit — debit 1 session
// ============================================================
router.post('/:id/debit', blockIfImpersonated, async (req, res, next) => {
  try {
    const bid = req.businessId;
    const { id } = req.params;
    const { booking_id, note } = req.body;

    const result = await transactionWithRLS(bid, async (client) => {
      const p = await client.query(
        'SELECT * FROM passes WHERE id = $1 AND business_id = $2 FOR UPDATE',
        [id, bid]
      );
      if (p.rows.length === 0) throw Object.assign(new Error('Pass introuvable'), { status: 404 });
      const pass = p.rows[0];

      if (pass.status !== 'active') throw Object.assign(new Error('Ce pass n\'est plus actif'), { status: 400 });
      if (pass.sessions_remaining <= 0) throw Object.assign(new Error('Aucune séance restante'), { status: 400 });

      const newRemaining = pass.sessions_remaining - 1;
      const newStatus = newRemaining === 0 ? 'used' : 'active';

      await client.query(
        `UPDATE passes SET sessions_remaining = $1, status = $2, updated_at = NOW()
         WHERE id = $3`,
        [newRemaining, newStatus, id]
      );

      await client.query(
        `INSERT INTO pass_transactions (pass_id, business_id, booking_id, sessions, type, note, created_by)
         VALUES ($1, $2, $3, -1, 'debit', $4, $5)`,
        [id, bid, booking_id || null, note || null, req.user.id]
      );

      return { ...pass, sessions_remaining: newRemaining, status: newStatus };
    });

    res.json(result);
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    next(err);
  }
});

// ============================================================
// POST /api/passes/:id/refund — refund 1 session
// ============================================================
router.post('/:id/refund', blockIfImpersonated, async (req, res, next) => {
  try {
    const bid = req.businessId;
    const { id } = req.params;
    const { booking_id, note } = req.body;

    const result = await transactionWithRLS(bid, async (client) => {
      const p = await client.query(
        'SELECT * FROM passes WHERE id = $1 AND business_id = $2 FOR UPDATE',
        [id, bid]
      );
      if (p.rows.length === 0) throw Object.assign(new Error('Pass introuvable'), { status: 404 });
      const pass = p.rows[0];

      if (pass.sessions_remaining >= pass.sessions_total) {
        throw Object.assign(new Error('Impossible de rembourser: toutes les séances sont déjà disponibles'), { status: 400 });
      }

      const newRemaining = pass.sessions_remaining + 1;
      const newStatus = pass.status === 'used' ? 'active' : pass.status;

      await client.query(
        `UPDATE passes SET sessions_remaining = $1, status = $2, updated_at = NOW()
         WHERE id = $3`,
        [newRemaining, newStatus, id]
      );

      await client.query(
        `INSERT INTO pass_transactions (pass_id, business_id, booking_id, sessions, type, note, created_by)
         VALUES ($1, $2, $3, 1, 'refund', $4, $5)`,
        [id, bid, booking_id || null, note || 'Remboursement séance', req.user.id]
      );

      return { ...pass, sessions_remaining: newRemaining, status: newStatus };
    });

    res.json(result);
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    next(err);
  }
});

// ============================================================
// POST /api/passes/:id/refund-full — full pass refund (cancel + Stripe money-back)
// B2 fix : flow complet pour rembourser un pass entier (vs /refund qui crédite 1 session).
// Marque le pass cancelled, sessions_remaining=0, refund Stripe selon refund_policy.
// ============================================================
router.post('/:id/refund-full', blockIfImpersonated, async (req, res, next) => {
  try {
    const bid = req.businessId;
    const { id } = req.params;
    // M3 fix (security): cap reason length
    const rawReason = req.body?.reason;
    const reason = (typeof rawReason === 'string' && rawReason.trim()) ? rawReason.trim().slice(0, 500) : null;

    // Read business settings outside the tx (refund_policy + name/theme/address for email)
    const bizRes = await queryWithRLS(bid, `SELECT name, settings, theme, email, phone, address FROM businesses WHERE id = $1`, [bid]);
    const bizRow = bizRes.rows[0] || {};
    const refundPolicy = bizRow.settings?.refund_policy || 'full';

    const result = await transactionWithRLS(bid, async (client) => {
      const p = await client.query(
        `SELECT id, code, name, status, sessions_total, sessions_remaining, price_cents,
                stripe_payment_intent_id, buyer_email, buyer_name, expires_at, service_id
           FROM passes WHERE id = $1 AND business_id = $2 FOR UPDATE`,
        [id, bid]
      );
      if (p.rows.length === 0) throw Object.assign(new Error('Pass introuvable'), { status: 404 });
      const pass = p.rows[0];

      if (pass.status === 'cancelled' || pass.status === 'refunded') {
        throw Object.assign(new Error('Pass déjà annulé ou remboursé'), { status: 409 });
      }
      if (pass.status === 'expired') {
        throw Object.assign(new Error('Pass expiré — remboursement non autorisé'), { status: 409 });
      }
      // Batch 12 regression fix: guard against corrupted sessions_total=0 (division by zero downstream)
      if (!pass.sessions_total || pass.sessions_total <= 0) {
        throw Object.assign(new Error('Pass invalide : sessions_total manquant ou nul'), { status: 400 });
      }

      // Stripe refund (only if there was a Stripe payment)
      let netRefundCents = null;
      let stripeFeesCents = 0;
      let refundError = null;
      if (pass.stripe_payment_intent_id && pass.price_cents > 0) {
        const stripeKey = process.env.STRIPE_SECRET_KEY;
        if (!stripeKey) {
          throw Object.assign(new Error('STRIPE_SECRET_KEY manquant — remboursement impossible'), { status: 500 });
        }
        const stripe = require('stripe')(stripeKey);
        try {
          let piId = pass.stripe_payment_intent_id;
          if (piId.startsWith('cs_')) {
            const sess = await stripe.checkout.sessions.retrieve(piId);
            piId = sess.payment_intent;
          }
          if (!piId || !piId.startsWith('pi_')) {
            throw new Error('Identifiant Stripe invalide');
          }

          // Pro-rata refund: only refund the unused portion (avoid refunding sessions already used)
          const usedSessions = pass.sessions_total - pass.sessions_remaining;
          // Batch 13 regression fix : si aucune séance utilisée → refund entier sans arrondi
          // (évite le drift 1-cent dû à round(price/total) × total ≠ price).
          const unusedRefundCents = (usedSessions === 0)
            ? pass.price_cents
            : pass.sessions_remaining * Math.round(pass.price_cents / pass.sessions_total);

          if (refundPolicy === 'net') {
            stripeFeesCents = unusedRefundCents > 0 ? Math.round(unusedRefundCents * 0.015) + 25 : 0;
            netRefundCents = Math.max(unusedRefundCents - stripeFeesCents, 0);
          } else {
            netRefundCents = unusedRefundCents;
          }

          // B-05 fix: D-12 pattern parity — Stripe min = 50c. net<50 → no refund + reset = 0
          // (avant: > 0 → Stripe rejette "Amount too small" → throw 502, pass pas cancelled)
          if (netRefundCents >= 50) {
            await stripe.refunds.create({ payment_intent: piId, amount: netRefundCents });
            console.log(`[PASS REFUND-FULL] Stripe refund ${netRefundCents}c (gross ${unusedRefundCents}c, fees ${stripeFeesCents}c, used ${usedSessions}/${pass.sessions_total}) for PI ${piId}`);
          } else {
            console.warn(`[PASS REFUND-FULL] netRefund=${netRefundCents}c <50c Stripe min (fees ${stripeFeesCents}c, refundable ${unusedRefundCents}c) — pass cancelled, no Stripe refund`);
            netRefundCents = 0;
          }
        } catch (stripeErr) {
          if (stripeErr.code === 'charge_already_refunded') {
            console.warn(`[PASS REFUND-FULL] Stripe says already refunded for pass ${id} — proceeding with status update`);
          } else {
            // RULE #4: Stripe must succeed before we mark the pass refunded — keep status, return error
            console.error('[PASS REFUND-FULL] Stripe refund failed:', stripeErr.message);
            throw Object.assign(new Error(`Remboursement Stripe échoué : ${stripeErr.message}`), { status: 502 });
          }
        }
      }

      // Mark cancelled + zero sessions
      await client.query(
        `UPDATE passes SET status = 'cancelled', sessions_remaining = 0, updated_at = NOW() WHERE id = $1`,
        [id]
      );

      // Audit trail: log a refund transaction for the remaining sessions (if any)
      if (pass.sessions_remaining > 0) {
        await client.query(
          `INSERT INTO pass_transactions (pass_id, business_id, sessions, type, note, created_by)
           VALUES ($1, $2, $3, 'refund', $4, $5)`,
          [id, bid, pass.sessions_remaining, reason || `Remboursement complet du pass${netRefundCents != null ? ' (' + (netRefundCents/100).toFixed(2).replace('.',',') + ' € net Stripe)' : ''}`, req.user.id]
        );
      }

      // H5 fix: audit_logs entry pour compliance BE — trace qui a émis le refund (impersonation inclus)
      await client.query(
        `INSERT INTO audit_logs (business_id, actor_user_id, entity_type, entity_id, action, old_data, new_data)
         VALUES ($1, $2, 'pass', $3, 'pass_refund_full', $4, $5)`,
        [bid, req.user.id, id,
         JSON.stringify({ code: pass.code, status: pass.status, sessions_remaining: pass.sessions_remaining, sessions_total: pass.sessions_total, price_cents: pass.price_cents }),
         JSON.stringify({ status: 'cancelled', sessions_refunded: pass.sessions_remaining, stripe_refund_cents: netRefundCents, stripe_fees_cents: stripeFeesCents, reason: reason || null, impersonated_by: req.user.impersonatedBy || null })]
      );

      return {
        code: pass.code,
        name: pass.name,
        sessions_refunded: pass.sessions_remaining,
        stripe_refund_cents: netRefundCents,
        stripe_fees_cents: stripeFeesCents,
        buyer_email: pass.buyer_email,
        buyer_name: pass.buyer_name,
        expires_at: pass.expires_at
      };
    });

    // H8 fix: send confirmation email to buyer AFTER commit (non-blocking)
    // Client doit recevoir une trace écrite du refund, pas juste un virement Stripe "anonyme".
    if (result.buyer_email) {
      (async () => {
        try {
          const { sendEmail, buildEmailHTML, escHtml, safeColor } = require('../../services/email-utils');
          const color = safeColor(bizRow.theme?.primary_color);
          const safeBiz = escHtml(bizRow.name || 'Votre cabinet');
          const safeBuyer = escHtml(result.buyer_name || '');
          const safePassName = escHtml(result.name);
          const netStr = (result.stripe_refund_cents != null && result.stripe_refund_cents > 0)
            ? (result.stripe_refund_cents / 100).toFixed(2).replace('.', ',') + '\u00a0\u20ac'
            : null;
          const feesStr = (result.stripe_fees_cents > 0)
            ? (result.stripe_fees_cents / 100).toFixed(2).replace('.', ',') + '\u00a0\u20ac'
            : null;
          const bodyHTML = `
            <p>Bonjour${safeBuyer ? ' ' + safeBuyer : ''},</p>
            <p>Votre pass <strong>${safePassName}</strong> a été annulé${netStr ? ' et remboursé' : ''}.</p>
            ${netStr ? `
            <div style="background:#F0FDF4;border-radius:8px;padding:14px 16px;margin:16px 0;border-left:3px solid #22C55E">
              <div style="font-size:15px;font-weight:600;color:#15803D;margin-bottom:4px">Remboursement : ${netStr}</div>
              ${feesStr ? `<div style="font-size:12px;color:#15803D;opacity:.85">Frais bancaires déduits : ${feesStr}</div>` : ''}
              <div style="font-size:13px;color:#15803D;margin-top:4px">Le remboursement apparaîtra sur votre relevé sous 5 à 10 jours ouvrables. Les séances déjà utilisées ne sont pas remboursées.</div>
            </div>` : `
            <div style="background:#F5F4F1;border-radius:8px;padding:14px 16px;margin:16px 0">
              <div style="font-size:14px;color:#3D3832">Pass annulé. ${result.sessions_refunded} séance(s) restituée(s).</div>
            </div>`}
            ${reason ? `<p style="font-size:13px;color:#6B6560">Motif : ${escHtml(reason)}</p>` : ''}
            <p style="font-size:13px;color:#6B6560">Pour toute question, contactez-nous${bizRow.phone ? ' au ' + escHtml(bizRow.phone) : ''}${bizRow.email ? ' (' + escHtml(bizRow.email) + ')' : ''}.</p>`;
          const html = buildEmailHTML({
            title: 'Pass annulé',
            preheader: netStr ? `Votre pass ${result.name} a été remboursé (${netStr})` : `Votre pass ${result.name} a été annulé`,
            bodyHTML,
            businessName: bizRow.name,
            primaryColor: color,
            footerText: `${bizRow.name || 'Genda'}${bizRow.address ? ' \u00b7 ' + bizRow.address : ''} \u00b7 Via Genda.be`
          });
          await sendEmail({
            to: result.buyer_email,
            toName: result.buyer_name || undefined,
            subject: netStr ? `Pass remboursé \u2014 ${bizRow.name || 'Genda'}` : `Pass annulé \u2014 ${bizRow.name || 'Genda'}`,
            html,
            fromName: bizRow.name || 'Genda',
            replyTo: bizRow.email || undefined
          });
        } catch (e) {
          console.warn('[PASS REFUND-FULL] Email error:', e.message);
        }
      })();
    }

    res.json({ ok: true, ...result });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    next(err);
  }
});

// ============================================================
// DELETE /api/passes/:id — soft delete (status='cancelled') if used; hard if untouched.
// Hard delete previously cascaded pass_transactions → broken audit trail on linked invoices.
// ============================================================
router.delete('/:id', blockIfImpersonated, async (req, res, next) => {
  try {
    const bid = req.businessId;
    const { id } = req.params;
    const force = req.query.force === '1';

    const result = await transactionWithRLS(bid, async (client) => {
      // Lock the pass row + count any usage history
      const pRes = await client.query(
        `SELECT p.id, p.code, p.status,
                (SELECT COUNT(*)::int FROM pass_transactions WHERE pass_id = p.id AND type IN ('debit', 'refund')) AS tx_count
         FROM passes p WHERE p.id = $1 AND p.business_id = $2 FOR UPDATE`,
        [id, bid]
      );
      if (pRes.rows.length === 0) throw Object.assign(new Error('Pass introuvable'), { status: 404 });
      const p = pRes.rows[0];

      if (p.tx_count > 0 && !force) {
        // Soft delete — preserve audit trail, allow accounting reconciliation later
        await client.query(`UPDATE passes SET status = 'cancelled', updated_at = NOW() WHERE id = $1`, [id]);
        return { code: p.code, mode: 'soft', tx_count: p.tx_count };
      }

      // No history (or admin override with ?force=1) — safe to hard delete
      await client.query('DELETE FROM pass_transactions WHERE pass_id = $1 AND business_id = $2', [id, bid]);
      await client.query('DELETE FROM passes WHERE id = $1 AND business_id = $2', [id, bid]);
      return { code: p.code, mode: 'hard', tx_count: p.tx_count };
    });

    res.json({ deleted: true, code: result.code, mode: result.mode });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    next(err);
  }
});

module.exports = router;
