const { query } = require('./db');

async function refundPassForBooking(bookingId, dbClient) {
  const q = dbClient ? dbClient.query.bind(dbClient) : query;
  const debits = await q(
    `SELECT pt.id, pt.pass_id, pt.sessions, p.code, p.business_id
     FROM pass_transactions pt
     JOIN passes p ON p.id = pt.pass_id
     WHERE pt.booking_id = $1 AND pt.type = 'debit'`, [bookingId]
  );
  if (debits.rows.length === 0) return { refunded: 0, passes: [] };
  let totalRefunded = 0;
  const passes = [];
  for (const debit of debits.rows) {
    const existing = await q(
      `SELECT id FROM pass_transactions WHERE pass_id = $1 AND booking_id = $2 AND type = 'refund'`,
      [debit.pass_id, bookingId]
    );
    if (existing.rows.length > 0) continue;
    await q(
      `UPDATE passes SET sessions_remaining = sessions_remaining + ABS($1), status = 'active', updated_at = NOW() WHERE id = $2`,
      [debit.sessions, debit.pass_id]
    );
    await q(
      `INSERT INTO pass_transactions (id, pass_id, business_id, booking_id, sessions, type, note)
       VALUES (gen_random_uuid(), $1, $2, $3, $4, 'refund', 'Remboursement — annulation RDV')`,
      [debit.pass_id, debit.business_id, bookingId, debit.sessions]
    );
    totalRefunded += debit.sessions;
    passes.push({ code: debit.code, sessions: debit.sessions });
  }
  if (totalRefunded > 0) console.log(`[PASS REFUND] Booking ${bookingId}: refunded ${totalRefunded} session(s)`);
  return { refunded: totalRefunded, passes };
}

module.exports = { refundPassForBooking };
