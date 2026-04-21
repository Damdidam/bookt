/**
 * Test suite runner : exécute tous les unit tests sans DB/Stripe.
 * Usage : `node tests/unit-services-all.test.js`
 *
 * Pour ajouter un test unitaire : le créer en `tests/unit-<service>.test.js`
 * et ajouter le require ci-dessous.
 */
const { execSync } = require('child_process');
const path = require('path');

const tests = [
  'tests/unit-image-validation.test.js',
  'tests/unit-stripe-refund.test.js',
  'tests/unit-error-reporter.test.js',
];

let fails = 0;
for (const t of tests) {
  try {
    execSync(`node ${t}`, { stdio: 'inherit', cwd: path.join(__dirname, '..') });
  } catch (e) {
    console.error(`\n✗ SUITE FAIL: ${t}`);
    fails++;
  }
}

if (fails > 0) {
  console.error(`\n✗ ${fails}/${tests.length} test files FAILED`);
  process.exit(1);
}
console.log(`\n✓ All ${tests.length} unit test files PASSED`);
process.exit(0);
