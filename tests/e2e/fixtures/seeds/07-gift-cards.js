const { pool } = require('../../../../src/services/db');
const IDS = require('../ids');

/**
 * 4 gift cards couvrant tous les états:
 * - GC_ACTIVE:    100€ amount, 100€ balance, status=active, expires J+365
 * - GC_PARTIAL:   100€ amount, 50€ balance (déjà utilisée partiellement), expires J+365
 * - GC_EXPIRED:   100€ amount, 100€ balance, status=expired, expires J-30
 * - GC_CANCELLED: 50€ amount, 50€ balance, status=cancelled, no stripe_PI
 *
 * code est varchar(12) UNIQUE: codes déterministes TESTGCxx.
 */
const GCS = [
  { id: IDS.GC_ACTIVE,    code: 'TESTGC01ACTV', amount_cents: 10000, balance_cents: 10000, status: 'active',    expires_days: 365,  stripe_pi: 'pi_test_gc_active' },
  { id: IDS.GC_PARTIAL,   code: 'TESTGC02PART', amount_cents: 10000, balance_cents: 5000,  status: 'active',    expires_days: 365,  stripe_pi: 'pi_test_gc_partial' },
  { id: IDS.GC_EXPIRED,   code: 'TESTGC03EXPD', amount_cents: 10000, balance_cents: 10000, status: 'expired',   expires_days: -30,  stripe_pi: 'pi_test_gc_expired' },
  { id: IDS.GC_CANCELLED, code: 'TESTGC04CNCL', amount_cents: 5000,  balance_cents: 5000,  status: 'cancelled', expires_days: 365,  stripe_pi: null },
];

async function seedGiftCards() {
  for (const gc of GCS) {
    await pool.query(`
      INSERT INTO gift_cards (
        id, business_id, code, amount_cents, balance_cents, status,
        buyer_name, buyer_email, recipient_name, recipient_email,
        stripe_payment_intent_id, expires_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6,
        'Acheteur Test', 'buyer-test@genda-test.be',
        'Destinataire Test', 'gift-test@genda-test.be',
        $7, NOW() + ($8 || ' days')::interval
      )
      ON CONFLICT (id) DO UPDATE SET
        code = EXCLUDED.code, amount_cents = EXCLUDED.amount_cents,
        balance_cents = EXCLUDED.balance_cents, status = EXCLUDED.status,
        stripe_payment_intent_id = EXCLUDED.stripe_payment_intent_id,
        expires_at = EXCLUDED.expires_at, updated_at = NOW()
    `, [gc.id, IDS.BUSINESS, gc.code, gc.amount_cents, gc.balance_cents, gc.status,
        gc.stripe_pi, String(gc.expires_days)]);

    await pool.query(`INSERT INTO seed_tracking (entity_type, entity_id) VALUES ('gift_card', $1) ON CONFLICT DO NOTHING`, [gc.id]);
  }
}

module.exports = { seedGiftCards, GCS };

if (require.main === module) {
  seedGiftCards().then(() => { console.log('✓ 4 gift cards seeded'); process.exit(0); }).catch(e => { console.error(e); process.exit(1); });
}
