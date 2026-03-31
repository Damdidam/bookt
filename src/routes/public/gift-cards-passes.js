/**
 * Gift Cards & Passes — public endpoints (config, checkout, validate, deposit payment).
 * Extracted from index.js (Phase 4 refactoring).
 */
const router = require('express').Router();
const { query, pool } = require('../../services/db');
const { depositLimiter } = require('../../middleware/rate-limiter');
const { BASE_URL } = require('./helpers');

// ============================================================
// GIFT CARDS
// ============================================================

// GET /api/public/:slug/gift-card-config
router.get('/:slug/gift-card-config', async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT id, name, slug, settings, theme, logo_url FROM businesses WHERE slug = $1 AND is_active = true LIMIT 1`,
      [req.params.slug]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Salon introuvable' });
    const biz = rows[0];
    const s = biz.settings || {};
    if (!s.giftcard_enabled) return res.status(404).json({ error: 'Cartes cadeau non disponibles' });
    res.json({
      business_name: biz.name, slug: biz.slug, theme: biz.theme, logo_url: biz.logo_url || null,
      amounts: s.giftcard_amounts || [2500, 5000, 7500, 10000],
      custom_amount: s.giftcard_custom_amount !== false,
      min_amount_cents: s.giftcard_min_amount_cents || 1000,
      max_amount_cents: s.giftcard_max_amount_cents || 50000,
      expiry_days: s.giftcard_expiry_days || 365
    });
  } catch (err) { next(err); }
});

// POST /api/public/:slug/gift-card/checkout — Stripe Checkout for gift card purchase
router.post('/:slug/gift-card/checkout', async (req, res, next) => {
  try {
    const key = process.env.STRIPE_SECRET_KEY;
    if (!key) return res.status(500).json({ error: 'Paiement non configuré' });
    const stripe = require('stripe')(key);
    const { rows } = await query(
      `SELECT id, name, slug, settings, theme FROM businesses WHERE slug = $1 AND is_active = true LIMIT 1`,
      [req.params.slug]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Salon introuvable' });
    const biz = rows[0];
    const s = biz.settings || {};
    if (!s.giftcard_enabled) return res.status(400).json({ error: 'Cartes cadeau non disponibles' });
    const { amount_cents, buyer_name, buyer_email, recipient_name, recipient_email, message } = req.body;
    if (!amount_cents || amount_cents < (s.giftcard_min_amount_cents || 1000)) return res.status(400).json({ error: 'Montant trop faible' });
    if (amount_cents > (s.giftcard_max_amount_cents || 50000)) return res.status(400).json({ error: 'Montant trop élevé' });
    if (!buyer_email) return res.status(400).json({ error: 'Email acheteur requis' });
    const baseUrl = BASE_URL;
    const session = await stripe.checkout.sessions.create({
      mode: 'payment', payment_method_types: ['card', 'bancontact'],
      line_items: [{ price_data: { currency: 'eur', unit_amount: amount_cents, product_data: { name: `Carte cadeau — ${biz.name}`, description: `Valeur : ${(amount_cents / 100).toFixed(2)}€` } }, quantity: 1 }],
      customer_email: buyer_email,
      metadata: { type: 'gift_card', business_id: biz.id, amount_cents: String(amount_cents), buyer_name: buyer_name || '', buyer_email, recipient_name: recipient_name || '', recipient_email: recipient_email || '', message: (message || '').substring(0, 500) },
      success_url: `${baseUrl}/${biz.slug}/gift-card?success=1`,
      cancel_url: `${baseUrl}/${biz.slug}/gift-card`,
      locale: 'fr', expires_at: Math.floor(Date.now() / 1000) + 1800
    });
    res.json({ url: session.url, session_id: session.id });
  } catch (err) { console.error('[GIFT-CARD CHECKOUT] Error:', err); next(err); }
});

// POST /api/public/deposit/:token/gift-card — pay deposit with gift card
router.post('/deposit/:token/gift-card', depositLimiter, async (req, res, next) => {
  const client = await pool.connect();
  try {
    const { token } = req.params;
    const { code } = req.body;
    if (!code) return res.status(400).json({ error: 'Code requis' });
    await client.query('BEGIN');
    const bkRes = await client.query(
      `SELECT b.id, b.business_id, b.status, b.deposit_required, b.deposit_status,
              b.deposit_amount_cents, b.deposit_deadline, b.public_token, b.group_id,
              b.start_at, c.email AS client_email, c.full_name AS client_name,
              biz.name AS business_name
       FROM bookings b LEFT JOIN clients c ON c.id = b.client_id
       JOIN businesses biz ON biz.id = b.business_id
       WHERE b.public_token = $1 FOR UPDATE OF b`,
      [token]
    );
    if (bkRes.rows.length === 0) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Rendez-vous introuvable' }); }
    const bk = bkRes.rows[0];
    if (!bk.deposit_required || bk.status !== 'pending_deposit' || bk.deposit_status !== 'pending') {
      await client.query('ROLLBACK'); return res.status(400).json({ error: 'Aucun acompte en attente' });
    }
    if (bk.deposit_deadline && new Date(bk.deposit_deadline) < new Date()) {
      await client.query('ROLLBACK'); return res.status(400).json({ error: 'Le délai de paiement est dépassé' });
    }
    const gcRes = await client.query(
      `SELECT id, code, balance_cents, status, expires_at FROM gift_cards WHERE code = $1 AND business_id = $2 FOR UPDATE`,
      [code.toUpperCase().trim(), bk.business_id]
    );
    if (gcRes.rows.length === 0) { await client.query('ROLLBACK'); return res.status(400).json({ error: 'Code carte cadeau invalide' }); }
    const gc = gcRes.rows[0];
    if (gc.status !== 'active') { await client.query('ROLLBACK'); return res.status(400).json({ error: 'Carte inactive ou expirée' }); }
    if (gc.expires_at && new Date(gc.expires_at) < new Date()) { await client.query('ROLLBACK'); return res.status(400).json({ error: 'Carte expirée' }); }
    // Check for existing GC debits on this booking to prevent double application
    const existingGcRes = await client.query(
      `SELECT COALESCE(SUM(amount_cents), 0) AS total_paid FROM gift_card_transactions WHERE booking_id = $1 AND type = 'debit'`,
      [bk.id]
    );
    const existingGcPaid = parseInt(existingGcRes.rows[0]?.total_paid) || 0;
    const remainingDeposit = Math.max(0, bk.deposit_amount_cents - existingGcPaid);
    if (remainingDeposit <= 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: "L'acompte est déjà couvert" });
    }
    const gcDebit = Math.min(gc.balance_cents, remainingDeposit);
    const remaining = remainingDeposit - gcDebit;
    const newBalance = gc.balance_cents - gcDebit;
    await client.query(`UPDATE gift_cards SET balance_cents = $1, status = $2, updated_at = NOW() WHERE id = $3`, [newBalance, newBalance === 0 ? 'used' : 'active', gc.id]);
    await client.query(`INSERT INTO gift_card_transactions (id, gift_card_id, business_id, booking_id, amount_cents, type, note) VALUES (gen_random_uuid(), $1, $2, $3, $4, 'debit', $5)`, [gc.id, bk.business_id, bk.id, gcDebit, `Acompte RDV — carte ${gc.code}`]);

    if (remaining <= 0) {
      await client.query(`UPDATE bookings SET status = 'confirmed', deposit_status = 'paid', deposit_paid_at = NOW(), deposit_payment_intent_id = $1 WHERE id = $2`, [`gc_${gc.code}`, bk.id]);
      if (bk.group_id) {
        await client.query(`UPDATE bookings SET status = 'confirmed', deposit_status = 'paid', deposit_paid_at = NOW() WHERE group_id = $1 AND id != $2 AND status = 'pending_deposit'`, [bk.group_id, bk.id]);
      }
      await client.query('COMMIT');
      // Send deposit-paid confirmation email
      try {
        const fullBk = await query(
          `SELECT b.*, CASE WHEN sv.name IS NOT NULL THEN s.name || ' — ' || sv.name ELSE s.name END AS service_name,
                  s.category AS service_category,
                  COALESCE(sv.price_cents, s.price_cents, 0) AS service_price_cents,
                  COALESCE(sv.duration_min, s.duration_min, 0) AS duration_min,
                  p.display_name AS practitioner_name,
                  c.full_name AS client_name, c.email AS client_email,
                  biz.name AS biz_name, biz.email AS biz_email, biz.address AS biz_address,
                  biz.theme AS biz_theme, biz.slug AS biz_slug, biz.settings AS biz_settings
           FROM bookings b LEFT JOIN services s ON s.id = b.service_id LEFT JOIN service_variants sv ON sv.id = b.service_variant_id
           LEFT JOIN practitioners p ON p.id = b.practitioner_id LEFT JOIN clients c ON c.id = b.client_id
           JOIN businesses biz ON biz.id = b.business_id WHERE b.id = $1`, [bk.id]
        );
        if (fullBk.rows[0]?.client_email) {
          const row = fullBk.rows[0];
          let groupServices = null;
          if (row.group_id) {
            const grp = await query(
              `SELECT CASE WHEN sv.name IS NOT NULL THEN COALESCE(s.category || ' - ', '') || s.name || ' — ' || sv.name ELSE COALESCE(s.category || ' - ', '') || s.name END AS name, COALESCE(sv.duration_min, s.duration_min) AS duration_min, COALESCE(sv.price_cents, s.price_cents) AS price_cents, b.end_at, b.practitioner_id, p.display_name AS practitioner_name FROM bookings b LEFT JOIN services s ON s.id = b.service_id LEFT JOIN service_variants sv ON sv.id = b.service_variant_id LEFT JOIN practitioners p ON p.id = b.practitioner_id WHERE b.group_id = $1 AND b.business_id = $2 ORDER BY b.group_order, b.start_at`,
              [row.group_id, row.business_id]
            );
            if (grp.rows.length > 1) {
              const _pIds = new Set(grp.rows.map(r => r.practitioner_id));
              if (_pIds.size <= 1) grp.rows.forEach(r => { r.practitioner_name = null; });
              groupServices = grp.rows;
            }
          }
          const groupEndAt = groupServices ? groupServices[groupServices.length - 1].end_at : null;
          const { getGcPaidCents } = require('../../services/gift-card-refund');
          const gcPaidForEmail = await getGcPaidCents(bk.id);
          const { sendDepositPaidEmail } = require('../../services/email');
          await sendDepositPaidEmail({
            booking: { start_at: row.start_at, end_at: groupEndAt || row.end_at, deposit_amount_cents: row.deposit_amount_cents, gc_paid_cents: gcPaidForEmail, client_name: row.client_name, client_email: row.client_email, service_name: row.service_name, service_category: row.service_category, practitioner_name: row.practitioner_name, public_token: row.public_token, promotion_label: row.promotion_label, promotion_discount_cents: row.promotion_discount_cents, promotion_discount_pct: row.promotion_discount_pct, service_price_cents: row.service_price_cents, duration_min: row.duration_min },
            business: { name: row.biz_name, slug: row.biz_slug, email: row.biz_email, address: row.biz_address, theme: row.biz_theme, settings: row.biz_settings },
            groupServices
          });
        }
      } catch (e) { console.error('[GC DEPOSIT] Email error:', e.message); }
      try { const { broadcast } = require('../../services/sse'); if (broadcast) broadcast(bk.business_id, { type: 'booking', action: 'updated', booking_id: bk.id }); } catch (e) {}
      return res.json({ success: true, fully_paid: true, gc_amount_used: gcDebit, remaining: 0, gc_balance: newBalance });
    } else {
      await client.query('COMMIT');
      return res.json({ success: true, fully_paid: false, gc_amount_used: gcDebit, remaining, gc_balance: newBalance });
    }
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('[GC DEPOSIT] Error:', err); next(err);
  } finally { client.release(); }
});

// POST /api/public/deposit/:token/check-gift-cards
router.post('/deposit/:token/check-gift-cards', async (req, res, next) => {
  try {
    const bkRes = await query(
      `SELECT b.business_id, c.email FROM bookings b LEFT JOIN clients c ON c.id = b.client_id WHERE b.public_token = $1 AND b.status = 'pending_deposit'`,
      [req.params.token]
    );
    if (bkRes.rows.length === 0 || !bkRes.rows[0].email) return res.json({ cards: [] });
    const { business_id, email } = bkRes.rows[0];
    const gcRes = await query(
      `SELECT code, balance_cents, expires_at FROM gift_cards WHERE business_id = $1 AND status = 'active' AND balance_cents > 0 AND (recipient_email = $2 OR buyer_email = $2) AND (expires_at IS NULL OR expires_at > NOW()) ORDER BY balance_cents DESC`,
      [business_id, email]
    );
    res.json({ cards: gcRes.rows });
  } catch (err) { next(err); }
});

// POST /api/public/gift-card/validate
router.post('/gift-card/validate', depositLimiter, async (req, res, next) => {
  try {
    const { code, business_id } = req.body;
    if (!code) return res.status(400).json({ error: 'Code requis' });
    let sql = `SELECT id, code, amount_cents, balance_cents, status, expires_at, business_id FROM gift_cards WHERE code = $1`;
    const params = [code.toUpperCase().trim()];
    if (business_id) { sql += ' AND business_id = $2'; params.push(business_id); }
    const result = await query(sql, params);
    if (result.rows.length === 0) return res.json({ valid: false, error: 'Code invalide' });
    const gc = result.rows[0];
    if (gc.status !== 'active') return res.json({ valid: false, error: gc.status === 'expired' ? 'Carte expirée' : 'Carte inactive' });
    if (gc.expires_at && new Date(gc.expires_at) < new Date()) return res.json({ valid: false, error: 'Carte expirée' });
    res.json({ valid: true, balance_cents: gc.balance_cents, amount_cents: gc.amount_cents, expires_at: gc.expires_at });
  } catch (err) { next(err); }
});

// ============================================================
// PASSES / SUBSCRIPTIONS
// ============================================================

// GET /api/public/:slug/pass-config
router.get('/:slug/pass-config', async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT id, name, slug, settings, theme, logo_url FROM businesses WHERE slug = $1 AND is_active = true LIMIT 1`,
      [req.params.slug]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Salon introuvable' });
    const biz = rows[0]; const s = biz.settings || {};
    if (!s.passes_enabled) return res.status(404).json({ error: 'Abonnements non disponibles' });
    const tplRes = await query(
      `SELECT pt.id, pt.name, pt.description, pt.sessions_count, pt.price_cents, pt.validity_days, pt.service_variant_id,
              s.name AS service_name, s.category AS service_category, COALESCE(s.price_cents, 0) AS service_price_cents, sv.name AS variant_name
       FROM pass_templates pt JOIN services s ON s.id = pt.service_id LEFT JOIN service_variants sv ON sv.id = pt.service_variant_id
       WHERE pt.business_id = $1 AND pt.is_active = true ORDER BY s.name, sv.name, pt.price_cents`,
      [biz.id]
    );
    res.json({ business_name: biz.name, slug: biz.slug, theme: biz.theme, logo_url: biz.logo_url || null, templates: tplRes.rows, validity_days: s.pass_validity_days || 365 });
  } catch (err) { next(err); }
});

