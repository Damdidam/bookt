/**
 * Deposit — Stripe checkout, payment redirect, verification.
 * Extracted from index.js (Phase 4c refactoring).
 */
const router = require('express').Router();
const { query } = require('../../services/db');
const { depositLimiter } = require('../../middleware/rate-limiter');
const { BASE_URL } = require('./helpers');

// ============================================================
// POST /api/public/deposit/:token/checkout
// Create Stripe Checkout Session for deposit payment
// ============================================================
router.post('/deposit/:token/checkout', depositLimiter, async (req, res, next) => {
  try {
    const { token } = req.params;

    // 1. Fetch booking + business
    const result = await query(
      `SELECT b.id, b.business_id, b.status, b.deposit_required, b.deposit_status,
              b.deposit_amount_cents, b.deposit_deadline, b.public_token,
              b.start_at, b.deposit_payment_intent_id, b.group_id,
              c.full_name AS client_name, c.email AS client_email,
              CASE WHEN sv.name IS NOT NULL THEN s.name || ' — ' || sv.name ELSE s.name END AS service_name,
                  s.category AS service_category,
              biz.name AS business_name, biz.plan AS business_plan, biz.stripe_customer_id,
              biz.stripe_connect_id, biz.stripe_connect_status
       FROM bookings b
       LEFT JOIN clients c ON c.id = b.client_id
       LEFT JOIN services s ON s.id = b.service_id
       LEFT JOIN service_variants sv ON sv.id = b.service_variant_id
       JOIN businesses biz ON biz.id = b.business_id
       WHERE b.public_token = $1`,
      [token]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Rendez-vous introuvable' });
    const bk = result.rows[0];
    if ((bk.business_plan || 'free') === 'free') return res.status(403).json({ error: 'upgrade_required' });

    // Verify merchant has active Stripe Connect
    if (!bk.stripe_connect_id || bk.stripe_connect_status !== 'active') {
      return res.status(503).json({ error: 'Le paiement en ligne n\'est pas encore configuré par ce commerce' });
    }

    // 2. Validate deposit is still pending
    if (!bk.deposit_required || bk.status !== 'pending_deposit') {
      return res.status(400).json({ error: 'Aucun acompte en attente pour ce rendez-vous' });
    }
    if (bk.deposit_status !== 'pending') {
      return res.status(400).json({ error: 'L\'acompte n\'est plus en attente' });
    }

    // 3. Check deadline
    if (bk.deposit_deadline && new Date(bk.deposit_deadline) < new Date()) {
      return res.status(400).json({ error: 'Le délai de paiement est dépassé' });
    }

    // 4. Check Stripe
    const key = process.env.STRIPE_SECRET_KEY;
    if (!key) return res.status(503).json({ error: 'Paiement en ligne non disponible' });
    const stripe = require('stripe')(key);

    // Check if gift card was partially applied
    const gcTxRes = await query(
      `SELECT COALESCE(SUM(amount_cents), 0) AS gc_paid FROM gift_card_transactions
       WHERE booking_id = $1 AND type = 'debit'`, [bk.id]
    );
    const gcPaid = parseInt(gcTxRes.rows[0].gc_paid) || 0;
    const amountCents = (bk.deposit_amount_cents || 0) - gcPaid;
    // S3-8: If remaining amount after GC is below Stripe minimum (50c), treat as fully covered
    if (amountCents > 0 && amountCents < 50) {
      // Auto-confirm: the tiny remaining amount is absorbed — mark deposit as paid
      await query(
        `UPDATE bookings SET deposit_status = 'paid', deposit_paid_at = NOW(),
         deposit_payment_intent_id = COALESCE(deposit_payment_intent_id, 'gc_absorbed')
         WHERE id = $1 AND deposit_status = 'pending'`,
        [bk.id]
      );
      // Also confirm group siblings
      if (bk.group_id) {
        await query(
          `UPDATE bookings SET deposit_status = 'paid', deposit_paid_at = NOW(),
           deposit_payment_intent_id = COALESCE(deposit_payment_intent_id, 'gc_absorbed')
           WHERE group_id = $1 AND business_id = $2 AND deposit_status = 'pending'`,
          [bk.group_id, bk.business_id]
        );
      }
      return res.json({ status: 'already_paid', message: 'Acompte couvert par votre carte cadeau' });
    }
    if (amountCents <= 0) return res.json({ status: 'already_paid', message: 'Acompte déjà couvert' });

    // M13: Reuse existing Stripe session if still open
    if (bk.deposit_payment_intent_id && bk.deposit_payment_intent_id.startsWith('cs_')) {
      try {
        const existingSession = await stripe.checkout.sessions.retrieve(bk.deposit_payment_intent_id);
        if (existingSession.status === 'open' && existingSession.url) {
          return res.json({ url: existingSession.url, session_id: existingSession.id });
        }
      } catch (e) { /* expired or invalid — create new */ }
    }

    // 5. Create Checkout Session
    const baseUrl = BASE_URL;
    const dateStr = new Date(bk.start_at).toLocaleDateString('fr-BE', {
      timeZone: 'Europe/Brussels', day: 'numeric', month: 'short'
    });

    // Multi-service: show count instead of single service name
    let serviceLabelCheckout = bk.service_name || 'Rendez-vous';
    if (bk.group_id) {
      const grpCount = await query(
        `SELECT COUNT(*) AS cnt FROM bookings WHERE group_id = $1 AND business_id = $2 AND status NOT IN ('cancelled')`,
        [bk.group_id, bk.business_id]
      );
      const cnt = parseInt(grpCount.rows[0].cnt) || 1;
      if (cnt > 1) serviceLabelCheckout = `${cnt} prestations`;
    }

    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      payment_method_types: ['card', 'bancontact'],
      line_items: [{
        price_data: {
          currency: 'eur',
          unit_amount: amountCents,
          product_data: {
            name: `Acompte — ${bk.service_category ? bk.service_category + ' - ' : ''}${serviceLabelCheckout}`,
            description: `${bk.business_name} · ${dateStr}`
          }
        },
        quantity: 1
      }],
      payment_intent_data: {
        transfer_data: { destination: bk.stripe_connect_id }
      },
      customer_email: bk.client_email || undefined,
      metadata: {
        type: 'deposit',
        booking_id: bk.id,
        business_id: bk.business_id,
        booking_token: token
      },
      success_url: `${baseUrl}/deposit/${token}?paid=1`,
      cancel_url: `${baseUrl}/deposit/${token}`,
      locale: 'fr',
      expires_at: Math.floor(Date.now() / 1000) + 1800 // 30 min from now
    });

    // 6. Store checkout session ID (payment_intent is null at creation for Checkout sessions)
    // We store session.id (cs_...) so the verify endpoint can check payment status with Stripe
    await query(
      `UPDATE bookings SET deposit_payment_intent_id = $1 WHERE id = $2`,
      [session.id, bk.id]
    );

    res.json({ url: session.url, session_id: session.id });
  } catch (err) {
    console.error('[DEPOSIT CHECKOUT] Error:', err);
    next(err);
  }
});

