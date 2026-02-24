/**
 * Initialize database schema.
 * Run: npm run db:init
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

async function init() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
  });

  try {
    console.log('🔧 Initializing database...');

    // V1: Core schema
    const schemaPath = path.join(__dirname, '../../schema.sql');
    const schema = fs.readFileSync(schemaPath, 'utf8');
    await pool.query(schema);
    console.log('✅ V1 schema created (15 core tables)');

    // V2: Mini-site extension
    const migrationPath = path.join(__dirname, '../../schema-v2-migration.sql');
    if (fs.existsSync(migrationPath)) {
      const migration = fs.readFileSync(migrationPath, 'utf8');
      await pool.query(migration);
      console.log('✅ V2 migration applied (7 new tables + extensions)');
    }

    console.log('\n   22 tables total, RLS + indexes + triggers + seed data');
  } catch (err) {
    console.error('❌ Database init failed:', err.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

init();
