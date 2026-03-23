const { pool } = require('./db');

async function processExpiredPasses() {
  const result = await pool.query(
    `UPDATE passes SET status = 'expired', updated_at = NOW()
     WHERE status = 'active' AND expires_at IS NOT NULL AND expires_at < NOW()
     RETURNING id`
  );
  return { processed: result.rowCount };
}

module.exports = { processExpiredPasses };
