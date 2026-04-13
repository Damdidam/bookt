const router = require('express').Router();
const crypto = require('crypto');
const { queryWithRLS, transactionWithRLS } = require('../../services/db');
const { requireAuth, requireOwner, requirePro, blockIfImpersonated } = require('../../middleware/auth');

router.use(requireAuth);
router.use(requireOwner);
router.use(requirePro);

/** Read giftcard_enabled from business settings. Defaults to false if unset. */
async function isGiftCardFeatureEnabled(bid) {
  const r = await queryWithRLS(bid, `SELECT settings FROM businesses WHERE id = $1`, [bid]);
  return !!r.rows[0]?.settings?.giftcard_enabled;
}

/** Generate unique gift card code: GC-XXXX-XXXX */
function generateCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no I/O/0/1
  let code = 'GC-';
  for (let i = 0; i < 4; i++) code += chars[crypto.randomInt(chars.length)];
  code += '-';
  for (let i = 0; i < 4; i++) code += chars[crypto.randomInt(chars.length)];
  return code;
}

// ============================================================
// GET /api/gift-cards — list gift cards + stats
// ============================================================
router.get('/', async (req, res, next) => {
  try {
    const bid = req.businessId;
    const { status, search } = req.query;

    let sql = `
      SELECT gc.*,
             (SELECT json_agg(json_build_object(
               'id', t.id, 'amount_cents', t.amount_cents, 'type', t.type,
               'note', t.note, 'booking_id', t.booking_id, 'created_at', t.created_at
             ) ORDER BY t.created_at DESC)
             FROM gift_card_transactions t WHERE t.gift_card_id = gc.id) AS transactions
      FROM gift_cards gc
      WHERE gc.business_id = $1`;
    const params = [bid];
    let idx = 2;

    if (status && status !== 'all') {
      sql += ` AND gc.status = $${idx}`;
      params.push(status);
      idx++;
    }
    if (search) {
      sql += ` AND (gc.code ILIKE $${idx} OR gc.recipient_name ILIKE $${idx} OR gc.recipient_email ILIKE $${idx} OR gc.buyer_name ILIKE $${idx})`;
      params.push(`%${search}%`);
      idx++;
    }

    sql += ` ORDER BY gc.created_at DESC LIMIT 200`;
    const result = await queryWithRLS(bid, sql, params);

    // Stats
    const stats = await queryWithRLS(bid, `
      SELECT
        COUNT(*) AS total,
        COUNT(*) FILTER (WHERE status = 'active') AS active_count,
        COUNT(*) FILTER (WHERE status = 'used') AS used_count,
        COUNT(*) FILTER (WHERE status = 'expired') AS expired_count,
        COALESCE(SUM(amount_cents), 0) AS total_sold_cents,
        COALESCE(SUM(balance_cents) FILTER (WHERE status = 'active'), 0) AS total_balance_cents,
        COALESCE(SUM(amount_cents - balance_cents) FILTER (WHERE status IN ('active','used')), 0) AS total_used_cents
      FROM gift_cards WHERE business_id = $1
    `, [bid]);

    const feature_enabled = await isGiftCardFeatureEnabled(bid);
    res.json({ gift_cards: result.rows, stats: stats.rows[0], feature_enabled });
  } catch (err) { next(err); }
});

// ============================================================
// POST /api/gift-cards — create manually (staff)
// ============================================================
router.post('/', async (req, res, next) => {
  try {
    const bid = req.businessId;
    // Gate: the feature must be enabled in settings. Staff-created GCs were
    // bypassing the public-route check (gift-cards-passes.js) — now aligned.
    if (!(await isGiftCardFeatureEnabled(bid))) {
      return res.status(403).json({ error: 'Les cartes cadeau sont désactivées. Activez-les dans Paramètres > Cartes cadeau.' });
    }
    const { amount_cents, recipient_name, recipient_email, buyer_name, buyer_email, message, expiry_days } = req.body;

    if (!amount_cents || amount_cents < 100) {
      return res.status(400).json({ error: 'Montant minimum: 1€' });
    }

    // Generate unique code (retry on collision)
    let code, codeIsUnique = false;
    for (let i = 0; i < 10; i++) {
      code = generateCode();
      const exists = await queryWithRLS(bid, 'SELECT 1 FROM gift_cards WHERE code = $1', [code]);
      if (exists.rows.length === 0) { codeIsUnique = true; break; }
    }
    if (!codeIsUnique) return res.status(500).json({ error: 'Impossible de générer un code unique. Veuillez réessayer.' });

    const days = expiry_days || 365;
    const expires_at = new Date(Date.now() + days * 86400000);

    const result = await transactionWithRLS(bid, async (client) => {
      const gc = await client.query(
        `INSERT INTO gift_cards (business_id, code, amount_cents, balance_cents, buyer_name, buyer_email,
         recipient_name, recipient_email, message, expires_at, created_by)
         VALUES ($1, $2, $3, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *`,
        [bid, code, amount_cents, buyer_name || null, buyer_email || null,
         recipient_name || null, recipient_email || null, message || null,
         expires_at, req.user.id]
      );

      await client.query(
        `INSERT INTO gift_card_transactions (gift_card_id, business_id, amount_cents, type, note, created_by)
         VALUES ($1, $2, $3, 'purchase', 'Création manuelle', $4)`,
        [gc.rows[0].id, bid, amount_cents, req.user.id]
      );

      return gc.rows[0];
    });

    // Send email to recipient if provided
    if (recipient_email) {
      try {
        const bizResult = await queryWithRLS(bid, 'SELECT name, slug, theme, email FROM businesses WHERE id = $1', [bid]);
        const { sendGiftCardEmail } = require('../../services/email');
        await sendGiftCardEmail({ giftCard: result, business: bizResult.rows[0] });
      } catch (emailErr) {
        console.error('[GIFT-CARD] Email failed:', emailErr.message);
      }
    }

    res.status(201).json(result);
  } catch (err) { next(err); }
});

