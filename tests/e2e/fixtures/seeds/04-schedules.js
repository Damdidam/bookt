const { pool } = require('../../../../src/services/db');
const IDS = require('../ids');

/**
 * weekday: 0=Dim, 1=Lun, 2=Mar, 3=Mer, 4=Jeu, 5=Ven, 6=Sam (SMALLINT, CHECK 0..6)
 * Tables: business_schedule (biz) + availabilities (pracs).
 * Strategy DELETE+INSERT car availabilities n'a pas de clé unique utilisable.
 */

const BIZ_HOURS = [
  // Lun-Sam 9h-19h
  { weekday: 1, start: '09:00', end: '19:00' },
  { weekday: 2, start: '09:00', end: '19:00' },
  { weekday: 3, start: '09:00', end: '19:00' },
  { weekday: 4, start: '09:00', end: '19:00' },
  { weekday: 5, start: '09:00', end: '19:00' },
  { weekday: 6, start: '09:00', end: '19:00' },
];

const PRAC_HOURS = {
  // Alice Mar-Sam 9-18 (5 jours)
  [IDS.PRAC_ALICE]: [
    { weekday: 2, start: '09:00', end: '18:00' },
    { weekday: 3, start: '09:00', end: '18:00' },
    { weekday: 4, start: '09:00', end: '18:00' },
    { weekday: 5, start: '09:00', end: '18:00' },
    { weekday: 6, start: '09:00', end: '18:00' },
  ],
  // Bob Lun-Ven 10-19 (5 jours)
  [IDS.PRAC_BOB]: [
    { weekday: 1, start: '10:00', end: '19:00' },
    { weekday: 2, start: '10:00', end: '19:00' },
    { weekday: 3, start: '10:00', end: '19:00' },
    { weekday: 4, start: '10:00', end: '19:00' },
    { weekday: 5, start: '10:00', end: '19:00' },
  ],
  // Carol Mer-Sam 14-20 (4 jours)
  [IDS.PRAC_CAROL]: [
    { weekday: 3, start: '14:00', end: '20:00' },
    { weekday: 4, start: '14:00', end: '20:00' },
    { weekday: 5, start: '14:00', end: '20:00' },
    { weekday: 6, start: '14:00', end: '20:00' },
  ],
};

async function seedSchedules() {
  // Business schedule: unique(business_id, weekday, start_time) → ON CONFLICT OK
  for (const h of BIZ_HOURS) {
    await pool.query(`
      INSERT INTO business_schedule (business_id, weekday, start_time, end_time, is_active)
      VALUES ($1, $2, $3, $4, true)
      ON CONFLICT (business_id, weekday, start_time) DO UPDATE SET
        end_time = EXCLUDED.end_time, is_active = true
    `, [IDS.BUSINESS, h.weekday, h.start, h.end]);
  }

  // Practitioner availabilities: pas de clé unique → DELETE + INSERT
  for (const [pracId, hours] of Object.entries(PRAC_HOURS)) {
    await pool.query(`DELETE FROM availabilities WHERE practitioner_id = $1`, [pracId]);
    for (const h of hours) {
      await pool.query(`
        INSERT INTO availabilities (business_id, practitioner_id, weekday, start_time, end_time, is_active)
        VALUES ($1, $2, $3, $4, $5, true)
      `, [IDS.BUSINESS, pracId, h.weekday, h.start, h.end]);
    }
  }
}

module.exports = { seedSchedules, BIZ_HOURS, PRAC_HOURS };

if (require.main === module) {
  seedSchedules().then(() => { console.log('✓ schedules seeded'); process.exit(0); }).catch(e => { console.error(e); process.exit(1); });
}
