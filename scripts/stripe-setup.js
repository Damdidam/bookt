#!/usr/bin/env node
/**
 * Stripe Setup Script for Genda
 * 
 * Creates products and prices in your Stripe account.
 * Run once when setting up Stripe.
 *
 * Usage:
 *   STRIPE_SECRET_KEY=sk_test_... node scripts/stripe-setup.js
 *
 * Output: price IDs to add to your .env
 */

async function main() {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) {
    console.error('❌ Set STRIPE_SECRET_KEY env var first.');
    console.log('   STRIPE_SECRET_KEY=sk_test_... node scripts/stripe-setup.js');
    process.exit(1);
  }

  const stripe = require('stripe')(key);

  console.log('\n🔧 Setting up Genda products in Stripe...\n');

  // 1. Create product
  const product = await stripe.products.create({
    name: 'Genda SaaS',
    description: 'Plateforme de gestion de cabinet pour professions libérales en Belgique',
    metadata: { app: 'genda' }
  });
  console.log(`✅ Product created: ${product.id}`);

  // 2. Create Pro price (39€/month)
  const proPriceMonthly = await stripe.prices.create({
    product: product.id,
    unit_amount: 3900, // 39.00€ in cents
    currency: 'eur',
    recurring: { interval: 'month' },
    metadata: { plan: 'pro' },
    lookup_key: 'genda_pro_monthly'
  });
  console.log(`✅ Pro price (39€/month): ${proPriceMonthly.id}`);

  // 3. Create Premium price (79€/month)
  const premiumPriceMonthly = await stripe.prices.create({
    product: product.id,
    unit_amount: 7900, // 79.00€ in cents
    currency: 'eur',
    recurring: { interval: 'month' },
    metadata: { plan: 'premium' },
    lookup_key: 'genda_premium_monthly'
  });
  console.log(`✅ Premium price (79€/month): ${premiumPriceMonthly.id}`);

  // 4. Configure Customer Portal
  try {
    await stripe.billingPortal.configurations.create({
      business_profile: {
        headline: 'Genda — Gérez votre abonnement'
      },
      features: {
        invoice_history: { enabled: true },
        payment_method_update: { enabled: true },
        subscription_cancel: { enabled: true },
        subscription_update: {
          enabled: true,
          default_allowed_updates: ['price'],
          proration_behavior: 'create_prorations',
          products: [{
            product: product.id,
            prices: [proPriceMonthly.id, premiumPriceMonthly.id]
          }]
        }
      }
    });
    console.log(`✅ Customer Portal configured`);
  } catch (e) {
    console.log(`⚠️  Portal config: ${e.message} (configure manually in Stripe Dashboard)`);
  }

  // Output
  console.log('\n═══════════════════════════════════════════');
  console.log('  Add these to your .env / Render:');
  console.log('═══════════════════════════════════════════\n');
  console.log(`STRIPE_PRICE_PRO=${proPriceMonthly.id}`);
  console.log(`STRIPE_PRICE_PREMIUM=${premiumPriceMonthly.id}`);
  console.log('');
  console.log('Also configure in Stripe Dashboard:');
  console.log('  → Developers > Webhooks > Add endpoint');
  console.log('  → URL: https://genda.be/webhooks/stripe');
  console.log('  → Events: checkout.session.completed,');
  console.log('            customer.subscription.updated,');
  console.log('            customer.subscription.deleted,');
  console.log('            invoice.paid,');
  console.log('            invoice.payment_failed');
  console.log('  → Copy the webhook signing secret (whsec_...)');
  console.log('  → Add as STRIPE_WEBHOOK_SECRET in your env\n');
  console.log('Payment methods to enable in Stripe Dashboard:');
  console.log('  → Settings > Payments > Payment methods');
  console.log('  → Enable: Cards + Bancontact\n');
}

main().catch(err => {
  console.error('❌ Error:', err.message);
  process.exit(1);
});