// ============================================================
// PATCH /api/gift-cards/:id — update status (cancel)
// ============================================================
router.patch('/:id', async (req, res, next) => {
  try {
    const bid = req.businessId;
    const { id } = req.params;
    const { status } = req.body;

    if (!['active', 'cancelled'].includes(status)) {
      return res.status(400).json({ error: 'Statut invalide' });
    }

    const result = await queryWithRLS(bid,
      `UPDATE gift_cards SET status = $1, updated_at = NOW()
       WHERE id = $2 AND business_id = $3 RETURNING *`,
      [status, id, bid]
    );

    if (result.rows.length === 0) return res.status(404).json({ error: 'Carte introuvable' });
    res.json(result.rows[0]);
  } catch (err) { next(err); }
});

// ============================================================
// POST /api/gift-cards/:id/debit — use gift card (staff in salon)
// ============================================================
router.post('/:id/debit', async (req, res, next) => {
  try {
    const bid = req.businessId;
    const { id } = req.params;
    const { amount_cents, booking_id, note } = req.body;

    if (!amount_cents || amount_cents <= 0) {
      return res.status(400).json({ error: 'Montant invalide' });
    }

    const result = await transactionWithRLS(bid, async (client) => {
      const gc = await client.query(
        'SELECT * FROM gift_cards WHERE id = $1 AND business_id = $2 FOR UPDATE',
        [id, bid]
      );
      if (gc.rows.length === 0) throw Object.assign(new Error('Carte introuvable'), { status: 404 });
      const card = gc.rows[0];

      if (card.status !== 'active') throw Object.assign(new Error('Cette carte n\'est plus active'), { status: 400 });
      if (card.balance_cents < amount_cents) throw Object.assign(new Error(`Solde insuffisant (${(card.balance_cents/100).toFixed(2).replace('.',',')}€)`), { status: 400 });

      const newBalance = card.balance_cents - amount_cents;
      const newStatus = newBalance === 0 ? 'used' : 'active';

      await client.query(
        `UPDATE gift_cards SET balance_cents = $1, status = $2, updated_at = NOW()
         WHERE id = $3`,
        [newBalance, newStatus, id]
      );

      await client.query(
        `INSERT INTO gift_card_transactions (gift_card_id, business_id, booking_id, amount_cents, type, note, created_by)
         VALUES ($1, $2, $3, $4, 'debit', $5, $6)`,
        [id, bid, booking_id || null, amount_cents, note || null, req.user.id]
      );

      return { ...card, balance_cents: newBalance, status: newStatus };
    });

    res.json(result);
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    next(err);
  }
});

// ============================================================
// POST /api/gift-cards/:id/refund — credit back
// ============================================================
router.post('/:id/refund', blockIfImpersonated, async (req, res, next) => {
  try {
    const bid = req.businessId;
    const { id } = req.params;
    const { amount_cents, note, booking_id } = req.body;

    if (!amount_cents || amount_cents <= 0) {
      return res.status(400).json({ error: 'Montant invalide' });
    }

    const result = await transactionWithRLS(bid, async (client) => {
      const gc = await client.query(
        'SELECT * FROM gift_cards WHERE id = $1 AND business_id = $2 FOR UPDATE',
        [id, bid]
      );
      if (gc.rows.length === 0) throw Object.assign(new Error('Carte introuvable'), { status: 404 });
      const card = gc.rows[0];

      const newBalance = card.balance_cents + amount_cents;
      if (newBalance > card.amount_cents) throw Object.assign(new Error('Le remboursement dépasse le montant initial'), { status: 400 });

      await client.query(
        `UPDATE gift_cards SET balance_cents = $1, status = 'active', updated_at = NOW()
         WHERE id = $2`,
        [newBalance, id]
      );

      // Link transaction to a booking if the staff specified one — improves audit trail.
      await client.query(
        `INSERT INTO gift_card_transactions (gift_card_id, business_id, booking_id, amount_cents, type, note, created_by)
         VALUES ($1, $2, $3, $4, 'refund', $5, $6)`,
        [id, bid, booking_id || null, amount_cents, note || 'Remboursement', req.user.id]
      );

      return { ...card, balance_cents: newBalance, status: 'active' };
    });

    res.json(result);
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    next(err);
  }
});

module.exports = router;
module.exports.generateCode = generateCode;
