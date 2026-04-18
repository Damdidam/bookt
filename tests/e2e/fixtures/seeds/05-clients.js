const { pool } = require('../../../../src/services/db');
const IDS = require('../ids');

/**
 * 3 clients test:
 * - Jean: classique, non VIP, aucune conso marketing
 * - Marie: cliente régulière, consent marketing
 * - Paul: VIP, consent marketing
 *
 * Schema-adapted: colonne `booking_count` n'existe pas dans `clients` → omise.
 */
const CLIENTS = [
  { id: IDS.CLIENT_JEAN,  full_name: 'Jean Testeur',  email: 'jean-test@genda-test.be',  phone: '+32491000001', is_vip: false, consent_sms: true, consent_email: true, consent_marketing: false },
  { id: IDS.CLIENT_MARIE, full_name: 'Marie Regular', email: 'marie-test@genda-test.be', phone: '+32491000002', is_vip: false, consent_sms: true, consent_email: true, consent_marketing: true  },
  { id: IDS.CLIENT_PAUL,  full_name: 'Paul VIP',      email: 'paul-test@genda-test.be',  phone: '+32491000003', is_vip: true,  consent_sms: true, consent_email: true, consent_marketing: true  },
];

async function seedClients() {
  for (const c of CLIENTS) {
    await pool.query(`
      INSERT INTO clients (id, business_id, full_name, email, phone, is_vip,
        consent_sms, consent_email, consent_marketing)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      ON CONFLICT (id) DO UPDATE SET
        full_name = EXCLUDED.full_name, email = EXCLUDED.email, phone = EXCLUDED.phone,
        is_vip = EXCLUDED.is_vip, consent_sms = EXCLUDED.consent_sms,
        consent_email = EXCLUDED.consent_email, consent_marketing = EXCLUDED.consent_marketing,
        updated_at = NOW()
    `, [c.id, IDS.BUSINESS, c.full_name, c.email, c.phone, c.is_vip,
        c.consent_sms, c.consent_email, c.consent_marketing]);

    await pool.query(`INSERT INTO seed_tracking (entity_type, entity_id) VALUES ('client', $1) ON CONFLICT DO NOTHING`, [c.id]);
  }
}

module.exports = { seedClients, CLIENTS };

if (require.main === module) {
  seedClients().then(() => { console.log('✓ 3 clients seeded'); process.exit(0); }).catch(e => { console.error(e); process.exit(1); });
}
