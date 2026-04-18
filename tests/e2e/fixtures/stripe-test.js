/**
 * Stripe test helpers : simulation webhooks avec signature valide.
 */
const TEST_CARD_NUMBER = '4242424242424242';
const TEST_CARD_EXPIRY = '1234';
const TEST_CARD_CVC = '123';

function getStripeTest() {
  const key = process.env.STRIPE_SECRET_KEY_TEST || process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error('STRIPE_SECRET_KEY_TEST missing');
  return require('stripe')(key);
}

function buildSignedWebhook(eventType, dataObject) {
  const stripe = getStripeTest();
  const event = {
    id: 'evt_test_' + Date.now(),
    object: 'event',
    type: eventType,
    api_version: '2024-06-20',
    created: Math.floor(Date.now() / 1000),
    data: { object: dataObject },
    livemode: false,
    pending_webhooks: 1,
    request: { id: null, idempotency_key: null }
  };
  const payload = JSON.stringify(event);
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) throw new Error('STRIPE_WEBHOOK_SECRET missing');
  const signature = stripe.webhooks.generateTestHeaderString({ payload, secret });
  return { payload, signature };
}

async function fillTestCard(page) {
  await page.waitForURL(/checkout\.stripe\.com/);
  await page.locator('[autocomplete="cc-number"]').fill(TEST_CARD_NUMBER);
  await page.locator('[autocomplete="cc-exp"]').fill(TEST_CARD_EXPIRY);
  await page.locator('[autocomplete="cc-csc"]').fill(TEST_CARD_CVC);
  await page.locator('[autocomplete="billing cc-name"]').fill('Test Cardholder');
  await page.locator('button[data-testid="hosted-payment-submit-button"]').click();
}

module.exports = { getStripeTest, buildSignedWebhook, fillTestCard, TEST_CARD_NUMBER, TEST_CARD_EXPIRY, TEST_CARD_CVC };
