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
    const { status, search, limit, offset } = req.query;

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

    const limitVal = Math.min(Math.max(parseInt(limit) || 50, 1), 200);
    const offsetVal = Math.max(parseInt(offset) || 0, 0);
    sql += ` ORDER BY gc.created_at DESC LIMIT $${idx} OFFSET $${idx + 1}`;
    params.push(limitVal, offsetVal);
    const result = await queryWithRLS(bid, sql, params);

    // Total count (same WHERE, no joins)
    let countSql = `SELECT COUNT(*) FROM gift_cards WHERE business_id = $1`;
    const countParams = [bid];
    let cIdx = 2;
    if (status && status !== 'all') { countSql += ` AND status = $${cIdx}`; countParams.push(status); cIdx++; }
    if (search) { countSql += ` AND (code ILIKE $${cIdx} OR recipient_name ILIKE $${cIdx} OR recipient_email ILIKE $${cIdx} OR buyer_name ILIKE $${cIdx})`; countParams.push(`%${search}%`); cIdx++; }
    const countRes = await queryWithRLS(bid, countSql, countParams);
    const total_count = parseInt(countRes.rows[0]?.count) || 0;

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
    res.json({
      gift_cards: result.rows,
      stats: stats.rows[0],
      feature_enabled,
      pagination: { total_count, limit: limitVal, offset: offsetVal }
    });
  } catch (err) { next(err); }
});

