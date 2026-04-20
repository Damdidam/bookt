/**
 * Post-confirm side effects when a deposit is marked paid and booking auto-confirms.
 *
 * Triggered when:
 * - Stripe webhook confirms a payment_intent (cron / webhook)
 * - Stripe verify returns success
 * - Gift card covers 100% of the deposit (gift-cards-passes.js)
 * - Gift card absorbs the tiny remainder < Stripe min (deposit.js gc_absorbed)
 *
 * Fire-and-forget: called AFTER the DB COMMIT. Errors are logged but never
 * thrown (the HTTP response has already been sent).
 *
 * @param {string} bookingId
 */
async function sendDepositConfirmationSideEffects(bookingId) {
  try {
    const { query } = require('./db');
    const { broadcast } = require('./sse');
    const fullBk = await query(
      `SELECT b.*, CASE WHEN sv.name IS NOT NULL THEN s.name || ' \u2014 ' || sv.name ELSE s.name END AS service_name,
              s.category AS service_category,
              COALESCE(sv.price_cents, s.price_cents, 0) AS service_price_cents,
              COALESCE(sv.duration_min, s.duration_min, 0) AS duration_min,
              p.display_name AS practitioner_name,
              c.full_name AS client_name, c.email AS client_email, c.phone AS client_phone,
              biz.name AS biz_name, biz.email AS biz_email, biz.phone AS biz_phone, biz.address AS biz_address,
              biz.theme AS biz_theme, biz.slug AS biz_slug, biz.settings AS biz_settings
       FROM bookings b
       LEFT JOIN services s ON s.id = b.service_id
       LEFT JOIN service_variants sv ON sv.id = b.service_variant_id
       LEFT JOIN practitioners p ON p.id = b.practitioner_id
       LEFT JOIN clients c ON c.id = b.client_id
       JOIN businesses biz ON biz.id = b.business_id
       WHERE b.id = $1`,
      [bookingId]
    );
    if (!fullBk.rows[0]) return;
    const row = fullBk.rows[0];

    // Compute groupServices for multi-service bookings (same shape expected by email templates)
    let groupServices = null;
    if (row.group_id) {
      const grp = await query(
        `SELECT CASE WHEN sv.name IS NOT NULL THEN COALESCE(s.category || ' - ', '') || s.name || ' \u2014 ' || sv.name ELSE COALESCE(s.category || ' - ', '') || s.name END AS name,
                COALESCE(sv.duration_min, s.duration_min) AS duration_min,
                COALESCE(sv.price_cents, s.price_cents) AS price_cents, b.end_at,
                b.practitioner_id, p.display_name AS practitioner_name
         FROM bookings b LEFT JOIN services s ON s.id = b.service_id
         LEFT JOIN service_variants sv ON sv.id = b.service_variant_id
         LEFT JOIN practitioners p ON p.id = b.practitioner_id
         WHERE b.group_id = $1 AND b.business_id = $2 ORDER BY b.group_order, b.start_at`,
        [row.group_id, row.business_id]
      );
      if (grp.rows.length > 1) {
        const _pIds = new Set(grp.rows.map(r => r.practitioner_id));
        if (_pIds.size <= 1) grp.rows.forEach(r => { r.practitioner_name = null; });
        groupServices = grp.rows;
      }
    }
    const groupEndAt = groupServices ? groupServices[groupServices.length - 1].end_at : null;

    // Client + pro emails
    if (row.client_email) {
      try {
        const { getGcPaidCents } = require('./gift-card-refund');
        const gcPaidForEmail = await getGcPaidCents(row.id);
        const { sendDepositPaidEmail, sendDepositPaidProEmail } = require('./email');
        // R2 fix: propage booked_price_cents + discount_pct pour que email deposit-paid
        // affiche la bannière LM (last minute -X%) + prix barré. Avant: template tombait
        // sur rawPriceDP (catalogue brut) car hasLmDP = booking.discount_pct = undefined.
        const _emailBooking = {
          start_at: row.start_at, end_at: groupEndAt || row.end_at,
          deposit_amount_cents: row.deposit_amount_cents,
          gc_paid_cents: gcPaidForEmail,
          client_name: row.client_name, client_email: row.client_email, client_phone: row.client_phone,
          service_name: row.service_name, service_category: row.service_category,
          practitioner_name: row.practitioner_name,
          public_token: row.public_token,
          promotion_label: row.promotion_label,
          promotion_discount_cents: row.promotion_discount_cents,
          promotion_discount_pct: row.promotion_discount_pct,
          service_price_cents: row.service_price_cents,
          booked_price_cents: row.booked_price_cents,
          discount_pct: row.discount_pct,
          duration_min: row.duration_min
        };
        await sendDepositPaidEmail({
          booking: _emailBooking,
          business: { id: row.business_id, name: row.biz_name, slug: row.biz_slug, email: row.biz_email, phone: row.biz_phone, address: row.biz_address, theme: row.biz_theme, settings: row.biz_settings },
          groupServices
        });
        sendDepositPaidProEmail({
          booking: _emailBooking,
          business: { id: row.business_id, name: row.biz_name, email: row.biz_email, theme: row.biz_theme }
        }).catch(e => console.warn('[DEPOSIT SIDE EFFECTS] Pro email error:', e.message));
      } catch (e) { console.warn('[DEPOSIT SIDE EFFECTS] Client email error:', e.message); }
    }

    // SSE broadcast so staff agenda updates in real-time
    try {
      if (broadcast) broadcast(row.business_id, 'booking_update', { action: 'deposit_paid', booking_id: row.id });
    } catch (e) { console.warn('[DEPOSIT SIDE EFFECTS] Broadcast error:', e.message); }

    // Calendar sync push (primary + siblings)
    try {
      const { calSyncPush } = require('../routes/staff/bookings-helpers');
      calSyncPush(row.business_id, row.id);
      if (row.group_id) {
        const sibs = await query(
          `SELECT id FROM bookings WHERE group_id = $1 AND business_id = $2 AND id != $3`,
          [row.group_id, row.business_id, row.id]
        );
        for (const sib of sibs.rows) calSyncPush(row.business_id, sib.id);
      }
    } catch (e) { console.warn('[DEPOSIT SIDE EFFECTS] Cal sync error:', e.message); }
  } catch (e) {
    console.error('[DEPOSIT SIDE EFFECTS] Unexpected error:', e.message);
  }
}

module.exports = { sendDepositConfirmationSideEffects };
