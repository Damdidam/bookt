/**
 * Gift card expiry — auto-expire active gift cards past their expiration date.
 * Runs periodically via cron in server.js.
 */
const { query } = require('./db');

async function processExpiredGiftCards() {
  const result = await query(
    `UPDATE gift_cards SET status = 'expired', updated_at = NOW()
     WHERE status = 'active' AND expires_at < NOW()
     RETURNING id, code, business_id`
  );

  return { processed: result.rows.length };
}

module.exports = { processExpiredGiftCards };
