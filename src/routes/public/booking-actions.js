/**
 * Booking Actions — cancel, confirm, reject (client-facing).
 * Extracted from index.js (Phase 4c refactoring).
 */
const router = require('express').Router();
const { query, pool } = require('../../services/db');
const { broadcast } = require('../../services/sse');
const { stripeRefundDeposit, escHtml } = require('./helpers');
const { processWaitlistForCancellation } = require('../../services/waitlist');
const { sendBookingConfirmation } = require('../../services/email');

// ============================================================
// POST /api/public/booking/:token/cancel
// Client self-cancel
// ============================================================
router.post('/booking/:token/cancel', async (req, res, next) => {
  try {
    const { token } = req.params;
    const { reason } = req.body;

    // M3: typeof check + Bug B2 fix: length limit on cancel reason
    if (reason !== undefined && typeof reason !== 'string') return res.status(400).json({ error: 'Raison invalide' });
    if (reason && reason.length > 2000) return res.status(400).json({ error: 'Raison trop longue (max 2000)' });

    const result = await query(
      `SELECT b.id, b.status, b.start_at, b.created_at, b.business_id,
              b.deposit_required, b.deposit_status, b.group_id,
              biz.settings AS business_settings
       FROM bookings b
       JOIN businesses biz ON biz.id = b.business_id
       WHERE b.public_token = $1`,
      [token]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Rendez-vous introuvable' });

    const bk = result.rows[0];
    if (!['pending', 'confirmed', 'pending_deposit', 'modified_pending'].includes(bk.status)) {
      return res.status(400).json({ error: 'Ce rendez-vous ne peut plus être annulé' });
    }

    // Cancel deadline (declared at function scope for both deadline check and deposit refund SQL)
    const cancelWindowHours = bk.business_settings?.cancel_deadline_hours ?? bk.business_settings?.cancellation_window_hours ?? 24;

    // Skip cancellation deadline for pending_deposit — client hasn't paid yet,
    // they should always be able to cancel (otherwise deposit-expiry cron would cancel it anyway)
    if (bk.status !== 'pending_deposit') {
      const deadline = new Date(new Date(bk.start_at).getTime() - cancelWindowHours * 3600000);
      if (new Date() >= deadline) {
        return res.status(400).json({ error: `Annulation possible jusqu'à ${cancelWindowHours}h avant le rendez-vous` });
      }
    }

    // Deposit refund logic — atomic CASE WHEN to avoid race condition
    // between SELECT and UPDATE (a payment webhook could change deposit_status in between)
    const graceMin = bk.business_settings?.cancel_grace_minutes ?? 240;

    // Atomic: primary cancel + sibling propagation in one transaction
    const txClient = await pool.connect();
    let cancelResult;
    try {
      await txClient.query('BEGIN');
      cancelResult = await txClient.query(
        `UPDATE bookings SET status = 'cancelled', cancel_reason = $1,
          deposit_status = CASE
            WHEN deposit_required = true AND deposit_status = 'paid' THEN
              CASE WHEN (start_at - INTERVAL '1 minute' * $3) > NOW()
                     OR (NOW() - created_at) <= INTERVAL '1 minute' * $4
                   THEN 'refunded' ELSE 'cancelled' END
            WHEN deposit_required = true AND deposit_status = 'pending' THEN 'cancelled'
            ELSE deposit_status
          END,
          updated_at = NOW()
         WHERE id = $2 AND status IN ('pending', 'confirmed', 'pending_deposit')
         RETURNING *`,
        [reason || 'Annulé par le client', bk.id, cancelWindowHours * 60, graceMin]
      );

      if (cancelResult.rowCount === 0) {
        await txClient.query('ROLLBACK');
        return res.status(409).json({ error: 'Ce rendez-vous a déjà été modifié ou annulé' });
      }

      // Propagate cancellation to group siblings (multi-service bookings)
      if (bk.group_id) {
        await txClient.query(
          `UPDATE bookings SET status = 'cancelled', cancel_reason = $1,
            deposit_status = CASE
              WHEN deposit_required = true AND deposit_status = 'paid' THEN 'refunded'
              WHEN deposit_required = true AND deposit_status = 'pending' THEN 'cancelled'
              ELSE deposit_status
            END,
            updated_at = NOW()
           WHERE group_id = $2 AND business_id = $3 AND id != $4
             AND status IN ('confirmed', 'pending_deposit', 'pending', 'modified_pending')`,
          [reason || 'Annulé par le client', bk.group_id, bk.business_id, bk.id]
        );
      }
      await txClient.query('COMMIT');
    } catch (txErr) {
      await txClient.query('ROLLBACK').catch(() => {});
      throw txErr;
    } finally {
      txClient.release();
    }

    // Refund gift card debits + Stripe refund if deposit was refunded
    const postCancelBk = cancelResult.rows[0];
    try { const { refundGiftCardForBooking } = require('../../services/gift-card-refund'); await refundGiftCardForBooking(postCancelBk.id); } catch (e) { console.error('[GC REFUND] cancel error:', e.message); }
    if (postCancelBk.deposit_status === 'refunded' && postCancelBk.deposit_payment_intent_id) {
      await stripeRefundDeposit(postCancelBk.deposit_payment_intent_id, 'POST CANCEL');
    }
    // Refund GC debits for group siblings
    if (bk.group_id) {
      try {
        const sibs = await query(`SELECT id FROM bookings WHERE group_id = $1 AND business_id = $2 AND id != $3`, [bk.group_id, bk.business_id, bk.id]);
        const { refundGiftCardForBooking } = require('../../services/gift-card-refund');
        for (const sib of sibs.rows) { await refundGiftCardForBooking(sib.id); }
      } catch (e) { console.error('[GC REFUND] sibling cancel error:', e.message); }
    }

    // Log client cancellation in audit_logs (shows in staff modal "Historique" tab)
    try {
      await query(
        `INSERT INTO audit_logs (business_id, entity_type, entity_id, action, old_data, new_data)
         VALUES ($1, 'booking', $2, 'client_cancel', $3, $4)`,
        [bk.business_id, bk.id,
         JSON.stringify({ status: bk.status }),
         JSON.stringify({ status: 'cancelled', cancel_reason: reason || null })]
      );
    } catch (e) { /* non-critical */ }

    // Increment client cancel_count + auto-block if abuse threshold reached
    if (bk.client_id) {
      try {
        const updC = await query(
          `UPDATE clients SET cancel_count = COALESCE(cancel_count, 0) + 1, updated_at = NOW()
           WHERE id = $1 AND business_id = $2 RETURNING cancel_count`,
          [bk.client_id, bk.business_id]
        );
        const cancelCount = updC.rows[0]?.cancel_count || 0;
        const bizS = await query(`SELECT settings FROM businesses WHERE id = $1`, [bk.business_id]);
        const sett = bizS.rows[0]?.settings || {};
        if (sett.cancel_abuse_enabled && cancelCount >= (sett.cancel_abuse_max || 5)) {
          await query(
            `UPDATE clients SET is_blocked = true, blocked_at = NOW(), blocked_reason = $3, updated_at = NOW()
             WHERE id = $1 AND business_id = $2 AND is_blocked = false`,
            [bk.client_id, bk.business_id, `Bloqué automatiquement : ${cancelCount} annulation(s) consécutive(s)`]
          );
          console.log(`[CANCEL ABUSE] Client ${bk.client_id} blocked after ${cancelCount} cancellations`);
        }
      } catch (e) { console.error('[CANCEL COUNT] Error:', e.message); }
    }

    // Queue cancellation notification
    // NOTE: notification types may need a DB migration to add to the CHECK constraint
    try {
      await query(
        `INSERT INTO notifications (business_id, booking_id, type, status)
         VALUES ($1, $2, 'email_cancellation_pro', 'queued')`,
        [bk.business_id, bk.id]
      );
    } catch (notifErr) {
      console.error('Notification insert failed (CHECK constraint?):', notifErr.message);
    }

    // Send cancellation confirmation email to client (non-blocking)
    (async () => {
      try {
        const fullBk = await query(
          `SELECT b.*, CASE WHEN sv.name IS NOT NULL THEN s.name || ' — ' || sv.name ELSE s.name END AS service_name,
                  s.category AS service_category,
                  p.display_name AS practitioner_name,
                  c.full_name AS client_name, c.email AS client_email,
                  biz.name AS biz_name, biz.email AS biz_email, biz.address AS biz_address,
                  biz.theme AS biz_theme, biz.slug AS biz_slug
           FROM bookings b
           LEFT JOIN services s ON s.id = b.service_id
           LEFT JOIN service_variants sv ON sv.id = b.service_variant_id
           LEFT JOIN practitioners p ON p.id = b.practitioner_id
           LEFT JOIN clients c ON c.id = b.client_id
           JOIN businesses biz ON biz.id = b.business_id
           WHERE b.id = $1`, [bk.id]
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
          const gcPaidCancel = await getGcPaidCents(bk.id);
          const { sendCancellationEmail } = require('../../services/email');
          await sendCancellationEmail({
            booking: { start_at: row.start_at, end_at: groupEndAt || row.end_at, client_name: row.client_name, client_email: row.client_email, service_name: row.service_name, practitioner_name: row.practitioner_name, deposit_required: row.deposit_required, deposit_status: row.deposit_status, deposit_amount_cents: row.deposit_amount_cents, deposit_paid_at: row.deposit_paid_at, deposit_payment_intent_id: row.deposit_payment_intent_id, gc_paid_cents: gcPaidCancel, promotion_label: row.promotion_label, promotion_discount_cents: row.promotion_discount_cents, promotion_discount_pct: row.promotion_discount_pct },
            business: { name: row.biz_name, email: row.biz_email, address: row.biz_address, theme: row.biz_theme, slug: row.biz_slug, settings: bk.business_settings },
            groupServices
          });
        }
      } catch (e) { console.warn('[EMAIL] Cancellation email error:', e.message); }
    })();

    // Trigger waitlist processing
    let waitlistResult = null;
    try {
      waitlistResult = await processWaitlistForCancellation(bk.id, bk.business_id);
    } catch (e) { /* non-blocking */ }

    // calSyncDelete for primary booking + group siblings
    try { const { calSyncDelete } = require('../staff/bookings-helpers'); calSyncDelete(bk.business_id, bk.id); } catch (e) { /* non-blocking */ }
    if (bk.group_id) {
      try {
        const sibs = await query(`SELECT id FROM bookings WHERE group_id = $1 AND business_id = $2 AND id != $3`, [bk.group_id, bk.business_id, bk.id]);
        for (const sib of sibs.rows) {
          try { const { calSyncDelete } = require('../staff/bookings-helpers'); calSyncDelete(bk.business_id, sib.id); } catch (e) { /* non-blocking */ }
          try { await processWaitlistForCancellation(sib.id, bk.business_id); } catch (e) { /* non-blocking */ }
        }
      } catch (e) { /* non-blocking */ }
    }

    broadcast(bk.business_id, 'booking_update', { action: 'cancelled', source: 'public' });
    res.json({ cancelled: true, waitlist: waitlistResult });
  } catch (err) { next(err); }
});

// ============================================================
// POST /api/public/booking/:token/confirm
// Client confirms a modified booking (modified_pending → confirmed)
// UI: /booking/:token page → "Ça me convient" button
// ============================================================
router.post('/booking/:token/confirm', async (req, res, next) => {
  try {
    const { token } = req.params;
    const isForm = req.is('application/x-www-form-urlencoded');

    // For HTML responses, we need display data
    let displayData = null;
    if (isForm) {
      const info = await query(
        `SELECT b.id, b.status, b.start_at, b.group_id, b.business_id,
                CASE WHEN sv.name IS NOT NULL THEN s.name || ' — ' || sv.name ELSE s.name END AS service_name,
                  s.category AS service_category,
                biz.name AS business_name, biz.theme
         FROM bookings b LEFT JOIN services s ON s.id = b.service_id
         LEFT JOIN service_variants sv ON sv.id = b.service_variant_id
         JOIN businesses biz ON biz.id = b.business_id
         WHERE b.public_token = $1`, [token]
      );
      if (info.rows.length === 0) return res.status(404).send(confirmationPage('Rendez-vous introuvable', 'Ce lien n\'est plus valide.', '#C62828'));
      displayData = info.rows[0];
      const color = displayData.theme?.primary_color || '#0D7377';
      const dt = new Date(displayData.start_at).toLocaleDateString('fr-BE', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Europe/Brussels' });
      const tm = new Date(displayData.start_at).toLocaleTimeString('fr-BE', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Brussels' });
      displayData._color = color;
      displayData._dt = dt;
      displayData._tm = tm;

      // Fetch all group services for multi-service bookings
      if (displayData.group_id) {
        const grp = await query(
          `SELECT CASE WHEN sv.name IS NOT NULL THEN COALESCE(s.category || ' - ', '') || s.name || ' — ' || sv.name ELSE COALESCE(s.category || ' - ', '') || s.name END AS name
           FROM bookings b LEFT JOIN services s ON s.id = b.service_id
           LEFT JOIN service_variants sv ON sv.id = b.service_variant_id
           WHERE b.group_id = $1 AND b.business_id = $2 ORDER BY b.group_order, b.start_at`,
          [displayData.group_id, displayData.business_id]
        );
        if (grp.rows.length > 1) {
          displayData.service_name = grp.rows.map(r => r.name).join(', ');
        }
      }

      if (displayData.status === 'confirmed') {
        return res.send(confirmationPage('Déjà confirmé ✅', `Votre rendez-vous du <strong>${dt} à ${tm}</strong> est confirmé.`, color, displayData.business_name));
      }
      if (displayData.status !== 'modified_pending') {
        return res.send(confirmationPage('Action impossible', 'Ce rendez-vous ne peut plus être confirmé.', '#A68B3C', displayData.business_name));
      }
    }

    // Atomic: primary confirm + sibling propagation in one transaction
    const txClient = await pool.connect();
    let result, sibResult = { rows: [] };
    try {
      await txClient.query('BEGIN');
      result = await txClient.query(
        `UPDATE bookings SET status = 'confirmed', locked = true, updated_at = NOW()
         WHERE public_token = $1 AND status = 'modified_pending'
         RETURNING id, status, start_at, end_at, business_id`,
        [token]
      );

      if (result.rows.length === 0) {
        await txClient.query('ROLLBACK');
        const check = await query(
          `SELECT status FROM bookings WHERE public_token = $1`, [token]
        );
        if (check.rows.length === 0) {
          if (isForm) return res.status(404).send(confirmationPage('Rendez-vous introuvable', 'Ce lien n\'est plus valide.', '#C62828'));
          return res.status(404).json({ error: 'Rendez-vous introuvable' });
        }
        if (check.rows[0].status === 'confirmed') {
          if (isForm) return res.send(confirmationPage('Déjà confirmé ✅', `Votre rendez-vous est confirmé.`, displayData?._color || '#0D7377', displayData?.business_name));
          return res.json({ confirmed: true, already: true });
        }
        if (isForm) return res.send(confirmationPage('Action impossible', 'Ce rendez-vous ne peut plus être confirmé.', '#A68B3C', displayData?.business_name));
        return res.status(400).json({ error: 'Ce rendez-vous ne peut pas être confirmé dans son état actuel' });
      }

      // Propagate to group siblings (multi-service bookings)
      const confirmedBk = result.rows[0];
      const grpCheck = await txClient.query(`SELECT group_id FROM bookings WHERE id = $1 AND group_id IS NOT NULL`, [confirmedBk.id]);
      if (grpCheck.rows.length > 0) {
        sibResult = await txClient.query(
          `UPDATE bookings SET status = 'confirmed', locked = true, updated_at = NOW()
           WHERE group_id = $1 AND business_id = $2 AND id != $3 AND status = 'modified_pending'
           RETURNING id`,
          [grpCheck.rows[0].group_id, confirmedBk.business_id, confirmedBk.id]
        );
      }
      await txClient.query('COMMIT');
    } catch (txErr) {
      await txClient.query('ROLLBACK').catch(() => {});
      throw txErr;
    } finally {
      txClient.release();
    }

    const confirmedBk = result.rows[0];
    // calSyncPush for siblings
    for (const sib of sibResult.rows) {
      try { const { calSyncPush } = require('../staff/bookings-helpers'); calSyncPush(confirmedBk.business_id, sib.id); } catch (_) {}
    }

    // Queue notification to practitioner
    // NOTE: notification types may need a DB migration to add to the CHECK constraint
    try {
      await query(
        `INSERT INTO notifications (business_id, booking_id, type, status)
         VALUES ($1, $2, 'email_modification_confirmed', 'queued')`,
        [confirmedBk.business_id, confirmedBk.id]
      );
    } catch (notifErr) {
      console.error('Notification insert failed (CHECK constraint?):', notifErr.message);
    }

    broadcast(confirmedBk.business_id, 'booking_update', { action: 'confirmed', source: 'public' });
    // calSyncPush on modified_pending → confirmed
    try { const { calSyncPush } = require('../staff/bookings-helpers'); calSyncPush(confirmedBk.business_id, confirmedBk.id); } catch (_) {}

    if (isForm && displayData) {
      return res.send(confirmationPage('Rendez-vous confirmé ✅', `${escHtml(displayData.service_name) || 'Votre rendez-vous'} le <strong>${escHtml(displayData._dt)} à ${escHtml(displayData._tm)}</strong> est confirmé. Merci !`, displayData._color, displayData.business_name));
    }
    const { business_id: _bid, ...publicBooking } = result.rows[0];
    res.json({ confirmed: true, booking: publicBooking });
  } catch (err) { next(err); }
});

// ============================================================
// POST /api/public/booking/:token/reject
// Client rejects a modified booking (modified_pending → cancelled)
// UI: email button → "Non" → landing page
// ============================================================
router.post('/booking/:token/reject', async (req, res, next) => {
  try {
    const { token } = req.params;
    const isForm = req.is('application/x-www-form-urlencoded');

    // For HTML responses, we need display data
    let displayData = null;
    if (isForm) {
      const info = await query(
        `SELECT b.status, b.start_at, biz.name AS business_name, biz.theme, biz.phone AS business_phone
         FROM bookings b JOIN businesses biz ON biz.id = b.business_id
         WHERE b.public_token = $1`, [token]
      );
      if (info.rows.length === 0) return res.status(404).send(confirmationPage('Rendez-vous introuvable', 'Ce lien n\'est plus valide.', '#C62828'));
      displayData = info.rows[0];
      const color = displayData.theme?.primary_color || '#0D7377';
      displayData._color = color;

      if (displayData.status === 'cancelled') {
        return res.send(confirmationPage('Déjà annulé', 'Ce rendez-vous a été annulé.', '#C62828', displayData.business_name));
      }
      if (displayData.status !== 'modified_pending') {
        return res.send(confirmationPage('Action impossible', 'Ce rendez-vous ne peut plus être modifié.', '#A68B3C', displayData.business_name));
      }
    }

    // Deadline check: prevent rejection bypass of cancellation deadline
    const bkCheck = await query(
      `SELECT b.id, b.status, b.start_at, biz.settings AS business_settings
       FROM bookings b JOIN businesses biz ON biz.id = b.business_id
       WHERE b.public_token = $1`, [token]
    );
    if (bkCheck.rows.length === 0) {
      if (isForm) return res.status(404).send(confirmationPage('Rendez-vous introuvable', 'Ce lien n\'est plus valide.', '#C62828'));
      return res.status(404).json({ error: 'Rendez-vous introuvable' });
    }
    const bkData = bkCheck.rows[0];
    const cancelWindowHours = bkData.business_settings?.cancel_deadline_hours ?? bkData.business_settings?.cancellation_window_hours ?? 24;
    const deadline = new Date(new Date(bkData.start_at).getTime() - cancelWindowHours * 3600000);
    if (new Date() >= deadline) {
      if (isForm) return res.status(400).send(confirmationPage('Délai dépassé', 'Le délai de modification est dépassé.', '#C62828', displayData?.business_name));
      return res.status(400).json({ error: 'Délai de modification dépassé' });
    }

    // Atomic: primary reject + sibling cancellation in one transaction
    const txClient = await pool.connect();
    let result;
    try {
      await txClient.query('BEGIN');
      result = await txClient.query(
        `UPDATE bookings SET status = 'cancelled', cancel_reason = 'client_rejected_modification',
          deposit_status = CASE
            WHEN deposit_required = true AND deposit_status = 'paid' THEN 'refunded'
            WHEN deposit_required = true AND deposit_status = 'pending' THEN 'cancelled'
            ELSE deposit_status
          END,
          updated_at = NOW()
         WHERE public_token = $1 AND status = 'modified_pending'
         RETURNING id, status, start_at, end_at, business_id, group_id,
                   deposit_required, deposit_status, deposit_payment_intent_id`,
        [token]
      );

      if (result.rows.length === 0) {
        await txClient.query('ROLLBACK');
        const check = await query(
          `SELECT status FROM bookings WHERE public_token = $1`, [token]
        );
        if (check.rows.length === 0) {
          if (isForm) return res.status(404).send(confirmationPage('Rendez-vous introuvable', 'Ce lien n\'est plus valide.', '#C62828'));
          return res.status(404).json({ error: 'Rendez-vous introuvable' });
        }
        if (check.rows[0].status === 'cancelled') {
          if (isForm) return res.send(confirmationPage('Déjà annulé', 'Ce rendez-vous a été annulé.', '#C62828', displayData?.business_name));
          return res.json({ rejected: true, already: true });
        }
        if (isForm) return res.send(confirmationPage('Action impossible', 'Ce rendez-vous ne peut plus être modifié.', '#A68B3C', displayData?.business_name));
        return res.status(400).json({ error: 'Ce rendez-vous ne peut pas être refusé dans son état actuel' });
      }

      const rejBk = result.rows[0];

      // Cancel group siblings if multi-service booking
      if (rejBk.group_id) {
        await txClient.query(
          `UPDATE bookings SET status = 'cancelled', cancel_reason = 'client_rejected_modification',
            deposit_status = CASE
              WHEN deposit_required = true AND deposit_status = 'paid' THEN 'refunded'
              WHEN deposit_required = true AND deposit_status = 'pending' THEN 'cancelled'
              ELSE deposit_status
            END,
            updated_at = NOW()
           WHERE group_id = $1 AND business_id = $2 AND id != $3
             AND status IN ('confirmed', 'pending_deposit', 'pending', 'modified_pending')`,
          [rejBk.group_id, rejBk.business_id, rejBk.id]
        );
      }
      await txClient.query('COMMIT');
    } catch (txErr) {
      await txClient.query('ROLLBACK').catch(() => {});
      throw txErr;
    } finally {
      txClient.release();
    }

    // Refund gift card debits + Stripe refund AFTER transaction commits
    const rejBk = result.rows[0];
    try { const { refundGiftCardForBooking } = require('../../services/gift-card-refund'); await refundGiftCardForBooking(rejBk.id); } catch (e) { console.error('[GC REFUND] reject error:', e.message); }
    if (rejBk.deposit_status === 'refunded' && rejBk.deposit_payment_intent_id) {
      await stripeRefundDeposit(rejBk.deposit_payment_intent_id, 'REJECT');
    }
    // Refund GC debits for group siblings
    if (rejBk.group_id) {
      try {
        const sibs = await query(`SELECT id FROM bookings WHERE group_id = $1 AND business_id = $2 AND id != $3`, [rejBk.group_id, rejBk.business_id, rejBk.id]);
        const { refundGiftCardForBooking } = require('../../services/gift-card-refund');
        for (const sib of sibs.rows) { await refundGiftCardForBooking(sib.id); }
      } catch (e) { console.error('[GC REFUND] sibling reject error:', e.message); }
    }

    // Notify practitioner
    // NOTE: notification types may need a DB migration to add to the CHECK constraint
    try {
      await query(
        `INSERT INTO notifications (business_id, booking_id, type, status)
         VALUES ($1, $2, 'email_modification_rejected', 'queued')`,
        [rejBk.business_id, rejBk.id]
      );
    } catch (notifErr) {
      console.error('Notification insert failed (CHECK constraint?):', notifErr.message);
    }

    broadcast(rejBk.business_id, 'booking_update', { action: 'rejected', source: 'public' });

    // Send cancellation confirmation email to client (non-blocking)
    (async () => {
      try {
        const fullBk = await query(
          `SELECT b.*, CASE WHEN sv.name IS NOT NULL THEN s.name || ' — ' || sv.name ELSE s.name END AS service_name,
                  s.category AS service_category,
                  p.display_name AS practitioner_name,
                  c.full_name AS client_name, c.email AS client_email,
                  biz.name AS biz_name, biz.email AS biz_email, biz.address AS biz_address,
                  biz.theme AS biz_theme, biz.slug AS biz_slug, biz.settings AS biz_settings
           FROM bookings b
           LEFT JOIN clients c ON c.id = b.client_id
           LEFT JOIN services s ON s.id = b.service_id
           LEFT JOIN service_variants sv ON sv.id = b.service_variant_id
           LEFT JOIN practitioners p ON p.id = b.practitioner_id
           JOIN businesses biz ON biz.id = b.business_id
           WHERE b.id = $1`, [rejBk.id]
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
          const { sendCancellationEmail } = require('../../services/email');
          const { getGcPaidCents } = require('../../services/gift-card-refund');
          const gcPaidReject = await getGcPaidCents(rejBk.id);
          await sendCancellationEmail({
            booking: { start_at: row.start_at, end_at: groupEndAt || row.end_at, client_name: row.client_name, client_email: row.client_email, service_name: row.service_name, practitioner_name: row.practitioner_name, deposit_required: row.deposit_required, deposit_status: row.deposit_status, deposit_amount_cents: row.deposit_amount_cents, deposit_paid_at: row.deposit_paid_at, deposit_payment_intent_id: row.deposit_payment_intent_id, gc_paid_cents: gcPaidReject, promotion_label: row.promotion_label, promotion_discount_cents: row.promotion_discount_cents, promotion_discount_pct: row.promotion_discount_pct },
            business: { name: row.biz_name, email: row.biz_email, address: row.biz_address, theme: row.biz_theme, slug: row.biz_slug, settings: row.biz_settings },
            groupServices
          });
        }
      } catch (e) { console.warn('[EMAIL] Rejection cancellation email error:', e.message); }
      // M1: calSyncDelete + waitlist on reject
      try { const { calSyncDelete } = require('../staff/bookings-helpers'); calSyncDelete(rejBk.business_id, rejBk.id); } catch (_) {}
      try { await processWaitlistForCancellation(rejBk.id, rejBk.business_id); } catch (_) {}
    })();

    if (isForm && displayData) {
      const phone = displayData.business_phone ? ` au <strong>${escHtml(displayData.business_phone)}</strong>` : '';
      return res.send(confirmationPage('Rendez-vous refusé', `Le nouveau créneau ne vous convient pas. N'hésitez pas à nous contacter${phone} pour trouver un autre horaire.`, '#C62828', displayData.business_name));
    }
    const { business_id: _bid2, ...publicBookingReject } = result.rows[0];
    res.json({ rejected: true, booking: publicBookingReject });
  } catch (err) { next(err); }
});

// ============================================================
// GET /api/public/booking/:token/confirm — landing page (READ-ONLY)
// Shows confirmation button, POST does the mutation
// ============================================================
router.get('/booking/:token/confirm', async (req, res, next) => {
  try {
    const { token } = req.params;
    const result = await query(
      `SELECT b.status, b.start_at, b.end_at,
              CASE WHEN sv.name IS NOT NULL THEN s.name || ' — ' || sv.name ELSE s.name END AS service_name,
                  s.category AS service_category,
              biz.name AS business_name, biz.theme
       FROM bookings b
       LEFT JOIN services s ON s.id = b.service_id
       LEFT JOIN service_variants sv ON sv.id = b.service_variant_id
       JOIN businesses biz ON biz.id = b.business_id
       WHERE b.public_token = $1`, [token]
    );
    if (result.rows.length === 0) return res.status(404).send(confirmationPage('Rendez-vous introuvable', 'Ce lien n\'est plus valide.', '#C62828'));

    const bk = result.rows[0];
    const color = bk.theme?.primary_color || '#0D7377';
    const dt = new Date(bk.start_at).toLocaleDateString('fr-BE', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Europe/Brussels' });
    const tm = new Date(bk.start_at).toLocaleTimeString('fr-BE', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Brussels' });

    if (bk.status === 'confirmed') {
      return res.send(confirmationPage('Déjà confirmé ✅', `Votre rendez-vous du <strong>${dt} à ${tm}</strong> est confirmé.`, color, bk.business_name));
    }
    if (bk.status !== 'modified_pending') {
      return res.send(confirmationPage('Action impossible', 'Ce rendez-vous ne peut plus être confirmé.', '#A68B3C', bk.business_name));
    }

    // Show confirmation landing page with a form button (no mutation on GET)
    res.send(actionPage('Confirmer le rendez-vous', `<strong>${escHtml(bk.service_name || 'Votre rendez-vous')}</strong> le <strong>${dt} à ${tm}</strong>`, color, bk.business_name, token, 'confirm', 'Confirmer ✅', true));
  } catch (err) { next(err); }
});

// ============================================================
// GET /api/public/booking/:token/reject — landing page (READ-ONLY)
// Shows reject button, POST does the mutation
// ============================================================
router.get('/booking/:token/reject', async (req, res, next) => {
  try {
    const { token } = req.params;
    const result = await query(
      `SELECT b.status, b.start_at, biz.name AS business_name, biz.theme, biz.phone AS business_phone
       FROM bookings b
       JOIN businesses biz ON biz.id = b.business_id
       WHERE b.public_token = $1`, [token]
    );
    if (result.rows.length === 0) return res.status(404).send(confirmationPage('Rendez-vous introuvable', 'Ce lien n\'est plus valide.', '#C62828'));

    const bk = result.rows[0];
    const color = bk.theme?.primary_color || '#0D7377';

    if (bk.status === 'cancelled') {
      return res.send(confirmationPage('Déjà annulé', 'Ce rendez-vous a été annulé.', '#C62828', bk.business_name));
    }
    if (bk.status !== 'modified_pending') {
      return res.send(confirmationPage('Action impossible', 'Ce rendez-vous ne peut plus être modifié.', '#A68B3C', bk.business_name));
    }

    // Show reject landing page with a form button (no mutation on GET)
    res.send(actionPage('Refuser le nouveau créneau ?', 'Si ce créneau ne vous convient pas, vous pouvez le refuser et contacter le cabinet pour un autre horaire.', '#C62828', bk.business_name, token, 'reject', 'Refuser le créneau'));
  } catch (err) { next(err); }
});

// Helper: build a standalone HTML confirmation/rejection page
function confirmationPage(title, message, color, businessName) {
  const escHtml = s => (s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
  const safeColor = /^#[0-9a-fA-F]{6}$/.test(color) ? color : '#0D7377';
  const safeTitle = escHtml(title);
  const safeBiz = escHtml(businessName);
  // Determine type: success / error / warning / info
  const rawTitle = (title || '').toLowerCase();
  const isSuccess = rawTitle.includes('confirm') && !rawTitle.includes('impossible');
  const isError = rawTitle.includes('annul') || rawTitle.includes('refus') || rawTitle.includes('introuvable') || rawTitle.includes('expir');
  const isWarning = rawTitle.includes('impossible') || rawTitle.includes('dépassé') || rawTitle.includes('déjà');
  const iconSvg = isSuccess
    ? `<svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="${safeColor}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>`
    : isError
    ? `<svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="${safeColor}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>`
    : isWarning
    ? `<svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="${safeColor}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`
    : `<svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="${safeColor}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>`;
  // Clean title — remove emojis
  const cleanTitle = (title || '').replace(/[\u2705\u274C\u2753\u2139\uFE0F]/g, '').trim();
  return `<!DOCTYPE html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escHtml(cleanTitle)} — ${safeBiz || 'Genda'}</title>
<link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@300;400;500;600;700&family=Instrument+Serif:ital@0;1&display=swap" rel="stylesheet">
<style>
*,*::before,*::after{margin:0;padding:0;box-sizing:border-box}
body{background:#FAFAF9;font-family:'Plus Jakarta Sans',-apple-system,sans-serif;-webkit-font-smoothing:antialiased;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:20px}
.card{background:#FFF;border-radius:16px;padding:48px 36px 40px;max-width:420px;width:100%;text-align:center;box-shadow:0 1px 3px rgba(0,0,0,.04),0 8px 32px rgba(0,0,0,.06)}
.icon-wrap{width:64px;height:64px;border-radius:50%;background:${safeColor}12;display:flex;align-items:center;justify-content:center;margin:0 auto 24px}
h1{font-family:'Instrument Serif',Georgia,serif;font-size:1.5rem;font-weight:400;color:#1A1816;margin:0 0 12px;line-height:1.3}
.msg{font-size:.88rem;color:#6B6560;line-height:1.7;margin:0}
.msg strong{color:#3D3832;font-weight:600}
.divider{width:40px;height:1px;background:#E0DDD8;margin:24px auto}
.biz{font-size:.72rem;color:#9C958E;letter-spacing:.3px}
@media(max-width:480px){.card{padding:40px 24px 32px;border-radius:12px}h1{font-size:1.35rem}}
</style></head><body>
<div class="card">
  <div class="icon-wrap">${iconSvg}</div>
  <h1>${escHtml(cleanTitle)}</h1>
  <p class="msg">${message}</p>
  ${businessName ? `<div class="divider"></div><p class="biz">${safeBiz}</p>` : ''}
</div></body></html>`;
}

// Helper: build a standalone HTML action page (form with POST button)
function actionPage(title, message, color, businessName, token, action, btnLabel, autoSubmit) {
  const escHtml = s => (s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
  const safeColor = /^#[0-9a-fA-F]{6}$/.test(color) ? color : '#0D7377';
  return `<!DOCTYPE html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escHtml(title)} — ${escHtml(businessName) || 'Genda'}</title>
<link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@300;400;500;600;700&family=Instrument+Serif:ital@0;1&display=swap" rel="stylesheet">
<style>
*,*::before,*::after{margin:0;padding:0;box-sizing:border-box}
body{background:#FAFAF9;font-family:'Plus Jakarta Sans',-apple-system,sans-serif;-webkit-font-smoothing:antialiased;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:20px}
.card{background:#FFF;border-radius:16px;padding:48px 36px 40px;max-width:420px;width:100%;text-align:center;box-shadow:0 1px 3px rgba(0,0,0,.04),0 8px 32px rgba(0,0,0,.06)}
.icon-wrap{width:64px;height:64px;border-radius:50%;background:${safeColor}12;display:flex;align-items:center;justify-content:center;margin:0 auto 24px}
h1{font-family:'Instrument Serif',Georgia,serif;font-size:1.5rem;font-weight:400;color:#1A1816;margin:0 0 12px;line-height:1.3}
.msg{font-size:.88rem;color:#6B6560;line-height:1.7;margin:0 0 28px}
.msg strong{color:#3D3832;font-weight:600}
.action-btn{display:inline-block;background:${safeColor};color:#fff;border:none;border-radius:10px;padding:14px 36px;font-size:.92rem;font-weight:600;cursor:pointer;font-family:inherit;letter-spacing:.2px;transition:opacity .15s}
.action-btn:hover{opacity:.9}
.divider{width:40px;height:1px;background:#E0DDD8;margin:24px auto}
.biz{font-size:.72rem;color:#9C958E;letter-spacing:.3px}
@media(max-width:480px){.card{padding:40px 24px 32px;border-radius:12px}h1{font-size:1.35rem}}
</style></head><body>
<div class="card">
  <div class="icon-wrap">
    <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="${safeColor}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>
  </div>
  <h1>${escHtml(title)}</h1>
  <p class="msg">${message}</p>
  <form method="POST" action="/api/public/booking/${escHtml(token)}/${escHtml(action)}" id="af">
    <button type="submit" class="action-btn">${escHtml(btnLabel)}</button>
  </form>
  ${autoSubmit ? '<script>document.getElementById("af").submit();</script>' : ''}
  ${businessName ? `<div class="divider"></div><p class="biz">${escHtml(businessName)}</p>` : ''}
</div></body></html>`;
}

// ============================================================
// BOOKING CONFIRMATION (pending → confirmed) — for booking_confirmation_required setting
// ============================================================

// GET /api/public/booking/:token/confirm-booking — one-click confirm from email
router.get('/booking/:token/confirm-booking', async (req, res, next) => {
  try {
    const { token } = req.params;

    // Attempt direct confirmation (pending → confirmed) — atomic with group siblings
    const client = await pool.connect();
    let result;
    try {
      await client.query('BEGIN');
      result = await client.query(
        `UPDATE bookings SET status = 'confirmed', confirmation_expires_at = NULL, locked = true, updated_at = NOW()
         WHERE public_token = $1 AND status = 'pending'
           AND (confirmation_expires_at IS NULL OR confirmation_expires_at > NOW())
         RETURNING id, status, business_id, public_token, start_at, end_at, client_id, service_id, practitioner_id`,
        [token]
      );
      if (result.rows.length > 0) {
        // Also confirm group siblings in same transaction
        await client.query(
          `UPDATE bookings SET status = 'confirmed', confirmation_expires_at = NULL, locked = true, updated_at = NOW()
           WHERE group_id = (SELECT group_id FROM bookings WHERE id = $1 AND group_id IS NOT NULL)
             AND id != $1 AND status = 'pending'`,
          [result.rows[0].id]
        );
      }
      await client.query('COMMIT');
    } catch (txErr) {
      await client.query('ROLLBACK').catch(() => {});
      throw txErr;
    } finally {
      client.release();
    }

    if (result.rows.length > 0) {
      const bk = result.rows[0];

      broadcast(bk.business_id, 'booking_update', { action: 'confirmed', source: 'public' });

      // Send confirmation email (non-blocking)
      (async () => {
        try {
          const fullBk = await query(
            `SELECT b.*, CASE WHEN sv.name IS NOT NULL THEN s.name || ' — ' || sv.name ELSE s.name END AS service_name,
                  s.category AS service_category,
                    p.display_name AS practitioner_name, c.full_name AS client_name, c.email AS client_email
             FROM bookings b LEFT JOIN services s ON s.id = b.service_id
             LEFT JOIN service_variants sv ON sv.id = b.service_variant_id
             JOIN practitioners p ON p.id = b.practitioner_id
             LEFT JOIN clients c ON c.id = b.client_id
             WHERE b.id = $1`, [bk.id]
          );
          const bizRow = await query(`SELECT name, email, address, phone, theme, settings FROM businesses WHERE id = $1`, [bk.business_id]);
          if (fullBk.rows[0] && bizRow.rows[0]) {
            let groupServices = null;
            if (fullBk.rows[0].group_id) {
              const grp = await query(
                `SELECT CASE WHEN sv.name IS NOT NULL THEN COALESCE(s.category || ' - ', '') || s.name || ' — ' || sv.name ELSE COALESCE(s.category || ' - ', '') || s.name END AS name,
                        COALESCE(sv.duration_min, s.duration_min) AS duration_min,
                        COALESCE(sv.price_cents, s.price_cents) AS price_cents, b.end_at,
                        b.practitioner_id, p.display_name AS practitioner_name
                 FROM bookings b LEFT JOIN services s ON s.id = b.service_id
                 LEFT JOIN service_variants sv ON sv.id = b.service_variant_id
                 LEFT JOIN practitioners p ON p.id = b.practitioner_id
                 WHERE b.group_id = $1 AND b.business_id = $2 ORDER BY b.group_order, b.start_at`,
                [fullBk.rows[0].group_id, bk.business_id]
              );
              if (grp.rows.length > 1) {
                const _pIds = new Set(grp.rows.map(r => r.practitioner_id));
                if (_pIds.size <= 1) grp.rows.forEach(r => { r.practitioner_name = null; });
                groupServices = grp.rows;
              }
            }
            const { sendBookingConfirmation } = require('../../services/email');
            await sendBookingConfirmation({ booking: fullBk.rows[0], business: bizRow.rows[0], groupServices });
          }
        } catch (e) { console.warn('[EMAIL] Post-confirmation email error:', e.message); }
      })();

      // Queue notification audit
      try {
        const clientRow = await query(`SELECT email FROM clients WHERE id = $1`, [bk.client_id]);
        await query(
          `INSERT INTO notifications (business_id, booking_id, type, recipient_email, status)
           VALUES ($1, $2, 'email_confirmation', $3, 'queued')`,
          [bk.business_id, bk.id, clientRow.rows[0]?.email]
        );
      } catch (_) { /* best-effort audit */ }

      const info = await query(
        `SELECT b.start_at, b.group_id, CASE WHEN sv.name IS NOT NULL THEN s.name || ' — ' || sv.name ELSE s.name END AS service_name,
                  s.category AS service_category,
                biz.name AS business_name, biz.theme
         FROM bookings b LEFT JOIN services s ON s.id = b.service_id
         LEFT JOIN service_variants sv ON sv.id = b.service_variant_id
         JOIN businesses biz ON biz.id = b.business_id WHERE b.id = $1`, [bk.id]
      );
      const i = info.rows[0] || {};
      const color = i.theme?.primary_color || '#0D7377';
      const dt = new Date(bk.start_at).toLocaleDateString('fr-BE', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Europe/Brussels' });
      const tm = new Date(bk.start_at).toLocaleTimeString('fr-BE', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Brussels' });

      // Fetch all group services for multi-service bookings
      let serviceLabel = escHtml(i.service_name || '');
      if (i.group_id) {
        const grp = await query(
          `SELECT CASE WHEN sv.name IS NOT NULL THEN COALESCE(s.category || ' - ', '') || s.name || ' — ' || sv.name ELSE COALESCE(s.category || ' - ', '') || s.name END AS name
           FROM bookings b LEFT JOIN services s ON s.id = b.service_id
           LEFT JOIN service_variants sv ON sv.id = b.service_variant_id
           WHERE b.group_id = $1 AND b.business_id = $2 ORDER BY b.group_order, b.start_at`,
          [i.group_id, bk.business_id]
        );
        if (grp.rows.length > 1) {
          serviceLabel = grp.rows.map(r => escHtml(r.name)).join(', ');
        }
      }

      return res.send(confirmationPage('Rendez-vous confirmé ✅', `Votre rendez-vous <strong>${serviceLabel}</strong> du <strong>${dt} à ${tm}</strong> est confirmé.`, color, i.business_name));
    }

    // Confirmation failed — check why
    const check = await query(
      `SELECT b.status, b.start_at, b.confirmation_expires_at,
              biz.name AS business_name, biz.theme
       FROM bookings b JOIN businesses biz ON biz.id = b.business_id
       WHERE b.public_token = $1`, [token]
    );
    if (check.rows.length === 0) return res.status(404).send(confirmationPage('Rendez-vous introuvable', 'Ce lien n\u2019est plus valide.', '#C62828'));

    const bk2 = check.rows[0];
    const color2 = bk2.theme?.primary_color || '#0D7377';

    if (bk2.status === 'confirmed' || bk2.status === 'completed') {
      const dt2 = new Date(bk2.start_at).toLocaleDateString('fr-BE', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Europe/Brussels' });
      const tm2 = new Date(bk2.start_at).toLocaleTimeString('fr-BE', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Brussels' });
      return res.send(confirmationPage('Déjà confirmé ✅', `Votre rendez-vous du <strong>${dt2} à ${tm2}</strong> est confirmé.`, color2, bk2.business_name));
    }
    if (bk2.status === 'cancelled') {
      return res.send(confirmationPage('Rendez-vous annulé', 'Ce rendez-vous a été annulé car le délai de confirmation a expiré.', '#C62828', bk2.business_name));
    }
    return res.send(confirmationPage('Action impossible', 'Ce rendez-vous ne peut plus être confirmé.', '#A68B3C', bk2.business_name));
  } catch (err) { next(err); }
});

// ============================================================
// GET /api/public/booking/:token/cancel-booking — intermediate confirmation page (safe from email preview)
// ============================================================
router.get('/booking/:token/cancel-booking', async (req, res, next) => {
  try {
    const { token } = req.params;

    const result = await query(
      `SELECT b.id, b.status, b.start_at, b.created_at, b.business_id, b.group_id,
              b.deposit_required, b.deposit_status, b.deposit_amount_cents,
              CASE WHEN sv.name IS NOT NULL THEN s.name || ' — ' || sv.name ELSE s.name END AS service_name,
                  s.category AS service_category,
              biz.name AS business_name, biz.theme, biz.settings AS business_settings
       FROM bookings b LEFT JOIN services s ON s.id = b.service_id
       LEFT JOIN service_variants sv ON sv.id = b.service_variant_id
       JOIN businesses biz ON biz.id = b.business_id
       WHERE b.public_token = $1`,
      [token]
    );

    if (result.rows.length === 0) {
      return res.status(404).send(confirmationPage('Rendez-vous introuvable', 'Ce lien n\u2019est plus valide.', '#C62828'));
    }

    const bk = result.rows[0];

    // Already cancelled
    if (bk.status === 'cancelled') {
      return res.send(confirmationPage('Déjà annulé', 'Ce rendez-vous a déjà été annulé.', '#C62828', bk.business_name));
    }

    // Completed or other non-cancellable status
    if (!['pending', 'confirmed', 'pending_deposit'].includes(bk.status)) {
      return res.send(confirmationPage('Action impossible', 'Ce rendez-vous ne peut plus être annulé.', '#A68B3C', bk.business_name));
    }

    // For confirmed: check cancellation deadline
    // Skip deadline check for pending_deposit — client hasn't paid yet, always allow cancel
    const cancelWindowHours = bk.business_settings?.cancel_deadline_hours ?? bk.business_settings?.cancellation_window_hours ?? 24;
    if (bk.status === 'confirmed') {
      const deadline = new Date(new Date(bk.start_at).getTime() - cancelWindowHours * 3600000);
      if (new Date() >= deadline) {
        return res.send(confirmationPage('Annulation impossible', `L'annulation n'est plus possible moins de ${cancelWindowHours}h avant le rendez-vous.`, '#C62828', bk.business_name));
      }
    }

    // Fetch group services if multi-service booking
    let serviceLabel = `<strong>${escHtml(bk.service_name || 'Rendez-vous')}</strong>`;
    if (bk.group_id) {
      const grp = await query(
        `SELECT CASE WHEN sv.name IS NOT NULL THEN s.name || ' — ' || sv.name ELSE s.name END AS service_name,
                s.category AS service_category
         FROM bookings b LEFT JOIN services s ON s.id = b.service_id
         LEFT JOIN service_variants sv ON sv.id = b.service_variant_id
         WHERE b.group_id = $1 AND b.business_id = $2 AND b.status IN ('pending','confirmed','pending_deposit','modified_pending')
         ORDER BY b.start_at`,
        [bk.group_id, bk.business_id]
      );
      if (grp.rows.length > 1) {
        serviceLabel = grp.rows.map(r => `<strong>${escHtml(r.service_name)}</strong>`).join('<br>');
      }
    }

    // Deposit refund message
    let depositMsg = '';
    if (bk.deposit_required && bk.deposit_status === 'paid' && bk.deposit_amount_cents) {
      const amt = (bk.deposit_amount_cents / 100).toFixed(2).replace('.', ',') + ' €';
      const graceMin = bk.business_settings?.cancel_grace_minutes ?? 240;
      const startMs = new Date(bk.start_at).getTime();
      const createdMs = new Date(bk.created_at).getTime();
      const nowMs = Date.now();
      const withinCancelWindow = (startMs - cancelWindowHours * 3600000) > nowMs;
      const withinGrace = (nowMs - createdMs) <= graceMin * 60000;
      if (withinCancelWindow || withinGrace) {
        depositMsg = `<br><br><span style="color:#2E7D32;font-size:13px">✓ Votre acompte de <strong>${amt}</strong> sera remboursé.</span>`;
      } else {
        depositMsg = `<br><br><span style="color:#C62828;font-size:13px">⚠ Votre acompte de <strong>${amt}</strong> ne sera pas remboursé (annulation tardive).</span>`;
      }
    } else if (bk.deposit_required && bk.deposit_status === 'pending') {
      depositMsg = `<br><br><span style="color:#6B6560;font-size:13px">L'acompte en attente sera annulé.</span>`;
    }

    // Show intermediate confirmation page with POST form
    const dt = new Date(bk.start_at).toLocaleDateString('fr-BE', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Europe/Brussels' });
    const tm = new Date(bk.start_at).toLocaleTimeString('fr-BE', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Brussels' });
    return res.send(actionPage(
      'Annuler votre rendez-vous ?',
      `${serviceLabel}<br>${dt} à ${tm}${depositMsg}`,
      '#C62828', bk.business_name, token, 'cancel-booking',
      'Confirmer l\u2019annulation'
    ));
  } catch (err) { next(err); }
});

// POST /api/public/booking/:token/cancel-booking — actual cancellation (POST = safe from email preview)
// ============================================================
router.post('/booking/:token/cancel-booking', async (req, res, next) => {
  try {
    const { token } = req.params;

    const result = await query(
      `SELECT b.id, b.status, b.start_at, b.created_at, b.business_id,
              b.deposit_required, b.deposit_status, b.deposit_payment_intent_id, b.group_id,
              biz.name AS business_name, biz.theme, biz.settings AS business_settings
       FROM bookings b JOIN businesses biz ON biz.id = b.business_id
       WHERE b.public_token = $1`,
      [token]
    );

    if (result.rows.length === 0) {
      return res.status(404).send(confirmationPage('Rendez-vous introuvable', 'Ce lien n\u2019est plus valide.', '#C62828'));
    }

    const bk = result.rows[0];

    if (bk.status === 'cancelled') {
      return res.send(confirmationPage('D\u00e9j\u00e0 annul\u00e9', 'Ce rendez-vous a d\u00e9j\u00e0 \u00e9t\u00e9 annul\u00e9.', '#C62828', bk.business_name));
    }
    if (!['pending', 'confirmed', 'pending_deposit'].includes(bk.status)) {
      return res.send(confirmationPage('Action impossible', 'Ce rendez-vous ne peut plus \u00eatre annul\u00e9.', '#A68B3C', bk.business_name));
    }

    const cancelWindowHours = bk.business_settings?.cancel_deadline_hours ?? bk.business_settings?.cancellation_window_hours ?? 24;
    if (bk.status === 'confirmed') {
      const deadline = new Date(new Date(bk.start_at).getTime() - cancelWindowHours * 3600000);
      if (new Date() >= deadline) {
        return res.send(confirmationPage('Annulation impossible', `L\u2019annulation n\u2019est plus possible moins de ${cancelWindowHours}h avant le rendez-vous.`, '#C62828', bk.business_name));
      }
    }

    // Atomic: primary cancel + sibling propagation in one transaction
    const graceMin = bk.business_settings?.cancel_grace_minutes ?? 240;
    const txClient2 = await pool.connect();
    let cancelResult;
    try {
      await txClient2.query('BEGIN');
      cancelResult = await txClient2.query(
      `UPDATE bookings SET status = 'cancelled', cancel_reason = 'Annul\u00e9 par le client (email)',
        deposit_status = CASE
          WHEN deposit_required = true AND deposit_status = 'paid' THEN
            CASE WHEN (start_at - INTERVAL '1 minute' * $2) > NOW()
                   OR (NOW() - created_at) <= INTERVAL '1 minute' * $3
                 THEN 'refunded' ELSE 'cancelled' END
          WHEN deposit_required = true AND deposit_status = 'pending' THEN 'cancelled'
          ELSE deposit_status
        END,
        updated_at = NOW()
       WHERE id = $1 AND status IN ('pending', 'confirmed', 'pending_deposit')
       RETURNING *`,
      [bk.id, cancelWindowHours * 60, graceMin]
    );

    if (cancelResult.rowCount === 0) {
      await txClient2.query('ROLLBACK');
      return res.send(confirmationPage('D\u00e9j\u00e0 modifi\u00e9', 'Ce rendez-vous a d\u00e9j\u00e0 \u00e9t\u00e9 modifi\u00e9 ou annul\u00e9.', '#A68B3C', bk.business_name));
    }

    // Cancel group siblings (inside same transaction)
    if (bk.group_id) {
        await txClient2.query(
          `UPDATE bookings SET status = 'cancelled', cancel_reason = 'Annul\u00e9 par le client (email)',
            deposit_status = CASE
              WHEN deposit_required = true AND deposit_status = 'paid' THEN 'refunded'
              WHEN deposit_required = true AND deposit_status = 'pending' THEN 'cancelled'
              ELSE deposit_status
            END,
            updated_at = NOW()
           WHERE group_id = $1 AND business_id = $2 AND id != $3
             AND status IN ('pending', 'confirmed', 'pending_deposit', 'modified_pending')`,
          [bk.group_id, bk.business_id, bk.id]
        );
    }
      await txClient2.query('COMMIT');
    } catch (txErr2) {
      await txClient2.query('ROLLBACK').catch(() => {});
      throw txErr2;
    } finally {
      txClient2.release();
    }

    // Refund gift card debits + Stripe refund AFTER transaction commits
    const cancelledBk = cancelResult.rows[0];
    try { const { refundGiftCardForBooking } = require('../../services/gift-card-refund'); await refundGiftCardForBooking(cancelledBk.id); } catch (e) { console.error('[GC REFUND] reschedule-cancel error:', e.message); }
    if (cancelledBk.deposit_status === 'refunded' && cancelledBk.deposit_payment_intent_id) {
      await stripeRefundDeposit(cancelledBk.deposit_payment_intent_id, 'CANCEL-BOOKING');
    }
    // Refund GC debits for group siblings
    if (bk.group_id) {
      try {
        const sibs = await query(`SELECT id FROM bookings WHERE group_id = $1 AND business_id = $2 AND id != $3`, [bk.group_id, bk.business_id, bk.id]);
        const { refundGiftCardForBooking } = require('../../services/gift-card-refund');
        for (const sib of sibs.rows) { await refundGiftCardForBooking(sib.id); }
      } catch (e) { console.error('[GC REFUND] sibling cancel-booking error:', e.message); }
    }

    // Audit log
    try {
      await query(
        `INSERT INTO audit_logs (business_id, entity_type, entity_id, action, old_data, new_data)
         VALUES ($1, 'booking', $2, 'client_cancel', $3, $4)`,
        [bk.business_id, bk.id,
         JSON.stringify({ status: bk.status }),
         JSON.stringify({ status: 'cancelled', cancel_reason: 'Annul\u00e9 par le client (email)' })]
      );
    } catch (_) { /* non-critical */ }

    broadcast(bk.business_id, 'booking_update', { action: 'cancelled', source: 'public' });
    // H3: Notify pro about client cancellation
    try { await query(`INSERT INTO notifications (business_id, booking_id, type, status) VALUES ($1, $2, 'email_cancellation_pro', 'queued')`, [bk.business_id, bk.id]); } catch (_) {}

    // Send cancellation email + waitlist (non-blocking)
    (async () => {
      try {
        const fullBk = await query(
          `SELECT b.*, CASE WHEN sv.name IS NOT NULL THEN s.name || ' — ' || sv.name ELSE s.name END AS service_name,
                  s.category AS service_category,
                  p.display_name AS practitioner_name,
                  c.full_name AS client_name, c.email AS client_email,
                  biz.name AS biz_name, biz.email AS biz_email, biz.address AS biz_address,
                  biz.theme AS biz_theme, biz.slug AS biz_slug, biz.settings AS biz_settings
           FROM bookings b LEFT JOIN services s ON s.id = b.service_id
           LEFT JOIN service_variants sv ON sv.id = b.service_variant_id
           LEFT JOIN practitioners p ON p.id = b.practitioner_id
           LEFT JOIN clients c ON c.id = b.client_id
           JOIN businesses biz ON biz.id = b.business_id WHERE b.id = $1`, [bk.id]
        );
        if (fullBk.rows[0]?.client_email) {
          const row = fullBk.rows[0];
          // Query group services for multi-service bookings
          let groupServices = null;
          if (row.group_id) {
            const grp = await query(
              `SELECT CASE WHEN sv.name IS NOT NULL THEN COALESCE(s.category || ' - ', '') || s.name || ' — ' || sv.name ELSE COALESCE(s.category || ' - ', '') || s.name END AS name,
                      COALESCE(sv.duration_min, s.duration_min) AS duration_min,
                      COALESCE(sv.price_cents, s.price_cents) AS price_cents, b.end_at,
                      b.practitioner_id, p.display_name AS practitioner_name
               FROM bookings b LEFT JOIN services s ON s.id = b.service_id
               LEFT JOIN service_variants sv ON sv.id = b.service_variant_id
               LEFT JOIN practitioners p ON p.id = b.practitioner_id
               WHERE b.group_id = $1 AND b.business_id = $2 ORDER BY b.group_order, b.start_at`,
              [row.group_id, bk.business_id]
            );
            if (grp.rows.length > 1) {
              const _pIds = new Set(grp.rows.map(r => r.practitioner_id));
              if (_pIds.size <= 1) grp.rows.forEach(r => { r.practitioner_name = null; });
              groupServices = grp.rows;
            }
          }
          const groupEndAt = groupServices ? groupServices[groupServices.length - 1].end_at : null;
          const { sendCancellationEmail } = require('../../services/email');
          const { getGcPaidCents } = require('../../services/gift-card-refund');
          const gcPaidCancel2 = await getGcPaidCents(bk.id);
          await sendCancellationEmail({
            booking: { start_at: row.start_at, end_at: groupEndAt || row.end_at, client_name: row.client_name, client_email: row.client_email, service_name: row.service_name, practitioner_name: row.practitioner_name, deposit_required: row.deposit_required, deposit_status: row.deposit_status, deposit_amount_cents: row.deposit_amount_cents, deposit_paid_at: row.deposit_paid_at, deposit_payment_intent_id: row.deposit_payment_intent_id, gc_paid_cents: gcPaidCancel2 },
            business: { name: row.biz_name, email: row.biz_email, address: row.biz_address, theme: row.biz_theme, slug: row.biz_slug, settings: row.biz_settings },
            groupServices
          });
        }
      } catch (e) { console.warn('[EMAIL] Cancel-booking email error:', e.message); }
      try { const { calSyncDelete } = require('../staff/bookings-helpers'); calSyncDelete(bk.business_id, bk.id); } catch (_) {}
      try { await processWaitlistForCancellation(bk.id, bk.business_id); } catch (_) {}
      if (bk.group_id) {
        try {
          const sibs = await query(`SELECT id FROM bookings WHERE group_id = $1 AND business_id = $2 AND id != $3`, [bk.group_id, bk.business_id, bk.id]);
          for (const sib of sibs.rows) {
            try { const { calSyncDelete } = require('../staff/bookings-helpers'); calSyncDelete(bk.business_id, sib.id); } catch (_) {}
            try { await processWaitlistForCancellation(sib.id, bk.business_id); } catch (_) {}
          }
        } catch (_) {}
      }
    })();

    const dt = new Date(bk.start_at).toLocaleDateString('fr-BE', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Europe/Brussels' });
    const tm = new Date(bk.start_at).toLocaleTimeString('fr-BE', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Brussels' });
    return res.send(confirmationPage('Rendez-vous annul\u00e9 \u274c', `Votre rendez-vous du <strong>${dt} \u00e0 ${tm}</strong> a \u00e9t\u00e9 annul\u00e9.`, '#C62828', bk.business_name));
  } catch (err) { next(err); }
});

// POST /api/public/booking/:token/confirm-booking — mutation (pending → confirmed)
router.post('/booking/:token/confirm-booking', async (req, res, next) => {
  try {
    const { token } = req.params;
    const isForm = req.is('application/x-www-form-urlencoded');

    // Fetch display data for HTML response
    let displayData = null;
    if (isForm) {
      const info = await query(
        `SELECT b.status, b.start_at, b.confirmation_expires_at,
                CASE WHEN sv.name IS NOT NULL THEN s.name || ' — ' || sv.name ELSE s.name END AS service_name,
                  s.category AS service_category,
                biz.name AS business_name, biz.theme
         FROM bookings b LEFT JOIN services s ON s.id = b.service_id
         LEFT JOIN service_variants sv ON sv.id = b.service_variant_id
         JOIN businesses biz ON biz.id = b.business_id
         WHERE b.public_token = $1`, [token]
      );
      if (info.rows.length > 0) {
        const bk = info.rows[0];
        displayData = {
          service_name: bk.service_name,
          business_name: bk.business_name,
          _dt: new Date(bk.start_at).toLocaleDateString('fr-BE', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Europe/Brussels' }),
          _tm: new Date(bk.start_at).toLocaleTimeString('fr-BE', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Brussels' }),
          _color: bk.theme?.primary_color || '#0D7377'
        };
      }
    }

    // Atomic: primary confirm + sibling propagation in one transaction
    const txClient3 = await pool.connect();
    let result, sibConfirmed = { rows: [] };
    try {
      await txClient3.query('BEGIN');
      result = await txClient3.query(
        `UPDATE bookings SET status = 'confirmed', confirmation_expires_at = NULL, locked = true, updated_at = NOW()
         WHERE public_token = $1 AND status = 'pending'
           AND (confirmation_expires_at IS NULL OR confirmation_expires_at > NOW())
         RETURNING id, status, business_id, public_token, start_at, end_at, client_id, service_id, practitioner_id`,
        [token]
      );

      if (result.rows.length === 0) {
        await txClient3.query('ROLLBACK');
        // Check why it failed
        const check = await query(`SELECT status, confirmation_expires_at FROM bookings WHERE public_token = $1`, [token]);
        if (check.rows.length === 0) {
        if (isForm) return res.status(404).send(confirmationPage('Rendez-vous introuvable', 'Ce lien n\u2019est plus valide.', '#C62828'));
        return res.status(404).json({ error: 'Rendez-vous introuvable' });
      }
      if (check.rows[0].status === 'confirmed') {
        if (isForm) return res.send(confirmationPage('D\u00e9j\u00e0 confirm\u00e9 \u2705', 'Votre rendez-vous est d\u00e9j\u00e0 confirm\u00e9.', displayData?._color || '#0D7377', displayData?.business_name));
        return res.json({ confirmed: true, already: true });
      }
      if (check.rows[0].status === 'cancelled') {
        if (isForm) return res.send(confirmationPage('D\u00e9lai expir\u00e9', 'Ce rendez-vous a \u00e9t\u00e9 annul\u00e9 car le d\u00e9lai de confirmation a expir\u00e9.', '#C62828', displayData?.business_name));
        return res.status(410).json({ error: 'Booking expired and cancelled' });
      }
      if (isForm) return res.send(confirmationPage('Action impossible', 'Ce rendez-vous ne peut plus \u00eatre confirm\u00e9.', '#A68B3C', displayData?.business_name));
      return res.status(400).json({ error: 'Booking not in pending status' });
    }

      // Confirm group siblings inside same transaction
      const bkInner = result.rows[0];
      sibConfirmed = await txClient3.query(
        `UPDATE bookings SET status = 'confirmed', confirmation_expires_at = NULL, locked = true, updated_at = NOW()
         WHERE group_id = (SELECT group_id FROM bookings WHERE id = $1 AND group_id IS NOT NULL)
           AND id != $1 AND status = 'pending'
         RETURNING id`,
        [bkInner.id]
      );
      await txClient3.query('COMMIT');
    } catch (txErr3) {
      await txClient3.query('ROLLBACK').catch(() => {});
      throw txErr3;
    } finally {
      txClient3.release();
    }

    const bk = result.rows[0];

    // SSE notification
    broadcast(bk.business_id, 'booking_update', { action: 'confirmed', source: 'public' });
    // calSyncPush for primary + siblings
    try { const { calSyncPush } = require('../staff/bookings-helpers'); calSyncPush(bk.business_id, bk.id); } catch (_) {}
    for (const sib of (sibConfirmed?.rows || [])) {
      try { const { calSyncPush } = require('../staff/bookings-helpers'); calSyncPush(bk.business_id, sib.id); } catch (_) {}
    }

    // Send the actual confirmation email (non-blocking)
    (async () => {
      try {
        const fullBk = await query(
          `SELECT b.*, CASE WHEN sv.name IS NOT NULL THEN s.name || ' — ' || sv.name ELSE s.name END AS service_name,
                  s.category AS service_category,
                  p.display_name AS practitioner_name,
                  c.full_name AS client_name, c.email AS client_email,
                  biz.name AS biz_name, biz.email AS biz_email, biz.phone AS biz_phone, biz.address AS biz_address, biz.theme AS biz_theme, biz.settings AS biz_settings
           FROM bookings b
           LEFT JOIN services s ON s.id = b.service_id
           LEFT JOIN service_variants sv ON sv.id = b.service_variant_id
           JOIN practitioners p ON p.id = b.practitioner_id
           LEFT JOIN clients c ON c.id = b.client_id
           JOIN businesses biz ON biz.id = b.business_id
           WHERE b.id = $1`, [bk.id]
        );
        if (fullBk.rows[0] && fullBk.rows[0].client_email) {
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
          await sendBookingConfirmation({
            booking: {
              public_token: row.public_token, start_at: row.start_at, end_at: groupEndAt || row.end_at,
              client_name: row.client_name, client_email: row.client_email,
              service_name: row.service_name, practitioner_name: row.practitioner_name,
              comment: row.comment_client,
              promotion_label: row.promotion_label, promotion_discount_cents: row.promotion_discount_cents, promotion_discount_pct: row.promotion_discount_pct
            },
            business: { name: row.biz_name, email: row.biz_email, phone: row.biz_phone, address: row.biz_address, theme: row.biz_theme, settings: row.biz_settings },
            groupServices
          });
        }
      } catch (e) { console.warn('[EMAIL] Post-confirmation email error:', e.message); }
    })();

    if (isForm && displayData) {
      return res.send(confirmationPage(
        'Rendez-vous confirm\u00e9 \u2705',
        `${escHtml(displayData.service_name) || 'Votre rendez-vous'} le <strong>${escHtml(displayData._dt)} \u00e0 ${escHtml(displayData._tm)}</strong> est confirm\u00e9. Merci !`,
        displayData._color, displayData.business_name
      ));
    }
    const { business_id: _bid, ...publicBooking } = bk;
    res.json({ confirmed: true, booking: publicBooking });
  } catch (err) { next(err); }
});

module.exports = router;