// ============================================================
// POST /api/gift-cards — create manually (staff)
// ============================================================
router.post('/', blockIfImpersonated, async (req, res, next) => {
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
        // BUG-GC-EMAIL-LOWER fix: normalize emails pour consistance lookup auto-debit.
        [bid, code, amount_cents, buyer_name || null, buyer_email ? String(buyer_email).toLowerCase() : null,
         recipient_name || null, recipient_email ? String(recipient_email).toLowerCase() : null, message || null,
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
        const bizResult = await queryWithRLS(bid, 'SELECT id, name, slug, theme, email FROM businesses WHERE id = $1', [bid]);
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
// PATCH /api/gift-cards/:id — update status (cancel or reactivate)
// ============================================================
router.patch('/:id', blockIfImpersonated, async (req, res, next) => {
  try {
    const bid = req.businessId;
    const { id } = req.params;
    const { status } = req.body;

    if (!['active', 'cancelled'].includes(status)) {
      return res.status(400).json({ error: 'Statut invalide' });
    }

    // M3 fix: protéger contre perte d'argent client. Si on annule une GC ACHETÉE via Stripe
    // (stripe_payment_intent_id set) avec balance > 0, le client perd son argent sans refund.
    // Forcer l'usage de POST /:id/refund qui fait le remboursement Stripe proprement.
    if (status === 'cancelled') {
      const gcRes = await queryWithRLS(bid,
        `SELECT balance_cents, stripe_payment_intent_id, status FROM gift_cards WHERE id = $1 AND business_id = $2`,
        [id, bid]
      );
      if (gcRes.rows.length === 0) return res.status(404).json({ error: 'Carte introuvable' });
      const gc = gcRes.rows[0];
      if (gc.status === 'cancelled') return res.status(409).json({ error: 'Carte déjà annulée' });
      if ((gc.balance_cents || 0) > 0 && gc.stripe_payment_intent_id) {
        return res.status(400).json({
          error: 'Cette carte a un solde non utilisé et a été payée par carte bancaire. Utilisez plutôt le bouton "Rembourser" pour restituer le solde au client.',
          code: 'use_refund_endpoint'
        });
      }
    }

    const result = await queryWithRLS(bid,
      `UPDATE gift_cards SET status = $1, updated_at = NOW()
       WHERE id = $2 AND business_id = $3 RETURNING *`,
      [status, id, bid]
    );

    if (result.rows.length === 0) return res.status(404).json({ error: 'Carte introuvable' });

    // Audit trail for traceability
    try {
      await queryWithRLS(bid,
        `INSERT INTO audit_logs (business_id, actor_user_id, entity_type, entity_id, action, new_data)
         VALUES ($1, $2, 'gift_card', $3, $4, $5)`,
        [bid, req.user?.id || null, id, status === 'cancelled' ? 'gift_card_cancelled' : 'gift_card_reactivated',
         JSON.stringify({ status, balance_cents: result.rows[0].balance_cents })]
      );
    } catch (_) { /* non-critical */ }

    res.json(result.rows[0]);
  } catch (err) { next(err); }
});

// ============================================================
// POST /api/gift-cards/:id/debit — use gift card (staff in salon)
// ============================================================
router.post('/:id/debit', blockIfImpersonated, async (req, res, next) => {
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
// POST /api/gift-cards/:id/refund — credit back + Stripe money-back if applicable
// BUG-GC-REFUND fix: previously this endpoint only restored the INTERNAL balance_cents
// — no Stripe API call → client who bought the GC via Stripe could not actually get
// their money back on their card. Now mirrors /api/passes/:id/refund-full pattern:
// if stripe_payment_intent_id is set, Stripe refund is issued (with net/full policy).
// ============================================================
router.post('/:id/refund', blockIfImpersonated, async (req, res, next) => {
  try {
    const bid = req.businessId;
    const { id } = req.params;
    const { amount_cents, note, booking_id } = req.body;

    if (!amount_cents || amount_cents <= 0) {
      return res.status(400).json({ error: 'Montant invalide' });
    }

    // Read business settings (refund_policy) outside tx
    const bizRes = await queryWithRLS(bid, `SELECT settings FROM businesses WHERE id = $1`, [bid]);
    const refundPolicy = bizRes.rows[0]?.settings?.refund_policy || 'full';

    const result = await transactionWithRLS(bid, async (client) => {
      const gc = await client.query(
        'SELECT * FROM gift_cards WHERE id = $1 AND business_id = $2 FOR UPDATE',
        [id, bid]
      );
      if (gc.rows.length === 0) throw Object.assign(new Error('Carte introuvable'), { status: 404 });
      const card = gc.rows[0];

      // P1-07 v82 : bloquer refund si dispute Stripe en cours sur la GC — évite
      // double-loss (refund + dispute perdue).
      if (card.disputed_at) {
        throw Object.assign(new Error('Litige Stripe en cours sur cette carte cadeau. Attendez la résolution (dashboard Stripe) avant de rembourser.'), { status: 409 });
      }

      const newBalance = card.balance_cents + amount_cents;
      if (newBalance > card.amount_cents) throw Object.assign(new Error('Le remboursement dépasse le montant initial'), { status: 400 });

      // Stripe refund if GC was purchased via Stripe
      let stripeRefundCents = null;
      let stripeFeesCents = 0;
      if (card.stripe_payment_intent_id) {
        const stripeKey = process.env.STRIPE_SECRET_KEY;
        if (!stripeKey) {
          throw Object.assign(new Error('STRIPE_SECRET_KEY manquant — remboursement Stripe impossible'), { status: 500 });
        }
        const stripe = require('stripe')(stripeKey);
        try {
          let piId = card.stripe_payment_intent_id;
          if (piId.startsWith('cs_')) {
            const sess = await stripe.checkout.sessions.retrieve(piId);
            piId = sess.payment_intent;
          }
          if (!piId || !piId.startsWith('pi_')) {
            throw new Error('Identifiant Stripe invalide');
          }
          if (refundPolicy === 'net') {
            // A#4 fix: real Stripe fee lookup (Bancontact flat 0.24€ vs card 1.5%+25c).
            const { resolveStripeFeeCents } = require('../../services/stripe-fee');
            stripeFeesCents = await resolveStripeFeeCents(stripe, piId, amount_cents);
            stripeRefundCents = Math.max(amount_cents - stripeFeesCents, 0);
          } else {
            stripeRefundCents = amount_cents;
          }
          // D-12 parity: Stripe min = 50c. <50 → no Stripe refund but balance still restored internally.
          if (stripeRefundCents >= 50) {
            const { createRefund: _cr } = require('../../services/stripe-refund');
            await _cr(stripe, { payment_intent: piId, amount: stripeRefundCents }, `staff-gc-refund-${id}`);
            console.log(`[GC REFUND] Stripe refund ${stripeRefundCents}c (gross ${amount_cents}c, fees ${stripeFeesCents}c, policy ${refundPolicy}) for PI ${piId}`);
          } else {
            console.warn(`[GC REFUND] netRefund=${stripeRefundCents}c <50c Stripe min — balance restored but no Stripe refund`);
            stripeRefundCents = 0;
          }
        } catch (stripeErr) {
          if (stripeErr.code === 'charge_already_refunded') {
            console.warn(`[GC REFUND] Stripe says already refunded for GC ${id} — proceeding with balance update`);
            stripeRefundCents = 0;
          } else {
            // Stripe must succeed before we credit the balance — keep everything as-is, return error
            const { reportError } = require('../../services/error-reporter');
            reportError(stripeErr, { tag: 'GC_REFUND', gcId: id, piId });
            throw Object.assign(new Error(`Remboursement Stripe échoué : ${stripeErr.message}`), { status: 502 });
          }
        }
      }

      await client.query(
        `UPDATE gift_cards SET balance_cents = $1, status = 'active', updated_at = NOW()
         WHERE id = $2`,
        [newBalance, id]
      );

      // Link transaction to a booking if the staff specified one — improves audit trail.
      const _noteFinal = note || (stripeRefundCents != null ? `Remboursement (${(stripeRefundCents/100).toFixed(2).replace('.',',')} € net Stripe)` : 'Remboursement');
      await client.query(
        `INSERT INTO gift_card_transactions (gift_card_id, business_id, booking_id, amount_cents, type, note, created_by)
         VALUES ($1, $2, $3, $4, 'refund', $5, $6)`,
        [id, bid, booking_id || null, amount_cents, _noteFinal, req.user.id]
      );

      // Audit log — compliance trace of who issued the refund (impersonation included)
      await client.query(
        `INSERT INTO audit_logs (business_id, actor_user_id, entity_type, entity_id, action, old_data, new_data)
         VALUES ($1, $2, 'gift_card', $3, 'gc_refund', $4, $5)`,
        [bid, req.user.id, id,
         JSON.stringify({ code: card.code, balance_cents: card.balance_cents, amount_cents: card.amount_cents, status: card.status }),
         JSON.stringify({ balance_cents: newBalance, refund_amount_cents: amount_cents, stripe_refund_cents: stripeRefundCents, stripe_fees_cents: stripeFeesCents, note: note || null, impersonated_by: req.user.impersonatedBy || null })]
      );

      return { ...card, balance_cents: newBalance, status: 'active', stripe_refund_cents: stripeRefundCents, stripe_fees_cents: stripeFeesCents };
    });

    res.json(result);
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    next(err);
  }
});

module.exports = router;
module.exports.generateCode = generateCode;
