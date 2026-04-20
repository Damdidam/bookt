/**
 * Gift Card Refund Helper
 *
 * Automatically refunds gift card debits when a booking is cancelled/refunded.
 * Called from deposit-expiry, bookings-status, and public cancel/reject flows.
 */

const { query } = require('./db');

/**
 * Refund all gift card debits for a booking.
 * @param {string} bookingId - The booking ID
 * @param {object} [dbClient] - Optional pg client for transactions
 * @returns {Promise<{refunded: number, cards: Array}>} Total cents refunded + affected cards
 */
async function refundGiftCardForBooking(bookingId, dbClient) {
  const q = dbClient ? dbClient.query.bind(dbClient) : query;

  // Find all GC debits for this booking
  const debits = await q(
    `SELECT gct.id, gct.gift_card_id, gct.amount_cents, gc.code, gc.business_id
     FROM gift_card_transactions gct
     JOIN gift_cards gc ON gc.id = gct.gift_card_id
     WHERE gct.booking_id = $1 AND gct.type = 'debit'`,
    [bookingId]
  );

  if (debits.rows.length === 0) return { refunded: 0, cards: [] };

  let totalRefunded = 0;
  const cards = [];

  // BUG-GC-CAP fix (bombe #1) : remplacer le cap `LEAST(amount_cents, balance+refund)`
  // par un guard per-booking amount-based. Raison : le cap cassait dès qu'une feature
  // topup/reload serait ajoutée (balance > amount_cents légitime après topup). Le guard
  // amount-based (total_refund >= total_debit par booking+GC) empêche le double-refund
  // sans dépendre de `amount_cents` comme plafond. Topup-safe.
  // Stronger que le précédent count-based : handle aussi les staff manual partial refunds.
  const perBookingTotals = {};
  const totalsRes = await q(
    `SELECT gift_card_id,
            COALESCE(SUM(CASE WHEN type = 'debit' THEN amount_cents ELSE 0 END), 0) AS debited,
            COALESCE(SUM(CASE WHEN type = 'refund' THEN amount_cents ELSE 0 END), 0) AS refunded
       FROM gift_card_transactions WHERE booking_id = $1 GROUP BY gift_card_id`,
    [bookingId]
  );
  for (const r of totalsRes.rows) {
    perBookingTotals[r.gift_card_id] = {
      debited: parseInt(r.debited) || 0,
      refunded: parseInt(r.refunded) || 0
    };
  }

  for (const debit of debits.rows) {
    const t = perBookingTotals[debit.gift_card_id] || { debited: 0, refunded: 0 };
    // Skip if total refunded already covers total debited for this booking+GC.
    if (t.refunded >= t.debited) continue;

    // Only refund up to the gap (debit - already-refunded) to handle partial prior refunds.
    const remaining = t.debited - t.refunded;
    const refundAmount = Math.min(debit.amount_cents, remaining);
    if (refundAmount <= 0) continue;
    t.refunded += refundAmount; // track in-loop increment

    // Credit back to gift card. If the card was expired, reactivate it AND extend
    // expires_at by 30 days so the client can actually use the refunded balance —
    // otherwise the money is locked on a card that booking validation refuses.
    // No LEAST cap — the per-booking guard above prevents double-refund, and removing
    // the cap allows future GC topups (balance legitimately > amount_cents).
    await q(
      `UPDATE gift_cards SET balance_cents = balance_cents + $1,
       status = CASE WHEN status IN ('used', 'expired') THEN 'active' ELSE status END,
       expires_at = CASE
         WHEN status = 'expired' OR (expires_at IS NOT NULL AND expires_at <= NOW())
           THEN GREATEST(NOW() + INTERVAL '30 days', COALESCE(expires_at, NOW() + INTERVAL '30 days'))
         ELSE expires_at
       END,
       updated_at = NOW()
       WHERE id = $2`,
      [refundAmount, debit.gift_card_id]
    );

    // Create refund transaction
    await q(
      `INSERT INTO gift_card_transactions (id, gift_card_id, business_id, booking_id, amount_cents, type, note)
       VALUES (gen_random_uuid(), $1, $2, $3, $4, 'refund', $5)`,
      [debit.gift_card_id, debit.business_id, bookingId, refundAmount,
       `Remboursement — annulation RDV`]
    );

    totalRefunded += refundAmount;
    cards.push({ code: debit.code, amount: refundAmount });
  }

  if (totalRefunded > 0) {
    console.log(`[GC REFUND] Booking ${bookingId}: refunded ${totalRefunded} cents to ${cards.length} card(s)`);
  }

  return { refunded: totalRefunded, cards };
}

/**
 * Get total GC debit amount for a booking (for email display).
 * @param {string} bookingId
 * @param {object} [dbClient] - Optional pg client for transactions
 * @returns {Promise<number>} Total GC debit in cents
 */
async function getGcPaidCents(bookingId, dbClient) {
  const q = dbClient ? dbClient.query.bind(dbClient) : query;
  const res = await q(
    `SELECT COALESCE(SUM(amount_cents), 0) AS total FROM gift_card_transactions WHERE booking_id = $1 AND type = 'debit'`,
    [bookingId]
  );
  return parseInt(res.rows[0]?.total) || 0;
}

module.exports = { refundGiftCardForBooking, getGcPaidCents };