// ============================================================
// GET /api/public/deposit/:token/pay
// One-click payment redirect: creates Stripe Checkout Session and 302 redirects.
// Used in deposit request emails so clients go directly to Stripe.
// ============================================================
router.get('/deposit/:token/pay', depositLimiter, async (req, res, next) => {
  try {
    const { token } = req.params;
    const baseUrl = BASE_URL;
    const depositPageUrl = `${baseUrl}/deposit/${token}`;

    const result = await query(
      `SELECT b.id, b.business_id, b.status, b.deposit_required, b.deposit_status,
              b.deposit_amount_cents, b.deposit_deadline, b.public_token,
              b.start_at, b.deposit_payment_intent_id, b.group_id,
              c.email AS client_email,
              CASE WHEN sv.name IS NOT NULL THEN s.name || ' — ' || sv.name ELSE s.name END AS service_name,
                  s.category AS service_category,
              biz.name AS business_name, biz.plan AS business_plan,
              biz.stripe_connect_id, biz.stripe_connect_status
       FROM bookings b
       LEFT JOIN clients c ON c.id = b.client_id
       LEFT JOIN services s ON s.id = b.service_id
       LEFT JOIN service_variants sv ON sv.id = b.service_variant_id
       JOIN businesses biz ON biz.id = b.business_id
       WHERE b.public_token = $1`,
      [token]
    );
    if (result.rows.length === 0) return res.redirect(depositPageUrl + '?error=not_found');
    const bk = result.rows[0];
    if ((bk.business_plan || 'free') === 'free') return res.redirect(depositPageUrl + '?error=upgrade_required');

    // Verify merchant has active Stripe Connect
    if (!bk.stripe_connect_id || bk.stripe_connect_status !== 'active') {
      return res.redirect(depositPageUrl + '?error=stripe');
    }

    // Already paid or not pending → redirect to deposit page with status
    if (!bk.deposit_required || bk.status !== 'pending_deposit' || bk.deposit_status !== 'pending') {
      return res.redirect(depositPageUrl + (bk.deposit_status === 'paid' ? '?paid=1' : ''));
    }
    // Deadline passed
    if (bk.deposit_deadline && new Date(bk.deposit_deadline) < new Date()) {
      return res.redirect(depositPageUrl + '?error=expired');
    }

    const key = process.env.STRIPE_SECRET_KEY;
    if (!key) return res.redirect(depositPageUrl + '?error=stripe');
    const stripe = require('stripe')(key);

    // Check if gift card was partially applied
    const gcTxRes2 = await query(
      `SELECT COALESCE(SUM(amount_cents), 0) AS gc_paid FROM gift_card_transactions
       WHERE booking_id = $1 AND type = 'debit'`, [bk.id]
    );
    const gcPaid2 = parseInt(gcTxRes2.rows[0].gc_paid) || 0;
    const amountCents = (bk.deposit_amount_cents || 0) - gcPaid2;
    // S3-8: Auto-confirm if remaining is below Stripe minimum (same logic as POST /checkout)
    if (amountCents > 0 && amountCents < 50) {
      await query(
        `UPDATE bookings SET deposit_status = 'paid', deposit_paid_at = NOW(),
         deposit_payment_intent_id = COALESCE(deposit_payment_intent_id, 'gc_absorbed')
         WHERE id = $1 AND deposit_status = 'pending'`, [bk.id]
      );
      if (bk.group_id) {
        await query(
          `UPDATE bookings SET deposit_status = 'paid', deposit_paid_at = NOW(),
           deposit_payment_intent_id = COALESCE(deposit_payment_intent_id, 'gc_absorbed')
           WHERE group_id = $1 AND business_id = $2 AND deposit_status = 'pending'`,
          [bk.group_id, bk.business_id]
        );
      }
      return res.redirect(depositPageUrl + '?paid=1');
    }
    if (amountCents <= 0) return res.redirect(depositPageUrl + '?paid=1');

    // M13: Reuse existing Stripe session if still open
    if (bk.deposit_payment_intent_id && bk.deposit_payment_intent_id.startsWith('cs_')) {
      try {
        const existingSession = await stripe.checkout.sessions.retrieve(bk.deposit_payment_intent_id);
        if (existingSession.status === 'open' && existingSession.url) {
          return res.redirect(existingSession.url);
        }
      } catch (e) { /* expired or invalid — create new */ }
    }

    const dateStr = new Date(bk.start_at).toLocaleDateString('fr-BE', {
      timeZone: 'Europe/Brussels', day: 'numeric', month: 'short'
    });

    // Multi-service: show count instead of single service name
    let serviceLabelCheckout2 = bk.service_name || 'Rendez-vous';
    if (bk.group_id) {
      const grpCount2 = await query(
        `SELECT COUNT(*) AS cnt FROM bookings WHERE group_id = $1 AND business_id = $2 AND status NOT IN ('cancelled')`,
        [bk.group_id, bk.business_id]
      );
      const cnt2 = parseInt(grpCount2.rows[0].cnt) || 1;
      if (cnt2 > 1) serviceLabelCheckout2 = `${cnt2} prestations`;
    }

    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      payment_method_types: ['card', 'bancontact'],
      line_items: [{
        price_data: {
          currency: 'eur',
          unit_amount: amountCents,
          product_data: {
            name: `Acompte — ${bk.service_category ? bk.service_category + ' - ' : ''}${serviceLabelCheckout2}`,
            description: `${bk.business_name} · ${dateStr}`
          }
        },
        quantity: 1
      }],
      payment_intent_data: {
        transfer_data: { destination: bk.stripe_connect_id }
      },
      customer_email: bk.client_email || undefined,
      metadata: {
        type: 'deposit',
        booking_id: bk.id,
        business_id: bk.business_id,
        booking_token: token
      },
      success_url: `${baseUrl}/deposit/${token}?paid=1`,
      cancel_url: depositPageUrl,
      locale: 'fr',
      expires_at: Math.floor(Date.now() / 1000) + 1800
    });

    await query(
      `UPDATE bookings SET deposit_payment_intent_id = $1 WHERE id = $2`,
      [session.id, bk.id]
    );

    res.redirect(session.url);
  } catch (err) {
    console.error('[DEPOSIT PAY REDIRECT] Error:', err);
    const baseUrl = BASE_URL;
    res.redirect(`${baseUrl}/deposit/${req.params.token}?error=checkout`);
  }
});

