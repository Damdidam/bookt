const { pool } = require('../../../../src/services/db');
const IDS = require('../ids');

const PRACS = [
  { id: IDS.PRAC_ALICE, user_id: IDS.USER_ALICE_OWNER, display_name: 'Alice Owner', title: 'Propriétaire', email: 'alice-test@genda-test.be', role: 'owner', color: '#4A90E2' },
  { id: IDS.PRAC_BOB, user_id: IDS.USER_BOB_STAFF, display_name: 'Bob Stylist', title: 'Coiffeur', email: 'bob-test@genda-test.be', role: 'practitioner', color: '#50C878' },
  { id: IDS.PRAC_CAROL, user_id: IDS.USER_CAROL_STAFF, display_name: 'Carol Junior', title: 'Apprentie', email: 'carol-test@genda-test.be', role: 'practitioner', color: '#FF6B9D' },
];

async function seedPractitioners() {
  const bcrypt = require('bcryptjs');
  const hashedPw = await bcrypt.hash('TestPassword123!', 10);

  for (const p of PRACS) {
    // users.role CHECK autorise 'owner' | 'practitioner' (pas 'staff')
    await pool.query(`
      INSERT INTO users (id, email, password_hash, role, business_id)
      VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email, password_hash = EXCLUDED.password_hash, role = EXCLUDED.role
    `, [p.user_id, p.email, hashedPw, p.role, IDS.BUSINESS]);

    // practitioners table n'a PAS de colonne `role` → omise
    await pool.query(`
      INSERT INTO practitioners (id, business_id, user_id, display_name, title, email, color)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      ON CONFLICT (id) DO UPDATE SET
        display_name = EXCLUDED.display_name, title = EXCLUDED.title,
        email = EXCLUDED.email, color = EXCLUDED.color,
        updated_at = NOW()
    `, [p.id, IDS.BUSINESS, p.user_id, p.display_name, p.title, p.email, p.color]);

    await pool.query(`INSERT INTO seed_tracking (entity_type, entity_id) VALUES ('practitioner', $1) ON CONFLICT DO NOTHING`, [p.id]);
    await pool.query(`INSERT INTO seed_tracking (entity_type, entity_id) VALUES ('user', $1) ON CONFLICT DO NOTHING`, [p.user_id]);
  }
}

module.exports = { seedPractitioners, PRACS };

if (require.main === module) {
  seedPractitioners().then(() => { console.log('✓ 3 pracs seeded'); process.exit(0); }).catch(e => { console.error(e); process.exit(1); });
}
