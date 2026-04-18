const { query } = require('./db');

async function refundPassForBooking(bookingId, dbClient) {
  const q = dbClient ? dbClient.query.bind(dbClient) : query;
  // H-02 fix: fetch expires_at + status pour skip les passes expirés/cancelled
  // (crediter un pass expiré ne le rend pas utilisable → email client "séance recréditée" mensonger).
  const debits = await q(
    `SELECT pt.id, pt.pass_id, pt.sessions, p.code, p.business_id,
            p.expires_at, p.status AS pass_status
     FROM pass_transactions pt
     JOIN passes p ON p.id = pt.pass_id
     WHERE pt.booking_id = $1 AND pt.type = 'debit'`, [bookingId]
  );
  if (debits.rows.length === 0) return { refunded: 0, passes: [] };
  let totalRefunded = 0;
  const passes = [];
  // Count existing refunds per pass to handle cancel→restore→cancel correctly
  const refundCounts = {};
  const existingRefunds = await q(
    `SELECT pass_id, COUNT(*) AS cnt FROM pass_transactions WHERE booking_id = $1 AND type = 'refund' GROUP BY pass_id`, [bookingId]
  );
  for (const r of existingRefunds.rows) refundCounts[r.pass_id] = parseInt(r.cnt) || 0;
  // Count debits per pass to match
  const debitCounts = {};
  for (const d of debits.rows) debitCounts[d.pass_id] = (debitCounts[d.pass_id] || 0) + 1;

  for (const debit of debits.rows) {
    // Skip if this pass already has as many refunds as debits for this booking
    if ((refundCounts[debit.pass_id] || 0) >= (debitCounts[debit.pass_id] || 0)) continue;
    // H-02 fix: skip si pass expiré (expires_at passé) ou cancelled (hard cancel par pro).
    // Crediter sessions_remaining sur un pass non-utilisable = email mensonger au client.
    const isNaturallyExpired = debit.expires_at && new Date(debit.expires_at) <= new Date();
    const isHardCancelled = debit.pass_status === 'cancelled';
    if (isNaturallyExpired || isHardCancelled) {
      console.log(`[PASS REFUND] skip pass ${debit.pass_id} (code ${debit.code}) — expired=${isNaturallyExpired} cancelled=${isHardCancelled} — client ne sera pas notifié "session recréditée"`);
      continue;
    }
    refundCounts[debit.pass_id] = (refundCounts[debit.pass_id] || 0) + 1;
    // Credit sessions back (don't reactivate if naturally expired past expires_at — guard déjà ci-dessus)
    await q(
      `UPDATE passes SET sessions_remaining = sessions_remaining + ABS($1),
       status = CASE
         WHEN status IN ('used', 'expired') AND (expires_at IS NULL OR expires_at > NOW()) THEN 'active'
         ELSE status
       END,
       updated_at = NOW() WHERE id = $2`,
      [debit.sessions, debit.pass_id]
    );
    await q(
      `INSERT INTO pass_transactions (id, pass_id, business_id, booking_id, sessions, type, note)
       VALUES (gen_random_uuid(), $1, $2, $3, $4, 'refund', 'Remboursement — annulation RDV')`,
      [debit.pass_id, debit.business_id, bookingId, Math.abs(debit.sessions)]
    );
    totalRefunded += Math.abs(debit.sessions);
    passes.push({ code: debit.code, sessions: debit.sessions });
  }
  if (totalRefunded > 0) console.log(`[PASS REFUND] Booking ${bookingId}: refunded ${totalRefunded} session(s)`);
  return { refunded: totalRefunded, passes };
}

module.exports = { refundPassForBooking };
