#!/usr/bin/env node
/**
 * One-shot backfill: encrypt plaintext OAuth tokens stored in calendar_connections.
 *
 * Run after deploying schema-v68 (G9) + setting CALENDAR_TOKEN_KEY on Render.
 *
 * Idempotent — rows already starting with the `enc:v1:` prefix are skipped.
 *
 * Usage (from project root with .env loaded or vars exported):
 *   node scripts/encrypt-oauth-tokens.js [--dry-run]
 *
 * Env required:
 *   DATABASE_URL          PostgreSQL connection string
 *   CALENDAR_TOKEN_KEY    32-byte key (hex64 or base64) — same one used by src/utils/crypto.js
 */

require('dotenv').config?.();
const { Pool } = require('pg');
const { encryptToken } = require('../src/utils/crypto');

const DRY_RUN = process.argv.includes('--dry-run');

if (!process.env.DATABASE_URL) {
  console.error('FATAL: DATABASE_URL must be set');
  process.exit(1);
}
if (!process.env.CALENDAR_TOKEN_KEY) {
  console.error('FATAL: CALENDAR_TOKEN_KEY must be set (otherwise encryption is a no-op)');
  process.exit(1);
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL.includes('render.com') ? { rejectUnauthorized: false } : false
});

async function main() {
  const client = await pool.connect();
  try {
    const { rows } = await client.query(
      `SELECT id, provider, refresh_token, access_token
         FROM calendar_connections
        WHERE (refresh_token IS NOT NULL AND refresh_token NOT LIKE 'enc:v1:%')
           OR (access_token  IS NOT NULL AND access_token  NOT LIKE 'enc:v1:%')`
    );

    if (rows.length === 0) {
      console.log('No plaintext tokens to encrypt — DB is clean.');
      return;
    }

    console.log(`Found ${rows.length} row(s) with plaintext tokens.${DRY_RUN ? ' (dry-run)' : ''}`);

    let updated = 0;
    for (const row of rows) {
      const newRefresh = row.refresh_token && !row.refresh_token.startsWith('enc:v1:')
        ? encryptToken(row.refresh_token)
        : row.refresh_token;
      const newAccess = row.access_token && !row.access_token.startsWith('enc:v1:')
        ? encryptToken(row.access_token)
        : row.access_token;

      // RULE #6: ensure encryption actually produced an enc:v1: prefix (not a no-op when key is missing)
      if ((row.refresh_token && !String(newRefresh).startsWith('enc:v1:')) ||
          (row.access_token  && !String(newAccess).startsWith('enc:v1:'))) {
        console.error(`[ABORT] encryptToken() returned plaintext for ${row.provider} row ${row.id} — CALENDAR_TOKEN_KEY likely invalid.`);
        process.exit(2);
      }

      if (DRY_RUN) {
        console.log(`  [dry-run] would encrypt row ${row.id} (${row.provider})`);
      } else {
        await client.query(
          `UPDATE calendar_connections
              SET refresh_token = $1, access_token = $2, updated_at = NOW()
            WHERE id = $3`,
          [newRefresh, newAccess, row.id]
        );
        updated++;
      }
    }

    console.log(`Done. ${DRY_RUN ? 'Would encrypt' : 'Encrypted'} ${DRY_RUN ? rows.length : updated} row(s).`);
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch(err => {
  console.error('FATAL:', err);
  process.exit(1);
});
