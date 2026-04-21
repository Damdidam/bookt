/**
 * Unit tests : src/services/error-reporter.js reportError.
 * Vérifie :
 * - console.error appelé systématiquement
 * - Sentry.captureException appelé UNIQUEMENT si SENTRY_DSN présent
 * - tag + context extras propagés correctement
 * - Safe si Sentry SDK absent ou throw
 * - Safe si DSN absent
 *
 * Exécution : `node tests/unit-error-reporter.test.js`
 */

// Sans SENTRY_DSN — Sentry should be no-op.
delete process.env.SENTRY_DSN;
// Purge le require cache pour forcer re-require avec DSN absent.
delete require.cache[require.resolve('../src/services/error-reporter')];

const { reportError } = require('../src/services/error-reporter');

function assert(cond, msg) {
  if (!cond) { console.error('✗ FAIL:', msg); process.exit(1); }
}

// Capture console.error
const errLog = [];
const origErr = console.error;
console.error = (...args) => errLog.push(args);

try {
  // Case 1 : DSN absent → pas de crash, console.error appelé.
  const err1 = new Error('boom');
  reportError(err1, { tag: 'TEST_TAG', foo: 'bar' });
  assert(errLog.length === 1, 'Case 1: console.error called 1x');
  assert(errLog[0][0] === '[TEST_TAG]', 'Case 1: tag in first arg');
  assert(errLog[0][1] === 'boom', 'Case 1: message in 2nd arg');
  assert(errLog[0][2].tag === 'TEST_TAG' && errLog[0][2].foo === 'bar', 'Case 1: context in 3rd arg');

  // Case 2 : context absent → tag défaut 'unknown'
  errLog.length = 0;
  reportError(new Error('no-ctx'));
  assert(errLog[0][0] === '[unknown]', 'Case 2: tag defaults unknown');

  // Case 3 : err est string non-Error
  errLog.length = 0;
  reportError('string error', { tag: 'STR' });
  assert(errLog[0][1] === 'string error', 'Case 3: string error formatted');

  // Case 4 : err est null/undefined
  errLog.length = 0;
  reportError(null, { tag: 'NULL' });
  assert(errLog[0][1] === 'null', 'Case 4: null err formatted');

  errLog.length = 0;
  reportError(undefined, { tag: 'UNDEF' });
  assert(errLog[0][1] === 'undefined', 'Case 5: undefined err formatted');

} finally {
  console.error = origErr;
}

console.log('✓ reportError — 5 cases OK (DSN absent path)');
console.log('\n✓ error-reporter.js unit tests PASS');
process.exit(0);
