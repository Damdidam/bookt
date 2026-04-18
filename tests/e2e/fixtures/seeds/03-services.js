const { pool } = require('../../../../src/services/db');
const IDS = require('../ids');

/**
 * 7 services pour couvrir tous les cas (court/long, cheap/expensive, variants, quote, pass).
 */
const SERVICES = [
  { id: IDS.SVC_SHORT,     name: 'Coupe express 15min',        duration_min: 15,  price_cents: 1500,  quote_only: false, promo_eligible: true,  bookable_online: true  },
  { id: IDS.SVC_LONG,      name: 'Soin complet 120min',        duration_min: 120, price_cents: 9500,  quote_only: false, promo_eligible: true,  bookable_online: true  },
  { id: IDS.SVC_CHEAP,     name: 'Lavage 10€',                  duration_min: 20,  price_cents: 1000,  quote_only: false, promo_eligible: false, bookable_online: true  },
  { id: IDS.SVC_EXPENSIVE, name: 'Prestation premium 200€',     duration_min: 60,  price_cents: 20000, quote_only: false, promo_eligible: true,  bookable_online: true  },
  { id: IDS.SVC_VARIANTS,  name: 'Massage (avec variantes)',    duration_min: 60,  price_cents: 6000,  quote_only: false, promo_eligible: true,  bookable_online: true  },
  { id: IDS.SVC_QUOTE,     name: 'Consultation sur devis',      duration_min: 30,  price_cents: null,  quote_only: true,  promo_eligible: false, bookable_online: true  },
  { id: IDS.SVC_PASS,      name: 'Service utilisé avec pass',   duration_min: 45,  price_cents: 5000,  quote_only: false, promo_eligible: true,  bookable_online: true  },
];

const VARIANTS = [
  { id: IDS.VAR_45MIN, service_id: IDS.SVC_VARIANTS, name: 'Massage 45min', duration_min: 45, price_cents: 4500, sort_order: 1 },
  { id: IDS.VAR_60MIN, service_id: IDS.SVC_VARIANTS, name: 'Massage 60min', duration_min: 60, price_cents: 6000, sort_order: 2 },
  { id: IDS.VAR_90MIN, service_id: IDS.SVC_VARIANTS, name: 'Massage 90min', duration_min: 90, price_cents: 8500, sort_order: 3 },
];

// Liens praticien ↔ service : Alice fait tout, Bob fait 4, Carol fait 2.
const PRAC_LINKS = [
  // Alice (owner) — tous les services
  { prac: IDS.PRAC_ALICE, svc: IDS.SVC_SHORT },
  { prac: IDS.PRAC_ALICE, svc: IDS.SVC_LONG },
  { prac: IDS.PRAC_ALICE, svc: IDS.SVC_CHEAP },
  { prac: IDS.PRAC_ALICE, svc: IDS.SVC_EXPENSIVE },
  { prac: IDS.PRAC_ALICE, svc: IDS.SVC_VARIANTS },
  { prac: IDS.PRAC_ALICE, svc: IDS.SVC_QUOTE },
  { prac: IDS.PRAC_ALICE, svc: IDS.SVC_PASS },
  // Bob
  { prac: IDS.PRAC_BOB, svc: IDS.SVC_SHORT },
  { prac: IDS.PRAC_BOB, svc: IDS.SVC_LONG },
  { prac: IDS.PRAC_BOB, svc: IDS.SVC_CHEAP },
  { prac: IDS.PRAC_BOB, svc: IDS.SVC_VARIANTS },
  // Carol
  { prac: IDS.PRAC_CAROL, svc: IDS.SVC_SHORT },
  { prac: IDS.PRAC_CAROL, svc: IDS.SVC_CHEAP },
];

async function seedServices() {
  for (const s of SERVICES) {
    await pool.query(`
      INSERT INTO services (id, business_id, name, duration_min, price_cents, quote_only, promo_eligible, bookable_online, is_active)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, true)
      ON CONFLICT (id) DO UPDATE SET
        name = EXCLUDED.name, duration_min = EXCLUDED.duration_min,
        price_cents = EXCLUDED.price_cents, quote_only = EXCLUDED.quote_only,
        promo_eligible = EXCLUDED.promo_eligible, bookable_online = EXCLUDED.bookable_online,
        updated_at = NOW()
    `, [s.id, IDS.BUSINESS, s.name, s.duration_min, s.price_cents, s.quote_only, s.promo_eligible, s.bookable_online]);

    await pool.query(`INSERT INTO seed_tracking (entity_type, entity_id) VALUES ('service', $1) ON CONFLICT DO NOTHING`, [s.id]);
  }

  for (const v of VARIANTS) {
    await pool.query(`
      INSERT INTO service_variants (id, business_id, service_id, name, duration_min, price_cents, sort_order, is_active)
      VALUES ($1, $2, $3, $4, $5, $6, $7, true)
      ON CONFLICT (id) DO UPDATE SET
        name = EXCLUDED.name, duration_min = EXCLUDED.duration_min,
        price_cents = EXCLUDED.price_cents, sort_order = EXCLUDED.sort_order,
        updated_at = NOW()
    `, [v.id, IDS.BUSINESS, v.service_id, v.name, v.duration_min, v.price_cents, v.sort_order]);

    await pool.query(`INSERT INTO seed_tracking (entity_type, entity_id) VALUES ('service_variant', $1) ON CONFLICT DO NOTHING`, [v.id]);
  }

  for (const l of PRAC_LINKS) {
    await pool.query(`
      INSERT INTO practitioner_services (practitioner_id, service_id)
      VALUES ($1, $2)
      ON CONFLICT (practitioner_id, service_id) DO NOTHING
    `, [l.prac, l.svc]);
  }
}

module.exports = { seedServices, SERVICES, VARIANTS, PRAC_LINKS };

if (require.main === module) {
  seedServices().then(() => { console.log('✓ services seeded'); process.exit(0); }).catch(e => { console.error(e); process.exit(1); });
}