// ============================================================
// POST /api/public/deposit/:token/verify
// Verify payment status directly with Stripe (fallback when webhook delayed/missing)
// ============================================================
router.post('/deposit/:token/verify', depositLimiter, async (req, res, next) => {
  try {
    const { token } = req.params;

    const result = await query(
      `SELECT b.id, b.business_id, b.status, b.deposit_status, b.deposit_payment_intent_id,
              b.group_id, b.deposit_deadline
       FROM bookings b
       WHERE b.public_token = $1`,
      [token]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Booking not found' });
    const bk = result.rows[0];

    // Already paid or not pending
    if (bk.deposit_status === 'paid') return res.json({ status: 'paid', updated: false });
    if (bk.status !== 'pending_deposit' || bk.deposit_status !== 'pending') {
      return res.json({ status: bk.deposit_status, updated: false });
    }
    // Reject if deposit deadline has passed (cron may not have run yet)
    if (bk.deposit_deadline && new Date(bk.deposit_deadline) < new Date()) {
      return res.json({ status: 'expired', updated: false, reason: 'deadline_passed' });
    }

    // Need a stored checkout session ID (cs_...) to verify
    const csId = bk.deposit_payment_intent_id;
    if (!csId || !csId.startsWith('cs_')) {
      return res.json({ status: 'pending', updated: false, reason: 'no_session' });
    }

    // Check with Stripe
    const key = process.env.STRIPE_SECRET_KEY;
    if (!key) return res.json({ status: 'pending', updated: false, reason: 'stripe_not_configured' });
    const stripe = require('stripe')(key);

    const session = await stripe.checkout.sessions.retrieve(csId);
    if (session.payment_status !== 'paid') {
      return res.json({ status: 'pending', updated: false, payment_status: session.payment_status });
    }

    // Payment confirmed by Stripe! Update booking
    const piId = session.payment_intent || null;
    console.log(`[DEPOSIT VERIFY] Payment confirmed for booking ${bk.id} (PI: ${piId}, CS: ${csId})`);

    // M3: Wrap primary + siblings update in transaction for atomicity
    const { transactionWithRLS: txRLS } = require('../../services/db');
    const txResult = await txRLS(bk.business_id, async (txClient) => {
      const upd = await txClient.query(
        `UPDATE bookings SET
          status = 'confirmed',
          locked = true,
          deposit_status = 'paid',
          deposit_paid_at = NOW(),
          deposit_payment_intent_id = COALESCE($1, deposit_payment_intent_id),
          deposit_deadline = NULL
         WHERE id = $2 AND business_id = $3 AND status = 'pending_deposit'
         RETURNING id`,
        [piId, bk.id, bk.business_id]
      );
      let sibIds = [];
      if (upd.rows.length > 0) {
        // 1. Group siblings
        if (bk.group_id) {
          const sibResult = await txClient.query(
            `UPDATE bookings SET status = 'confirmed', locked = true,
              deposit_status = 'paid', deposit_paid_at = NOW(), deposit_deadline = NULL
             WHERE group_id = $1 AND business_id = $2 AND id != $3 AND status = 'pending_deposit'
             RETURNING id`,
            [bk.group_id, bk.business_id, bk.id]
          );
          sibIds = sibResult.rows.map(r => r.id);
        }
        // 2. Detached bookings sharing same deposit_payment_intent_id
        if (piId) {
          const detached = await txClient.query(
            `UPDATE bookings SET status = 'confirmed', locked = true,
              deposit_status = 'paid', deposit_paid_at = NOW(), deposit_deadline = NULL
             WHERE deposit_payment_intent_id = $1 AND business_id = $2 AND id != $3
               AND status = 'pending_deposit' AND group_id IS DISTINCT FROM $4
             RETURNING id`,
            [piId, bk.business_id, bk.id, bk.group_id]
          );
          sibIds = sibIds.concat(detached.rows.map(r => r.id));
        }
      }
      return { upd, sibIds };
    });

    const upd = txResult.upd;
    const sibIds = txResult.sibIds || [];

    if (upd.rows.length > 0) {

      // SSE broadcast
      try {
        const { broadcast } = require('../../services/sse');
        broadcast(bk.business_id, 'booking_update', { action: 'deposit_paid', booking_id: bk.id });
      } catch (e) { /* SSE optional */ }
      // calSyncPush on deposit verify (primary + siblings)
      try { const { calSyncPush } = require('../staff/bookings-helpers'); calSyncPush(bk.business_id, bk.id); } catch (_) {}
      for (const sibId of sibIds) {
        try { const { calSyncPush } = require('../staff/bookings-helpers'); calSyncPush(bk.business_id, sibId); } catch (_) {}
      }

      // Send deposit paid confirmation email (mirrors Stripe webhook behavior)
      try {
        const bkData = await query(
          `SELECT b.start_at, b.end_at, b.deposit_amount_cents, b.group_id, b.public_token,
                  b.booked_price_cents,
                  b.promotion_label, b.promotion_discount_cents, b.promotion_discount_pct, b.discount_pct,
                  c.full_name AS client_name, c.email AS client_email,
                  CASE WHEN sv.name IS NOT NULL THEN s.name || ' — ' || sv.name ELSE s.name END AS service_name,
                  s.category AS service_category,
                  COALESCE(sv.duration_min, s.duration_min) AS duration_min,
                  COALESCE(sv.price_cents, s.price_cents, 0) AS service_price_cents,
                  p.display_name AS practitioner_name,
                  biz.name AS business_name, biz.email AS business_email,
                  biz.phone AS business_phone,
                  biz.address AS business_address, biz.theme, biz.slug,
                  biz.settings AS business_settings
           FROM bookings b
           LEFT JOIN clients c ON c.id = b.client_id
           LEFT JOIN services s ON s.id = b.service_id
           LEFT JOIN service_variants sv ON sv.id = b.service_variant_id
           LEFT JOIN practitioners p ON p.id = b.practitioner_id
           JOIN businesses biz ON biz.id = b.business_id
           WHERE b.id = $1`,
          [bk.id]
        );
        if (bkData.rows.length > 0 && bkData.rows[0].client_email) {
          const d = bkData.rows[0];
          // service_price_cents stays as raw catalog price. Template uses
          // booked_price_cents when set (quote_only or post-LM), falls back otherwise.
          let groupServices = null;
          const allLinkedIds = [bk.id, ...sibIds];
          if (allLinkedIds.length > 1) {
            const grp = await query(
              `SELECT CASE WHEN sv.name IS NOT NULL THEN COALESCE(s.category || ' - ', '') || s.name || ' \u2014 ' || sv.name ELSE COALESCE(s.category || ' - ', '') || s.name END AS name,
                      COALESCE(sv.duration_min, s.duration_min) AS duration_min,
                      COALESCE(sv.price_cents, s.price_cents) AS price_cents, b.end_at,
                      b.practitioner_id, p.display_name AS practitioner_name, b.discount_pct
               FROM bookings b LEFT JOIN services s ON s.id = b.service_id
               LEFT JOIN service_variants sv ON sv.id = b.service_variant_id
               LEFT JOIN practitioners p ON p.id = b.practitioner_id
               WHERE b.id = ANY($1) AND b.business_id = $2
               ORDER BY b.start_at`,
              [allLinkedIds, bk.business_id]
            );
            if (grp.rows.length > 1) {
              const _pIds = new Set(grp.rows.map(r => r.practitioner_id));
              if (_pIds.size <= 1) grp.rows.forEach(r => { r.practitioner_name = null; });
              grp.rows.forEach(r => { if (r.discount_pct && r.price_cents) { r.original_price_cents = r.price_cents; r.price_cents = Math.round(r.price_cents * (100 - r.discount_pct) / 100); } });
              groupServices = grp.rows;
              d.end_at = grp.rows[grp.rows.length - 1].end_at;
            }
          } else if (d.group_id) {
            const grp = await query(
              `SELECT CASE WHEN sv.name IS NOT NULL THEN COALESCE(s.category || ' - ', '') || s.name || ' \u2014 ' || sv.name ELSE COALESCE(s.category || ' - ', '') || s.name END AS name,
                      COALESCE(sv.duration_min, s.duration_min) AS duration_min,
                      COALESCE(sv.price_cents, s.price_cents) AS price_cents, b.end_at,
                      b.practitioner_id, p.display_name AS practitioner_name, b.discount_pct
               FROM bookings b LEFT JOIN services s ON s.id = b.service_id
               LEFT JOIN service_variants sv ON sv.id = b.service_variant_id
               LEFT JOIN practitioners p ON p.id = b.practitioner_id
               WHERE b.group_id = $1 AND b.business_id = $2
               ORDER BY b.group_order, b.start_at`,
              [d.group_id, bk.business_id]
            );
            if (grp.rows.length > 1) {
              const _pIds = new Set(grp.rows.map(r => r.practitioner_id));
              if (_pIds.size <= 1) grp.rows.forEach(r => { r.practitioner_name = null; });
              grp.rows.forEach(r => { if (r.discount_pct && r.price_cents) { r.original_price_cents = r.price_cents; r.price_cents = Math.round(r.price_cents * (100 - r.discount_pct) / 100); } });
              groupServices = grp.rows;
              d.end_at = grp.rows[grp.rows.length - 1].end_at;
            }
          }
          const { getGcPaidCents } = require('../../services/gift-card-refund');
          const gcPaid = await getGcPaidCents(bk.id);
          d.gc_paid_cents = gcPaid;
          const { sendDepositPaidEmail, sendDepositPaidProEmail } = require('../../services/email');
          sendDepositPaidEmail({
            booking: d,
            business: { name: d.business_name, email: d.business_email, phone: d.business_phone, address: d.business_address, theme: d.theme, slug: d.slug, settings: d.business_settings },
            groupServices
          }).catch(e => console.warn('[DEPOSIT VERIFY] Email error:', e.message));
          sendDepositPaidProEmail({
            booking: d,
            business: { name: d.business_name, email: d.business_email, theme: d.theme }
          }).catch(e => console.warn('[DEPOSIT VERIFY] Pro email error:', e.message));
        }
      } catch (emailErr) {
        console.warn('[DEPOSIT VERIFY] Email fetch error:', emailErr.message);
      }
    }

    res.json({ status: 'paid', updated: true });
  } catch (err) {
    console.error('[DEPOSIT VERIFY] Error:', err.message);
    // Don't fail the page — just return pending
    res.json({ status: 'pending', updated: false, reason: 'verify_error' });
  }
});

module.exports = router;
