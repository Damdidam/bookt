/**
 * Runs ONCE before all tests.
 * 1. Detect orphans from previous crashed runs → cleanup
 * 2. Run seed bootstrap (idempotent)
 * 3. Set TEST_RUN_START_TS via .run-start-ts file (shared with teardown)
 */
require('dotenv').config({ path: '.env.test' });
const fs = require('fs');
const path = require('path');
const { pool } = require('../../src/services/db');
const { seedAll } = require('./fixtures/seed');
const IDS = require('./fixtures/ids');

async function detectAndCleanOrphans() {
  const lastSeed = await pool.query(
    `SELECT COALESCE(MAX(seeded_at), '1970-01-01'::timestamptz) AS last_seeded FROM seed_tracking`
  );
  const lastSeeded = lastSeed.rows[0].last_seeded;

  const orphanBookings = await pool.query(
    `SELECT COUNT(*)::int AS c FROM bookings b
     WHERE b.business_id = $1 AND b.created_at > $2
       AND NOT EXISTS (SELECT 1 FROM seed_tracking st WHERE st.entity_id = b.id)`,
    [IDS.BUSINESS, lastSeeded]
  );

  if (orphanBookings.rows[0].c > 0) {
    console.warn(`[SETUP] Cleaning ${orphanBookings.rows[0].c} orphan bookings from previous run...`);
    await pool.query(`
      DELETE FROM bookings
      WHERE business_id = $1 AND created_at > $2
        AND id NOT IN (SELECT entity_id FROM seed_tracking WHERE entity_type IN ('booking_historique'))
    `, [IDS.BUSINESS, lastSeeded]);
  }

  // Clean stale mock logs (>1 day)
  await pool.query(`DELETE FROM test_mock_log WHERE created_at < NOW() - INTERVAL '1 day'`);
}

module.exports = async () => {
  console.log('\n[GLOBAL SETUP] Starting...');
  const t0 = Date.now();

  if (process.env.TEST_BUSINESS_ID && process.env.TEST_BUSINESS_ID !== IDS.BUSINESS) {
    throw new Error(`TEST_BUSINESS_ID mismatch: env=${process.env.TEST_BUSINESS_ID}, ids.js=${IDS.BUSINESS}`);
  }

  await detectAndCleanOrphans();
  await seedAll();

  const runStart = new Date().toISOString();
  fs.writeFileSync(path.join(__dirname, '.run-start-ts'), runStart);

  console.log(`[GLOBAL SETUP] Done in ${Date.now() - t0}ms. Run started at ${runStart}\n`);
};
