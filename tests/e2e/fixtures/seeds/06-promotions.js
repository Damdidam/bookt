const { pool } = require('../../../../src/services/db');
const IDS = require('../ids');

/**
 * 7 promotions couvrant tous les types & conditions:
 * - PCT: -20%, condition 'none'
 * - FIXED: -10€, condition min_amount >= 50€
 * - SVC: -30% sur SVC_LONG
 * - FIRST: -15% première visite
 * - DATE: -10% sur plage de date (aujourd'hui → J+30)
 * - FREE: service SVC_CHEAP offert si SVC_LONG réservé
 * - INFO: info_only, pas de réduction
 *
 * CHECK constraints:
 *   reward_type ∈ {free_service, discount_pct, discount_fixed, info_only}
 *   condition_type ∈ {min_amount, specific_service, first_visit, date_range, none}
 */
const todayISO = () => new Date().toISOString().slice(0, 10);
const plusDaysISO = (d) => new Date(Date.now() + d * 86400000).toISOString().slice(0, 10);

const PROMOS = [
  { id: IDS.PROMO_PCT,   title: 'Promo 20%',           reward_type: 'discount_pct',   reward_value: 20,   reward_service_id: null,            condition_type: 'none',             condition_min_cents: null, condition_service_id: null,       condition_start_date: null,     condition_end_date: null },
  { id: IDS.PROMO_FIXED, title: 'Promo 10€',           reward_type: 'discount_fixed', reward_value: 1000, reward_service_id: null,            condition_type: 'min_amount',       condition_min_cents: 5000, condition_service_id: null,       condition_start_date: null,     condition_end_date: null },
  { id: IDS.PROMO_SVC,   title: 'Coloration -30%',     reward_type: 'discount_pct',   reward_value: 30,   reward_service_id: null,            condition_type: 'specific_service', condition_min_cents: null, condition_service_id: IDS.SVC_LONG, condition_start_date: null,     condition_end_date: null },
  { id: IDS.PROMO_FIRST, title: 'Bienvenue -15%',      reward_type: 'discount_pct',   reward_value: 15,   reward_service_id: null,            condition_type: 'first_visit',      condition_min_cents: null, condition_service_id: null,       condition_start_date: null,     condition_end_date: null },
  { id: IDS.PROMO_DATE,  title: 'Printemps -10%',      reward_type: 'discount_pct',   reward_value: 10,   reward_service_id: null,            condition_type: 'date_range',       condition_min_cents: null, condition_service_id: null,       condition_start_date: todayISO(), condition_end_date: plusDaysISO(30) },
  { id: IDS.PROMO_FREE,  title: 'Barbe offerte',       reward_type: 'free_service',   reward_value: null, reward_service_id: IDS.SVC_CHEAP,   condition_type: 'specific_service', condition_min_cents: null, condition_service_id: IDS.SVC_LONG, condition_start_date: null,     condition_end_date: null },
  { id: IDS.PROMO_INFO,  title: 'Nouveauté',           reward_type: 'info_only',      reward_value: null, reward_service_id: null,            condition_type: 'none',             condition_min_cents: null, condition_service_id: null,       condition_start_date: null,     condition_end_date: null },
];

async function seedPromotions() {
  for (const p of PROMOS) {
    await pool.query(`
      INSERT INTO promotions (
        id, business_id, title, reward_type, reward_value, reward_service_id,
        condition_type, condition_min_cents, condition_service_id,
        condition_start_date, condition_end_date,
        is_active, current_uses, max_uses, sort_order
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, true, 0, 100, 0)
      ON CONFLICT (id) DO UPDATE SET
        title = EXCLUDED.title, reward_type = EXCLUDED.reward_type,
        reward_value = EXCLUDED.reward_value, reward_service_id = EXCLUDED.reward_service_id,
        condition_type = EXCLUDED.condition_type,
        condition_min_cents = EXCLUDED.condition_min_cents,
        condition_service_id = EXCLUDED.condition_service_id,
        condition_start_date = EXCLUDED.condition_start_date,
        condition_end_date = EXCLUDED.condition_end_date,
        is_active = true, current_uses = 0, updated_at = NOW()
    `, [
      p.id, IDS.BUSINESS, p.title, p.reward_type, p.reward_value, p.reward_service_id,
      p.condition_type, p.condition_min_cents, p.condition_service_id,
      p.condition_start_date, p.condition_end_date,
    ]);

    await pool.query(`INSERT INTO seed_tracking (entity_type, entity_id) VALUES ('promotion', $1) ON CONFLICT DO NOTHING`, [p.id]);
  }
}

module.exports = { seedPromotions, PROMOS };

if (require.main === module) {
  seedPromotions().then(() => { console.log('✓ 7 promos seeded'); process.exit(0); }).catch(e => { console.error(e); process.exit(1); });
}
