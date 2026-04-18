const { pool } = require('../../../../src/services/db');
const IDS = require('../ids');

/**
 * 5 bookings historiques :
 *  - 3 completed (dont 1 long 2h pour tests CA/statistiques)
 *  - 1 no_show
 *  - 1 cancelled
 *
 * Schema-adapted : `public_token` a un default (gen_random_bytes) → omise.
 * Dates relatives (days avant aujourd'hui) pour rester cohérent avec l'horloge.
 */
function dateOffsetH(days, hour) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  d.setHours(hour, 0, 0, 0);
  return d.toISOString();
}

const BOOKINGS = [
  { id: IDS.BK_COMPLETED_1, days: -30, startH: 10, endH: 11, status: 'completed', prac: IDS.PRAC_ALICE, svc: IDS.SVC_SHORT, client: IDS.CLIENT_MARIE, price: 2500 },
  { id: IDS.BK_COMPLETED_2, days: -20, startH: 14, endH: 16, status: 'completed', prac: IDS.PRAC_ALICE, svc: IDS.SVC_LONG,  client: IDS.CLIENT_MARIE, price: 8000 },
  { id: IDS.BK_COMPLETED_3, days: -7,  startH: 9,  endH: 10, status: 'completed', prac: IDS.PRAC_BOB,   svc: IDS.SVC_SHORT, client: IDS.CLIENT_PAUL,  price: 2500 },
  { id: IDS.BK_NOSHOW_1,    days: -3,  startH: 15, endH: 16, status: 'no_show',   prac: IDS.PRAC_ALICE, svc: IDS.SVC_SHORT, client: IDS.CLIENT_PAUL,  price: 2500 },
  { id: IDS.BK_CANCELLED_1, days: -1,  startH: 10, endH: 11, status: 'cancelled', prac: IDS.PRAC_BOB,   svc: IDS.SVC_SHORT, client: IDS.CLIENT_MARIE, price: 2500 },
];

async function seedBookingsHistorique() {
  for (const b of BOOKINGS) {
    await pool.query(`
      INSERT INTO bookings (
        id, business_id, practitioner_id, service_id, client_id,
        start_at, end_at, status, booked_price_cents, appointment_mode
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'cabinet')
      ON CONFLICT (id) DO UPDATE SET
        start_at = EXCLUDED.start_at,
        end_at = EXCLUDED.end_at,
        status = EXCLUDED.status,
        booked_price_cents = EXCLUDED.booked_price_cents,
        updated_at = NOW()
    `, [
      b.id, IDS.BUSINESS, b.prac, b.svc, b.client,
      dateOffsetH(b.days, b.startH), dateOffsetH(b.days, b.endH),
      b.status, b.price,
    ]);

    await pool.query(
      `INSERT INTO seed_tracking (entity_type, entity_id) VALUES ('booking_historique', $1) ON CONFLICT DO NOTHING`,
      [b.id]
    );
  }
}

module.exports = { seedBookingsHistorique, BOOKINGS };

if (require.main === module) {
  seedBookingsHistorique()
    .then(() => { console.log('✓ 5 bookings historiques seeded'); process.exit(0); })
    .catch(e => { console.error(e); process.exit(1); });
}