// POST /api/public/:slug/pass/checkout
router.post('/:slug/pass/checkout', async (req, res, next) => {
  try {
    const key = process.env.STRIPE_SECRET_KEY;
    if (!key) return res.status(500).json({ error: 'Paiement non configuré' });
    const stripe = require('stripe')(key);
    const { rows } = await query(
      `SELECT id, name, slug, settings, theme FROM businesses WHERE slug = $1 AND is_active = true LIMIT 1`,
      [req.params.slug]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Salon introuvable' });
    const biz = rows[0]; const s = biz.settings || {};
    if (!s.passes_enabled) return res.status(400).json({ error: 'Abonnements non disponibles' });
    const { pass_template_id, buyer_name, buyer_email, buyer_phone, oauth_provider, oauth_provider_id } = req.body;
    if (!pass_template_id) return res.status(400).json({ error: 'Template requis' });
    if (!buyer_email) return res.status(400).json({ error: 'Email requis' });
    const tplRes = await query(
      `SELECT pt.*, s.name AS service_name FROM pass_templates pt JOIN services s ON s.id = pt.service_id WHERE pt.id = $1 AND pt.business_id = $2 AND pt.is_active = true`,
      [pass_template_id, biz.id]
    );
    if (tplRes.rows.length === 0) return res.status(404).json({ error: 'Formule introuvable' });
    const tpl = tplRes.rows[0];
    const baseUrl = BASE_URL;
    const session = await stripe.checkout.sessions.create({
      mode: 'payment', payment_method_types: ['card', 'bancontact'],
      line_items: [{ price_data: { currency: 'eur', unit_amount: tpl.price_cents, product_data: { name: `Pass ${tpl.name}`, description: `${tpl.sessions_count} séances — ${tpl.service_name}` } }, quantity: 1 }],
      metadata: { type: 'pass', business_id: biz.id, pass_template_id: tpl.id, buyer_name: buyer_name || '', buyer_email, buyer_phone: buyer_phone || '', oauth_provider: oauth_provider || '', oauth_provider_id: oauth_provider_id || '' },
      customer_email: buyer_email,
      success_url: `${baseUrl}/${biz.slug}/pass?success=1`,
      cancel_url: `${baseUrl}/${biz.slug}/pass`,
      expires_at: Math.floor(Date.now() / 1000) + 30 * 60
    });
    res.json({ url: session.url, session_id: session.id });
  } catch (err) { next(err); }
});

// POST /api/public/pass/validate
router.post('/pass/validate', depositLimiter, async (req, res, next) => {
  try {
    const { code, business_id } = req.body;
    if (!code) return res.status(400).json({ error: 'Code requis' });
    const passRes = await query(
      `SELECT p.id, p.code, p.name, p.sessions_total, p.sessions_remaining, p.service_id, p.expires_at, p.status, s.name AS service_name
       FROM passes p JOIN services s ON s.id = p.service_id WHERE p.code = $1 ${business_id ? 'AND p.business_id = $2' : ''} LIMIT 1`,
      business_id ? [code.toUpperCase().trim(), business_id] : [code.toUpperCase().trim()]
    );
    if (passRes.rows.length === 0) return res.json({ valid: false, error: 'Code invalide' });
    const pass = passRes.rows[0];
    if (pass.status !== 'active') return res.json({ valid: false, error: 'Pass inactif ou expiré' });
    if (pass.expires_at && new Date(pass.expires_at) < new Date()) return res.json({ valid: false, error: 'Pass expiré' });
    if (pass.sessions_remaining <= 0) return res.json({ valid: false, error: 'Plus de séances disponibles' });
    res.json({ valid: true, sessions_remaining: pass.sessions_remaining, sessions_total: pass.sessions_total, service_id: pass.service_id, service_name: pass.service_name, expires_at: pass.expires_at });
  } catch (err) { next(err); }
});

// POST /api/public/deposit/:token/check-passes
router.post('/deposit/:token/check-passes', async (req, res, next) => {
  try {
    const bkRes = await query(
      `SELECT b.business_id, b.service_id, b.service_variant_id, c.email FROM bookings b LEFT JOIN clients c ON c.id = b.client_id WHERE b.public_token = $1 AND b.status IN ('pending_deposit', 'confirmed', 'pending')`,
      [req.params.token]
    );
    if (bkRes.rows.length === 0 || !bkRes.rows[0].email) return res.json({ passes: [] });
    const { business_id, service_id, service_variant_id, email } = bkRes.rows[0];
    let passSql = `SELECT p.code, p.sessions_remaining, p.sessions_total, p.expires_at, p.name, s.name AS service_name
       FROM passes p JOIN services s ON s.id = p.service_id
       WHERE p.business_id = $1 AND p.status = 'active' AND p.sessions_remaining > 0 AND p.service_id = $2
         AND LOWER(p.buyer_email) = LOWER($3) AND (p.expires_at IS NULL OR p.expires_at > NOW())`;
    const passParams = [business_id, service_id, email];
    // Filter by variant if the pass has a specific variant_id (null = all variants accepted)
    if (service_variant_id) {
      passSql += ` AND (p.service_variant_id IS NULL OR p.service_variant_id = $4)`;
      passParams.push(service_variant_id);
    }
    passSql += ` ORDER BY p.sessions_remaining DESC`;
    const passRes = await query(passSql, passParams);
    res.json({ passes: passRes.rows });
  } catch (err) { next(err); }
});

module.exports = router;
