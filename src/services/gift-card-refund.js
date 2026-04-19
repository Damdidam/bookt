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

  // Count existing refunds per GC to handle cancel→restore→cancel correctly
  const refundCounts = {};
  const existingRefunds = await q(
    `SELECT gift_card_id, COUNT(*) AS cnt FROM gift_card_transactions WHERE booking_id = $1 AND type = 'refund' GROUP BY gift_card_id`, [bookingId]
  );
  for (const r of existingRefunds.rows) refundCounts[r.gift_card_id] = parseInt(r.cnt) || 0;
  const debitCounts = {};
  for (const d of debits.rows) debitCounts[d.gift_card_id] = (debitCounts[d.gift_card_id] || 0) + 1;

  for (const debit of debits.rows) {
    // Skip if this GC already has as many refunds as debits for this booking
    if ((refundCounts[debit.gift_card_id] || 0) >= (debitCounts[debit.gift_card_id] || 0)) continue;
    refundCounts[debit.gift_card_id] = (refundCounts[debit.gift_card_id] || 0) + 1;

    // Credit back to gift card. If the card was expired, reactivate it AND extend
    // expires_at by 30 days so the client can actually use the refunded balance —
    // otherwise the money is locked on a card that booking validation refuses.
    // BUG-GC-CAP fix: LEAST(amount_cents, balance + $1) so balance never exceeds
    // the original purchase amount (protects against double-crédit si staff refund
    // manuel PUIS auto-refund cancel se chevauchent).
    await q(
      `UPDATE gift_cards SET balance_cents = LEAST(amount_cents, balance_cents + $1),
       status = CASE WHEN status IN ('used', 'expired') THEN 'active' ELSE status END,
       expires_at = CASE
         WHEN status = 'expired' OR (expires_at IS NOT NULL AND expires_at <= NOW())
           THEN GREATEST(NOW() + INTERVAL '30 days', COALESCE(expires_at, NOW() + INTERVAL '30 days'))
         ELSE expires_at
       END,
       updated_at = NOW()
       WHERE id = $2`,
      [debit.amount_cents, debit.gift_card_id]
    );

    // Create refund transaction
    await q(
      `INSERT INTO gift_card_transactions (id, gift_card_id, business_id, booking_id, amount_cents, type, note)
       VALUES (gen_random_uuid(), $1, $2, $3, $4, 'refund', $5)`,
      [debit.gift_card_id, debit.business_id, bookingId, debit.amount_cents,
       `Remboursement — annulation RDV`]
    );

    totalRefunded += debit.amount_cents;
    cards.push({ code: debit.code, amount: debit.amount_cents });
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
