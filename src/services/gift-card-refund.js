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

  for (const debit of debits.rows) {
    // Check if already refunded for this debit
    const existing = await q(
      `SELECT id FROM gift_card_transactions
       WHERE gift_card_id = $1 AND booking_id = $2 AND type = 'refund'`,
      [debit.gift_card_id, bookingId]
    );
    if (existing.rows.length > 0) continue; // already refunded

    // Credit back to gift card
    await q(
      `UPDATE gift_cards SET balance_cents = balance_cents + $1, status = CASE WHEN status IN ('used', 'expired') THEN 'active' ELSE status END, updated_at = NOW()
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
