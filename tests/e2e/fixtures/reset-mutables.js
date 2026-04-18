/**
 * Reset entre tests : restaure l'état des entités mutables du seed (GC balances,
 * pass sessions, promo uses, debit transactions). Permet d'utiliser le seed
 * partagé sans contaminer les tests suivants.
 *
 * Appelé via `test.beforeEach(async () => await resetMutables())` dans chaque
 * spec qui touche GC/pass/promos.
 */
const { pool } = require('../../../src/services/db');
const IDS = require('./ids');

async function resetMutables() {
  // 1. GC : restore balance_cents à la valeur initiale du seed (amount_cents pour GC_ACTIVE/GC_EXPIRED,
  //    50% de amount_cents pour GC_PARTIAL pour matcher le seed original)
  await pool.query(
    `UPDATE gift_cards SET balance_cents = amount_cents, status = 'active'
     WHERE id IN ($1, $2)`,
    [IDS.GC_ACTIVE, IDS.GC_EXPIRED]
  );
  // GC_PARTIAL : balance initiale 50€ sur 100€ (retourne à 5000c)
  await pool.query(
    `UPDATE gift_cards SET balance_cents = 5000, status = 'active' WHERE id = $1`,
    [IDS.GC_PARTIAL]
  );
  // GC_EXPIRED reste avec status='expired' (expires_at déjà passé)
  await pool.query(
    `UPDATE gift_cards SET status = 'expired' WHERE id = $1`,
    [IDS.GC_EXPIRED]
  );
  // GC_CANCELLED reste cancelled
  await pool.query(
    `UPDATE gift_cards SET status = 'cancelled' WHERE id = $1`,
    [IDS.GC_CANCELLED]
  );

  // 2. Passes : restore sessions_remaining au seed value
  // PASS_ACTIVE : 5/10, PASS_EXPIRED : 5/10 (but expires J-10), PASS_EMPTY : 0/10
  await pool.query(
    `UPDATE passes SET sessions_remaining = 5, status = 'active' WHERE id IN ($1, $2)`,
    [IDS.PASS_ACTIVE, IDS.PASS_EXPIRED]
  );
  await pool.query(
    `UPDATE passes SET sessions_remaining = 0, status = 'used' WHERE id = $1`,
    [IDS.PASS_EMPTY]
  );

  // 3. Promos : reset current_uses à 0
  await pool.query(
    `UPDATE promotions SET current_uses = 0 WHERE business_id = $1`,
    [IDS.BUSINESS]
  );

  // 4. Delete transactions accumulées (debits GC + pass créés par les tests précédents)
  await pool.query(
    `DELETE FROM gift_card_transactions WHERE business_id = $1 AND type = 'debit'`,
    [IDS.BUSINESS]
  );
  await pool.query(
    `DELETE FROM pass_transactions WHERE business_id = $1 AND type = 'debit'`,
    [IDS.BUSINESS]
  );

  // 5. Delete bookings non-seed (créés par tests précédents) pour éviter les conflits de slot
  await pool.query(
    `DELETE FROM bookings WHERE business_id = $1
     AND id NOT IN (SELECT entity_id FROM seed_tracking WHERE entity_type = 'booking_historique')`,
    [IDS.BUSINESS]
  );

  // 6. Delete clients créés pendant les tests (emails finissent par -test@genda-test.be MAIS ne sont pas seed)
  await pool.query(
    `DELETE FROM clients WHERE business_id = $1
     AND id NOT IN (SELECT entity_id FROM seed_tracking WHERE entity_type = 'client')`,
    [IDS.BUSINESS]
  );
}

module.exports = { resetMutables };
