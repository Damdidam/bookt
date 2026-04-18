const assert = require('assert');

process.env.STRIPE_SECRET_KEY = 'sk_live_fake_0000000000';
process.env.STRIPE_SECRET_KEY_TEST = 'sk_test_fake_0000000000';

const { getStripeClient } = require('../src/services/stripe-client');

const prodBiz = { id: 'uuid-1', is_test_account: false };
const s1 = getStripeClient(prodBiz);
assert(s1, 'FAIL: getStripeClient returned null for prod biz');
console.log('✓ prod biz returns client');

const testBiz = { id: 'uuid-2', is_test_account: true };
const s2 = getStripeClient(testBiz);
assert(s2, 'FAIL: getStripeClient returned null for test biz');
console.log('✓ test biz returns client');

const s3 = getStripeClient(null);
assert(s3, 'FAIL: getStripeClient returned null for null biz');
console.log('✓ null biz returns default client');

delete process.env.STRIPE_SECRET_KEY;
delete process.env.STRIPE_SECRET_KEY_TEST;
try {
  getStripeClient({ id: 'x', is_test_account: false });
  throw new Error('FAIL: should have thrown');
} catch (e) {
  if (!/STRIPE_SECRET_KEY/.test(e.message)) throw new Error('FAIL: wrong error: ' + e.message);
  console.log('✓ throws when key missing');
}

console.log('\n✓ stripe-client valide');
