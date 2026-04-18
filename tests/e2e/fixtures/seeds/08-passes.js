const { pool } = require('../../../../src/services/db');
const IDS = require('../ids');

/**
 * 3 passes couvrant les états:
 * - PASS_ACTIVE:  5/10 sessions restantes, status=active, expires J+90
 * - PASS_EXPIRED: 5/10 sessions (encore valides), status=active, expires J-10
 *                 → cible du cron qui expire les passes non-utilisées
 * - PASS_EMPTY:   0/10 sessions, status=used (toutes consommées), expires J+90
 *
 * Tous liés à SVC_PASS. code unique varchar(12): TESTPASSxxx.
 */
const PASSES = [
  { id: IDS.PASS_ACTIVE,  code: 'TESTPASS01AC', name: 'Pass 10 sessions — actif',      sessions_total: 10, sessions_remaining: 5, status: 'active', expires_days: 90,  stripe_pi: 'pi_test_pass_active' },
  { id: IDS.PASS_EXPIRED, code: 'TESTPASS02EX', name: 'Pass 10 sessions — expiré date', sessions_total: 10, sessions_remaining: 5, status: 'active', expires_days: -10, stripe_pi: 'pi_test_pass_expired' },
  { id: IDS.PASS_EMPTY,   code: 'TESTPASS03EM', name: 'Pass 10 sessions — épuisé',     sessions_total: 10, sessions_remaining: 0, status: 'used',   expires_days: 90,  stripe_pi: 'pi_test_pass_empty' },
];

async function seedPasses() {
  for (const p of PASSES) {
    await pool.query(`
      INSERT INTO passes (
        id, business_id, service_id, code, name,
        sessions_total, sessions_remaining, price_cents,
        buyer_name, buyer_email, status,
        stripe_payment_intent_id, expires_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, 30000,
        'Acheteur Pass Test', 'passbuyer-test@genda-test.be', $8,
        $9, NOW() + ($10 || ' days')::interval
      )
      ON CONFLICT (id) DO UPDATE SET
        code = EXCLUDED.code, name = EXCLUDED.name,
        sessions_total = EXCLUDED.sessions_total,
        sessions_remaining = EXCLUDED.sessions_remaining,
        status = EXCLUDED.status,
        stripe_payment_intent_id = EXCLUDED.stripe_payment_intent_id,
        expires_at = EXCLUDED.expires_at, updated_at = NOW()
    `, [p.id, IDS.BUSINESS, IDS.SVC_PASS, p.code, p.name,
        p.sessions_total, p.sessions_remaining, p.status,
        p.stripe_pi, String(p.expires_days)]);

    await pool.query(`INSERT INTO seed_tracking (entity_type, entity_id) VALUES ('pass', $1) ON CONFLICT DO NOTHING`, [p.id]);
  }
}

module.exports = { seedPasses, PASSES };

if (require.main === module) {
  seedPasses().then(() => { console.log('✓ 3 passes seeded'); process.exit(0); }).catch(e => { console.error(e); process.exit(1); });
}
