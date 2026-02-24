const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: true } : false,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000
});

pool.on('error', (err) => {
  console.error('Unexpected DB pool error:', err);
});

/**
 * Execute a query with RLS context (sets business_id for row-level security)
 * Use this for all staff API queries
 */
async function queryWithRLS(businessId, text, params = []) {
  const client = await pool.connect();
  try {
    await client.query(`SET app.current_business_id = '${businessId}'`);
    const result = await client.query(text, params);
    return result;
  } finally {
    // Reset the setting before returning to pool
    await client.query("RESET app.current_business_id").catch(() => {});
    client.release();
  }
}

/**
 * Execute a transaction with RLS context
 * Use for operations that need atomicity (booking creation, etc.)
 */
async function transactionWithRLS(businessId, callback) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`SET app.current_business_id = '${businessId}'`);
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    await client.query("RESET app.current_business_id").catch(() => {});
    client.release();
  }
}

/**
 * Execute a query without RLS (for public endpoints, auth, etc.)
 */
async function query(text, params = []) {
  return pool.query(text, params);
}

module.exports = { pool, query, queryWithRLS, transactionWithRLS };
