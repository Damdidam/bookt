/**
 * Seed orchestrator — runs all sub-seeds in correct FK order.
 * Idempotent: safe to re-run.
 */
const { seedBusiness } = require('./seeds/01-business');
const { seedPractitioners } = require('./seeds/02-practitioners');
const { seedServices } = require('./seeds/03-services');
const { seedSchedules } = require('./seeds/04-schedules');
const { seedClients } = require('./seeds/05-clients');
const { seedPromotions } = require('./seeds/06-promotions');
const { seedGiftCards } = require('./seeds/07-gift-cards');
const { seedPasses } = require('./seeds/08-passes');
const { seedWaitlist } = require('./seeds/09-waitlist');
const { seedBookingsHistorique } = require('./seeds/10-bookings-historique');

async function seedAll() {
  await seedBusiness();
  await seedPractitioners();
  await seedServices();
  await seedSchedules();
  await seedClients();
  await seedPromotions();
  await seedGiftCards();
  await seedPasses();
  await seedWaitlist();
  await seedBookingsHistorique();
}

module.exports = { seedAll };

if (require.main === module) {
  require('dotenv').config({ path: '.env.test' });
  const t0 = Date.now();
  seedAll()
    .then(() => { console.log(`✓ Full seed complete in ${Date.now() - t0}ms`); process.exit(0); })
    .catch(e => { console.error('✗ Seed failed:', e); process.exit(1); });
}
