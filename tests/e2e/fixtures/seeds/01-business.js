const { pool } = require('../../../../src/services/db');
const IDS = require('../ids');

const SETTINGS = {
  deposit_enabled: true, deposit_type: 'percent', deposit_percent: 50,
  deposit_fixed_cents: 2500, deposit_deadline_hours: 48, deposit_noshow_threshold: 2,
  deposit_price_threshold_cents: 5000, deposit_duration_threshold_min: 60,
  deposit_threshold_mode: 'any', deposit_deduct: true,
  deposit_message: 'Un acompte de 50% est requis pour confirmer votre réservation.',
  cancel_deadline_hours: 24, cancel_grace_minutes: 240,
  cancel_policy_text: 'Annulation gratuite jusqu\'à 24h avant.',
  cancel_abuse_enabled: true, cancel_abuse_max: 5,
  refund_policy: 'net',
  reminder_email_24h: true, reminder_email_2h: true,
  reminder_sms_24h: false, reminder_sms_2h: false,
  min_booking_notice_hours: 1,
  lastminute_enabled: true, lastminute_discount_pct: 20, lastminute_deadline: 'h-24',
  // Also expose last_minute_* aliases — backend checks both prefixes in different code paths.
  last_minute_enabled: true, last_minute_discount_pct: 20, last_minute_deadline: 'h-24',
  // C02: multi-service feature must be enabled on the business to allow service_ids[]
  multi_service_enabled: true,
};

async function seedBusiness() {
  // Schema-adapted: dropped `iban` (n'existe pas), renommé bce → bce_number
  // Fix: stripe_connect_status='active' + plan='pro' pour que shouldRequireDeposit()
  // déclenche (bloquée en plan=free, et retourne false si stripe_connect !== 'active')
  await pool.query(`
    INSERT INTO businesses (
      id, name, slug, email, phone, address, bce_number,
      sector, category, is_test_account, settings,
      stripe_connect_id, stripe_connect_status, plan
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, true, $10, $11, 'active', 'pro')
    ON CONFLICT (id) DO UPDATE SET
      name = EXCLUDED.name, slug = EXCLUDED.slug, email = EXCLUDED.email,
      settings = EXCLUDED.settings, is_test_account = true,
      stripe_connect_id = EXCLUDED.stripe_connect_id,
      stripe_connect_status = 'active',
      plan = 'pro',
      updated_at = NOW()
  `, [
    IDS.BUSINESS, 'TEST — Demo Salon Genda', 'test-demo-salon', 'test-bookt@genda.be',
    '+32491999999', '1 rue du Test, 1000 Bruxelles', 'BE0999999999',
    'coiffeur', 'salon', JSON.stringify(SETTINGS),
    process.env.STRIPE_CONNECT_TEST_ACCOUNT || 'acct_test_e2e_placeholder',
  ]);

  await pool.query(
    `INSERT INTO seed_tracking (entity_type, entity_id) VALUES ('business', $1) ON CONFLICT DO NOTHING`,
    [IDS.BUSINESS]
  );
}

module.exports = { seedBusiness };

if (require.main === module) {
  seedBusiness().then(() => { console.log('✓ business TEST seeded'); process.exit(0); })
    .catch(e => { console.error(e); process.exit(1); });
}
