/**
 * Cross-worker cron serialization via PostgreSQL advisory locks.
 *
 * Why: Render's free plan runs one Node worker today, but the moment we scale
 * (cluster, horizontal replicas, blue/green deploy overlap), 10 setInterval
 * crons with only a `let xRunning = false` flag would fire in parallel across
 * workers → double Stripe refunds, double emails, double SMS.
 *
 * pg_try_advisory_lock(hashtext('<cron_name>')) is session-scoped and shared
 * across workers on the same DB. If another worker already holds the lock,
 * tryCronLock returns false and we skip this tick.
 *
 * Pattern mirrors services/reminders.js which was the only cron with proper
 * cross-worker safety before this module existed.
 */

const { pool } = require('./db');

/**
 * Run `fn` only if we can grab the advisory lock for `name`.
 * Releases the lock in a finally block so crashes don't leak it.
 *
 * @param {string} name  unique lock identifier, e.g. 'confirm_cron'
 * @param {function} fn  async work to perform while the lock is held
 * @returns {Promise<{locked: boolean, result?: any}>}
 */
async function withCronLock(name, fn) {
  const client = await pool.connect();
  try {
    const r = await client.query(`SELECT pg_try_advisory_lock(hashtext($1)) AS got`, [name]);
    if (!r.rows[0]?.got) return { locked: false };
    try {
      const result = await fn();
      return { locked: true, result };
    } finally {
      await client.query(`SELECT pg_advisory_unlock(hashtext($1))`, [name]).catch(() => {});
    }
  } finally {
    client.release();
  }
}

module.exports = { withCronLock };
