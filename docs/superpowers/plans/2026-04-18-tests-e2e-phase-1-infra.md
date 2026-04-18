# Tests E2E Genda — Phase 1 (Infrastructure) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Livrer l'infrastructure complète (DB migrations, mocks, Stripe refactor, seed, Playwright config, CI) permettant à Phase 2-5 d'écrire les 180 tests E2E.

**Architecture:** Pattern "tests DB-assisted" : seed script idempotent crée un business TEST persistant (flag `is_test_account`), mocks Brevo/Twilio via flag env écrivent dans `test_mock_log`, Stripe utilise clé test pour le business TEST. Playwright Test natif, série 1 worker, cleanup par timestamp.

**Tech Stack:** @playwright/test, pg (déjà), dotenv (déjà). Migration via ALTER IF NOT EXISTS dans `src/server.js` (pattern existant schema-v69 à v72).

---

## File Structure

**Nouveaux fichiers (24) :**

| Chemin | Responsabilité |
|---|---|
| `src/services/stripe-client.js` | Helper central `getStripeClient(business)` business-scoped |
| `tests/e2e/playwright.config.js` | Config Playwright : serial, retry=0, timeout, reporter HTML, globalSetup/Teardown |
| `tests/e2e/global-setup.js` | Pré-run : détection orphans + seed bootstrap, set TEST_RUN_START_TS |
| `tests/e2e/global-teardown.js` | Post-run : DELETE ordonné (FK-safe) + résumé console coloré |
| `tests/e2e/fixtures/ids.js` | UUIDs déterministes exportés (TEST_IDS) |
| `tests/e2e/fixtures/seed.js` | Orchestrateur : appelle seeds/01..10 dans l'ordre |
| `tests/e2e/fixtures/seeds/01-business.js` | UPSERT business TEST + settings |
| `tests/e2e/fixtures/seeds/02-practitioners.js` | UPSERT 3 praticiens + skills |
| `tests/e2e/fixtures/seeds/03-services.js` | UPSERT 7 services (dont 1 avec variants) |
| `tests/e2e/fixtures/seeds/04-schedules.js` | UPSERT horaires business + praticiens |
| `tests/e2e/fixtures/seeds/05-clients.js` | UPSERT 3 clients (Jean/Marie/Paul) |
| `tests/e2e/fixtures/seeds/06-promotions.js` | UPSERT 7 promotions |
| `tests/e2e/fixtures/seeds/07-gift-cards.js` | UPSERT 4 GC (active/partial/expired/cancelled) |
| `tests/e2e/fixtures/seeds/08-passes.js` | UPSERT 3 passes (active/expired/empty) |
| `tests/e2e/fixtures/seeds/09-waitlist.js` | UPSERT 2 waitlist entries |
| `tests/e2e/fixtures/seeds/10-bookings-historique.js` | UPSERT 5 bookings complétés/cancelled/noshow |
| `tests/e2e/fixtures/api-client.js` | Helpers fetch auth staff/public |
| `tests/e2e/fixtures/stripe-test.js` | Helpers carte 4242 + webhook signature |
| `tests/e2e/smoke.spec.js` | 1 test trivial pour valider l'infra |
| `tests/README.md` | Doc usage (bootstrap, run, report, cleanup) |
| `scripts/test-cleanup-force.js` | Cleanup manuel interactif avec confirmation |
| `scripts/test-nuke.js` | Reset nucléaire (confirmation NUKE × 2) |
| `.env.test.example` | Template env vars (gitignored en vrai) |
| `.github/workflows/e2e.yml` | Workflow GHA trigger manuel (workflow_dispatch) |

**Fichiers modifiés (5) :**

| Chemin | Modification |
|---|---|
| `src/server.js` | Ajouter bloc schema-v73 (col + 2 tables) après v72 |
| `src/services/email-utils.js` | Patch début `sendEmail()` : si SKIP_EMAIL=1, INSERT test_mock_log + return mock |
| `src/services/sms.js` | Patch début `sendSMS()` : si SKIP_SMS=1, INSERT test_mock_log + return mock |
| `src/routes/staff/stripe.js` | Refactor `getStripe()` → utiliser `getStripeClient` (central helper) |
| `package.json` | Ajouter scripts `test:e2e*` |
| `.gitignore` | Ajouter `.env.test`, `tests/e2e/playwright-report/`, `tests/e2e/test-results/` |

**NOTE sur Stripe refactor :** 18 sites appellent `require('stripe')` directement. La Phase 1 introduit `stripe-client.js` mais **ne refactore PAS les 18 sites** — ils continuent à utiliser `require('stripe')(process.env.STRIPE_SECRET_KEY)`. La raison : ces 18 sites lisent tous la même env var, donc si on positionne `STRIPE_SECRET_KEY=sk_test_XXX` dans `.env.test`, tous passent en mode test. La seule condition : les tests tournent avec env pointant sur la clé test. Le helper `stripe-client.js` est préparé pour Phase 2+ si on veut du business-scoped (business TEST vs autres businesses sur même instance). Pour Phase 1 : on utilise env switch global.

Ce choix simplifie drastiquement Phase 1 (pas de refacto 18 fichiers) sans perdre la capacité tests en Phase 2.

---

## Task 1 : Migration schema-v73 (col is_test_account + 2 tables)

**Files:**
- Modify: `src/server.js:553-574` (bloc auto-migrate existant)

- [ ] **Step 1: Écrire le test de la migration**

Crée `tests/migration-v73.test.js` :

```js
// tests/migration-v73.test.js
// Run manuellement après boot : node tests/migration-v73.test.js
const { pool } = require('../src/services/db');

(async () => {
  // 1. Col is_test_account existe sur businesses
  const col = await pool.query(`
    SELECT column_name, data_type, column_default
    FROM information_schema.columns
    WHERE table_name = 'businesses' AND column_name = 'is_test_account'
  `);
  if (col.rows.length === 0) throw new Error('FAIL: is_test_account col missing');
  if (col.rows[0].data_type !== 'boolean') throw new Error('FAIL: wrong type');
  if (col.rows[0].column_default !== 'false') throw new Error('FAIL: wrong default');
  console.log('✓ businesses.is_test_account OK');

  // 2. Table seed_tracking existe
  const t1 = await pool.query(`SELECT to_regclass('seed_tracking') AS tbl`);
  if (!t1.rows[0].tbl) throw new Error('FAIL: seed_tracking table missing');
  console.log('✓ seed_tracking table OK');

  // 3. Table test_mock_log existe
  const t2 = await pool.query(`SELECT to_regclass('test_mock_log') AS tbl`);
  if (!t2.rows[0].tbl) throw new Error('FAIL: test_mock_log table missing');
  console.log('✓ test_mock_log table OK');

  // 4. Index idx_businesses_test existe
  const idx = await pool.query(`
    SELECT indexname FROM pg_indexes
    WHERE tablename = 'businesses' AND indexname = 'idx_businesses_test'
  `);
  if (idx.rows.length === 0) throw new Error('FAIL: idx_businesses_test missing');
  console.log('✓ idx_businesses_test OK');

  console.log('\n✓ Migration v73 valide');
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
```

- [ ] **Step 2: Run test pour voir FAIL (avant migration)**

```bash
node tests/migration-v73.test.js
```

Expected : `FAIL: is_test_account col missing` (ou similar).

- [ ] **Step 3: Ajouter la migration dans src/server.js après schema-v72**

Dans `src/server.js`, après la ligne 573 (`'email_giftcard_expiry_warning','email_pass_expiry_warning'`) et avant le `})`` du CHECK CONSTRAINT notifications, ajouter le bloc suivant juste après le catch `schema-v69 auto-migrate` :

Edit le fichier `src/server.js` — après le bloc `try { ... } catch (e) { console.warn('  ⚠ schema-v69 auto-migrate:', e.message); }`, ajouter :

```js
  // schema-v73 (E2E tests infra): is_test_account flag + seed_tracking + test_mock_log
  try {
    await pool.query(`ALTER TABLE businesses ADD COLUMN IF NOT EXISTS is_test_account BOOLEAN NOT NULL DEFAULT false`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_businesses_test ON businesses(is_test_account) WHERE is_test_account = true`);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS seed_tracking (
        entity_type TEXT NOT NULL,
        entity_id UUID NOT NULL,
        seeded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (entity_type, entity_id)
      )
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS test_mock_log (
        id SERIAL PRIMARY KEY,
        type TEXT NOT NULL,
        kind TEXT,
        recipient TEXT,
        payload JSONB NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_test_mock_log_lookup ON test_mock_log (type, created_at DESC)`);
  } catch (e) { console.warn('  ⚠ schema-v73 auto-migrate:', e.message); }
```

- [ ] **Step 4: Restart server + re-run test**

```bash
# Restart Render deploy OU en local :
npm run dev &
sleep 5
node tests/migration-v73.test.js
```

Expected : `✓ Migration v73 valide`

- [ ] **Step 5: Commit**

```bash
git add src/server.js tests/migration-v73.test.js
git commit -m "feat(e2e-infra): schema-v73 — is_test_account + seed_tracking + test_mock_log"
```

---

## Task 2 : Central Stripe client helper

**Files:**
- Create: `src/services/stripe-client.js`
- Test: Runtime probe inline

- [ ] **Step 1: Écrire le test runtime inline**

Crée `tests/stripe-client.test.js` :

```js
const assert = require('assert');

// Mock env
process.env.STRIPE_SECRET_KEY = 'sk_live_fake';
process.env.STRIPE_SECRET_KEY_TEST = 'sk_test_fake';

const { getStripeClient } = require('../src/services/stripe-client');

// Cas 1 : business sans flag → live key
const prodBiz = { id: 'uuid-1', is_test_account: false };
const s1 = getStripeClient(prodBiz);
// Stripe client expose _api.auth qui contient la clé (selon version). On teste via une opération mockable.
// Plus simple : on vérifie que ça ne throw pas.
assert(s1, 'FAIL: getStripeClient returned null for prod biz');
console.log('✓ prod biz returns client');

// Cas 2 : business avec flag → test key
const testBiz = { id: 'uuid-2', is_test_account: true };
const s2 = getStripeClient(testBiz);
assert(s2, 'FAIL: getStripeClient returned null for test biz');
console.log('✓ test biz returns client');

// Cas 3 : null business → par défaut prod
const s3 = getStripeClient(null);
assert(s3, 'FAIL: getStripeClient returned null for null biz');
console.log('✓ null biz returns default (prod) client');

// Cas 4 : pas de clé env → throw
delete process.env.STRIPE_SECRET_KEY;
try {
  getStripeClient({ id: 'x', is_test_account: false });
  throw new Error('FAIL: should have thrown');
} catch (e) {
  if (!/STRIPE_SECRET_KEY/.test(e.message)) throw new Error('FAIL: wrong error');
  console.log('✓ throws when key missing');
}

console.log('\n✓ stripe-client valide');
```

- [ ] **Step 2: Run test → FAIL**

```bash
node tests/stripe-client.test.js
```

Expected : `Error: Cannot find module '../src/services/stripe-client'`

- [ ] **Step 3: Créer le helper**

Crée `src/services/stripe-client.js` :

```js
/**
 * Central Stripe client helper.
 * For Phase 1 infra : reads STRIPE_SECRET_KEY globally (tests set it to test key via .env.test).
 * The `business` parameter is accepted for Phase 2+ compatibility (business-scoped keys),
 * currently routed to global env.
 *
 * @param {object|null} business - business row (may contain is_test_account)
 * @returns {object} stripe SDK instance
 */
function getStripeClient(business) {
  const useTestKey = business?.is_test_account === true;
  const key = useTestKey
    ? (process.env.STRIPE_SECRET_KEY_TEST || process.env.STRIPE_SECRET_KEY)
    : process.env.STRIPE_SECRET_KEY;
  if (!key) {
    throw new Error('STRIPE_SECRET_KEY missing in env');
  }
  return require('stripe')(key);
}

module.exports = { getStripeClient };
```

- [ ] **Step 4: Run test → PASS**

```bash
node tests/stripe-client.test.js
```

Expected : `✓ stripe-client valide`

- [ ] **Step 5: Commit**

```bash
git add src/services/stripe-client.js tests/stripe-client.test.js
git commit -m "feat(e2e-infra): helper central getStripeClient pour business-scoped Stripe"
```

---

## Task 3 : Mock SKIP_EMAIL dans sendEmail

**Files:**
- Modify: `src/services/email-utils.js:102-111`
- Test: `tests/mock-email.test.js`

- [ ] **Step 1: Écrire le test**

Crée `tests/mock-email.test.js` :

```js
process.env.SKIP_EMAIL = '1';
const assert = require('assert');
const { pool } = require('../src/services/db');
const { sendEmail } = require('../src/services/email-utils');

(async () => {
  // Cleanup preexisting mock logs
  await pool.query(`DELETE FROM test_mock_log WHERE type='email'`);

  const result = await sendEmail({
    to: 'mock-test@genda-test.be',
    subject: 'Test Mock',
    html: '<p>Hello</p>'
  });

  assert(result.mocked === true, 'FAIL: result.mocked should be true');
  assert(result.success === true, 'FAIL: result.success should be true');
  console.log('✓ sendEmail returned mocked=true');

  const logs = await pool.query(
    `SELECT * FROM test_mock_log WHERE type='email' AND recipient=$1 ORDER BY created_at DESC LIMIT 1`,
    ['mock-test@genda-test.be']
  );
  assert(logs.rows.length === 1, 'FAIL: no log row inserted');
  assert(logs.rows[0].payload.subject === 'Test Mock', 'FAIL: subject not stored');
  assert(logs.rows[0].payload.html === '<p>Hello</p>', 'FAIL: html not stored');
  console.log('✓ test_mock_log row inserted correctly');

  await pool.query(`DELETE FROM test_mock_log WHERE recipient='mock-test@genda-test.be'`);
  console.log('\n✓ sendEmail mock valide');
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
```

- [ ] **Step 2: Run test → FAIL**

```bash
SKIP_EMAIL=1 node tests/mock-email.test.js
```

Expected : `FAIL: result.mocked should be true` (sendEmail retourne actuellement `{success:false, error:'BREVO_API_KEY not configured'}` ou fait un vrai call).

- [ ] **Step 3: Patcher src/services/email-utils.js**

Dans `src/services/email-utils.js`, juste après la ligne `if (opts.replyTo && !EMAIL_RE.test(opts.replyTo)) delete opts.replyTo;` (ligne 105), ajouter :

```js
  // E2E mock : intercept avant appel Brevo
  if (process.env.SKIP_EMAIL === '1') {
    try {
      const { query } = require('./db');
      await query(
        `INSERT INTO test_mock_log (type, kind, recipient, payload) VALUES ('email', $1, $2, $3)`,
        [opts.template || opts.subject?.slice(0, 50) || 'unknown', opts.to, JSON.stringify(opts)]
      );
    } catch (e) { console.warn('[MOCK EMAIL] Log error:', e.message); }
    return { success: true, mocked: true, messageId: 'mock-' + Date.now() };
  }
```

- [ ] **Step 4: Run test → PASS**

```bash
SKIP_EMAIL=1 node tests/mock-email.test.js
```

Expected : `✓ sendEmail mock valide`

- [ ] **Step 5: Commit**

```bash
git add src/services/email-utils.js tests/mock-email.test.js
git commit -m "feat(e2e-infra): SKIP_EMAIL=1 mock vers test_mock_log"
```

---

## Task 4 : Mock SKIP_SMS dans sendSMS

**Files:**
- Modify: `src/services/sms.js:18-38`
- Test: `tests/mock-sms.test.js`

- [ ] **Step 1: Écrire le test**

Crée `tests/mock-sms.test.js` :

```js
process.env.SKIP_SMS = '1';
const assert = require('assert');
const { pool } = require('../src/services/db');
const { sendSMS } = require('../src/services/sms');

(async () => {
  await pool.query(`DELETE FROM test_mock_log WHERE type='sms'`);

  const result = await sendSMS({
    to: '+32491000001',
    body: 'Test Mock SMS',
    businessId: null
  });

  assert(result.mocked === true, 'FAIL: result.mocked should be true');
  assert(result.success === true, 'FAIL: result.success should be true');
  console.log('✓ sendSMS returned mocked=true');

  const logs = await pool.query(
    `SELECT * FROM test_mock_log WHERE type='sms' AND recipient=$1 ORDER BY created_at DESC LIMIT 1`,
    ['+32491000001']
  );
  assert(logs.rows.length === 1, 'FAIL: no log row inserted');
  assert(logs.rows[0].payload.body === 'Test Mock SMS', 'FAIL: body not stored');
  console.log('✓ test_mock_log row inserted');

  await pool.query(`DELETE FROM test_mock_log WHERE recipient='+32491000001'`);
  console.log('\n✓ sendSMS mock valide');
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
```

- [ ] **Step 2: Run test → FAIL**

```bash
SKIP_SMS=1 node tests/mock-sms.test.js
```

Expected : `FAIL: result.mocked should be true`

- [ ] **Step 3: Patcher src/services/sms.js**

Dans `src/services/sms.js`, après la ligne `if (!to || !body) { return { success: false, error: 'Missing to or body' }; }` (ligne 25), ajouter :

```js
  // E2E mock : intercept avant appel Twilio
  if (process.env.SKIP_SMS === '1') {
    try {
      await query(
        `INSERT INTO test_mock_log (type, kind, recipient, payload) VALUES ('sms', $1, $2, $3)`,
        ['sms', to, JSON.stringify({ to, body, businessId, from, consentSms, clientId })]
      );
    } catch (e) { console.warn('[MOCK SMS] Log error:', e.message); }
    return { success: true, mocked: true, sid: 'mock-' + Date.now() };
  }
```

- [ ] **Step 4: Run test → PASS**

```bash
SKIP_SMS=1 node tests/mock-sms.test.js
```

Expected : `✓ sendSMS mock valide`

- [ ] **Step 5: Commit**

```bash
git add src/services/sms.js tests/mock-sms.test.js
git commit -m "feat(e2e-infra): SKIP_SMS=1 mock vers test_mock_log"
```

---

## Task 5 : Install Playwright

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Installer Playwright**

```bash
cd /Users/Hakim/Desktop/bookt
npm install --save-dev @playwright/test@latest
npx playwright install chromium
```

Expected : `package.json` devrait contenir `"@playwright/test": "^1.x"` dans `devDependencies`.

- [ ] **Step 2: Vérifier l'install**

```bash
npx playwright --version
```

Expected : `Version 1.xx.x` (ou équivalent).

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "feat(e2e-infra): install @playwright/test + chromium browser"
```

---

## Task 6 : UUIDs déterministes (fixtures/ids.js)

**Files:**
- Create: `tests/e2e/fixtures/ids.js`

- [ ] **Step 1: Créer le fichier**

Crée `tests/e2e/fixtures/ids.js` :

```js
/**
 * UUIDs fixes déterministes pour toutes les entités seed.
 * Format: 00000000-0000-4000-8000-XXXXXXXXXXXX (version 4 UUID pattern)
 * Les tests référencent ces IDs sans query DB → reproductibilité totale.
 */
module.exports = {
  // Business
  BUSINESS: '00000000-0000-4000-8000-000000000001',

  // Praticiens
  PRAC_ALICE: '00000000-0000-4000-8000-000000000010',
  PRAC_BOB: '00000000-0000-4000-8000-000000000011',
  PRAC_CAROL: '00000000-0000-4000-8000-000000000012',

  // Services
  SVC_SHORT: '00000000-0000-4000-8000-000000000100',
  SVC_LONG: '00000000-0000-4000-8000-000000000101',
  SVC_CHEAP: '00000000-0000-4000-8000-000000000102',
  SVC_EXPENSIVE: '00000000-0000-4000-8000-000000000103',
  SVC_VARIANTS: '00000000-0000-4000-8000-000000000104',
  SVC_QUOTE: '00000000-0000-4000-8000-000000000105',
  SVC_PASS: '00000000-0000-4000-8000-000000000106',

  // Service variants (pour SVC_VARIANTS)
  VAR_45MIN: '00000000-0000-4000-8000-000000000140',
  VAR_60MIN: '00000000-0000-4000-8000-000000000141',
  VAR_90MIN: '00000000-0000-4000-8000-000000000142',

  // Clients
  CLIENT_JEAN: '00000000-0000-4000-8000-000000000200',
  CLIENT_MARIE: '00000000-0000-4000-8000-000000000201',
  CLIENT_PAUL: '00000000-0000-4000-8000-000000000202',

  // Promotions
  PROMO_PCT: '00000000-0000-4000-8000-000000000300',
  PROMO_FIXED: '00000000-0000-4000-8000-000000000301',
  PROMO_SVC: '00000000-0000-4000-8000-000000000302',
  PROMO_FIRST: '00000000-0000-4000-8000-000000000303',
  PROMO_DATE: '00000000-0000-4000-8000-000000000304',
  PROMO_FREE: '00000000-0000-4000-8000-000000000305',
  PROMO_INFO: '00000000-0000-4000-8000-000000000306',

  // Gift cards
  GC_ACTIVE: '00000000-0000-4000-8000-000000000400',
  GC_PARTIAL: '00000000-0000-4000-8000-000000000401',
  GC_EXPIRED: '00000000-0000-4000-8000-000000000402',
  GC_CANCELLED: '00000000-0000-4000-8000-000000000403',

  // Passes
  PASS_ACTIVE: '00000000-0000-4000-8000-000000000500',
  PASS_EXPIRED: '00000000-0000-4000-8000-000000000501',
  PASS_EMPTY: '00000000-0000-4000-8000-000000000502',

  // Waitlist
  WL_JEAN: '00000000-0000-4000-8000-000000000600',
  WL_MARIE: '00000000-0000-4000-8000-000000000601',

  // Bookings historiques
  BK_COMPLETED_1: '00000000-0000-4000-8000-000000000700',
  BK_COMPLETED_2: '00000000-0000-4000-8000-000000000701',
  BK_COMPLETED_3: '00000000-0000-4000-8000-000000000702',
  BK_NOSHOW_1: '00000000-0000-4000-8000-000000000703',
  BK_CANCELLED_1: '00000000-0000-4000-8000-000000000704',

  // User accounts (owners + staff) pour login tests
  USER_ALICE_OWNER: '00000000-0000-4000-8000-000000000800',
  USER_BOB_STAFF: '00000000-0000-4000-8000-000000000801',
  USER_CAROL_STAFF: '00000000-0000-4000-8000-000000000802',
};
```

- [ ] **Step 2: Vérifier le fichier**

```bash
node -e "const ids=require('./tests/e2e/fixtures/ids'); console.log('Count:', Object.keys(ids).length)"
```

Expected : `Count: 37` (approximatif, selon le nombre exact d'entités).

- [ ] **Step 3: Commit**

```bash
git add tests/e2e/fixtures/ids.js
git commit -m "feat(e2e-infra): UUIDs déterministes TEST_IDS pour 37 entités seed"
```

---

## Task 7 : Seed 01 — Business TEST

**Files:**
- Create: `tests/e2e/fixtures/seeds/01-business.js`

- [ ] **Step 1: Écrire le test runtime**

Crée `tests/seed-01-business.test.js` :

```js
const assert = require('assert');
const { pool } = require('../src/services/db');
const { seedBusiness } = require('./e2e/fixtures/seeds/01-business');
const TEST_IDS = require('./e2e/fixtures/ids');

(async () => {
  await seedBusiness();

  const r = await pool.query(`SELECT * FROM businesses WHERE id = $1`, [TEST_IDS.BUSINESS]);
  assert(r.rows.length === 1, 'FAIL: business not found');
  assert(r.rows[0].is_test_account === true, 'FAIL: is_test_account !== true');
  assert(r.rows[0].slug === 'test-demo-salon', 'FAIL: slug mismatch');
  assert(r.rows[0].settings !== null, 'FAIL: settings null');
  console.log('✓ business seed valide');

  // Idempotence : second run ne fail pas
  await seedBusiness();
  const r2 = await pool.query(`SELECT COUNT(*) AS c FROM businesses WHERE id = $1`, [TEST_IDS.BUSINESS]);
  assert(parseInt(r2.rows[0].c) === 1, 'FAIL: idempotence broken (duplicate)');
  console.log('✓ idempotent (2nd run OK)');

  console.log('\n✓ seed-01-business OK');
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
```

- [ ] **Step 2: Run test → FAIL**

```bash
node tests/seed-01-business.test.js
```

Expected : `Cannot find module './e2e/fixtures/seeds/01-business'`.

- [ ] **Step 3: Créer le seed**

Crée `tests/e2e/fixtures/seeds/01-business.js` :

```js
const { pool } = require('../../../../src/services/db');
const TEST_IDS = require('../ids');

const SETTINGS = {
  // Deposit
  deposit_enabled: true,
  deposit_type: 'percent',
  deposit_percent: 50,
  deposit_fixed_cents: 2500,
  deposit_deadline_hours: 48,
  deposit_noshow_threshold: 2,
  deposit_price_threshold_cents: 5000,      // 50€
  deposit_duration_threshold_min: 60,
  deposit_threshold_mode: 'any',
  deposit_deduct: true,
  deposit_message: 'Un acompte de 50% est requis pour confirmer votre réservation.',
  // Cancel policy
  cancel_deadline_hours: 24,
  cancel_grace_minutes: 240,                 // 4h
  cancel_policy_text: 'Annulation gratuite jusqu\'à 24h avant.',
  cancel_abuse_enabled: true,
  cancel_abuse_max: 5,
  // Refund
  refund_policy: 'net',
  // Reminders
  reminder_email_24h: true,
  reminder_email_2h: true,
  reminder_sms_24h: false,
  reminder_sms_2h: false,
  // Min booking notice
  min_booking_notice_hours: 1,
  // Last minute
  lastminute_enabled: true,
  lastminute_discount_pct: 20,
  lastminute_deadline: 'h-24',
};

async function seedBusiness() {
  await pool.query(`
    INSERT INTO businesses (
      id, name, slug, email, phone, address, bce, iban,
      sector, category, is_test_account, settings, plan,
      stripe_account_id, stripe_connect_status
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, true, $11, 'pro', $12, 'active')
    ON CONFLICT (id) DO UPDATE SET
      name = EXCLUDED.name,
      slug = EXCLUDED.slug,
      email = EXCLUDED.email,
      settings = EXCLUDED.settings,
      is_test_account = true,
      updated_at = NOW()
  `, [
    TEST_IDS.BUSINESS,
    'TEST — Demo Salon Genda',
    'test-demo-salon',
    'test-bookt@genda.be',
    '+32491999999',
    '1 rue du Test, 1000 Bruxelles',
    'BE0999999999',
    'BE68539007547034',
    'coiffeur',
    'salon',
    JSON.stringify(SETTINGS),
    process.env.STRIPE_CONNECT_TEST_ACCOUNT || 'acct_test_placeholder',
  ]);

  await pool.query(`
    INSERT INTO seed_tracking (entity_type, entity_id) VALUES ('business', $1)
    ON CONFLICT DO NOTHING
  `, [TEST_IDS.BUSINESS]);
}

module.exports = { seedBusiness };

// CLI usage
if (require.main === module) {
  seedBusiness()
    .then(() => { console.log('✓ business TEST seeded'); process.exit(0); })
    .catch(e => { console.error(e); process.exit(1); });
}
```

- [ ] **Step 4: Run test → PASS**

```bash
node tests/seed-01-business.test.js
```

Expected : `✓ seed-01-business OK`

- [ ] **Step 5: Commit**

```bash
git add tests/e2e/fixtures/seeds/01-business.js tests/seed-01-business.test.js
git commit -m "feat(e2e-infra): seed 01 business TEST avec settings complets"
```

---

## Task 8 : Seed 02 — Praticiens

**Files:**
- Create: `tests/e2e/fixtures/seeds/02-practitioners.js`

- [ ] **Step 1: Écrire le test**

Crée `tests/seed-02-practitioners.test.js` :

```js
const assert = require('assert');
const { pool } = require('../src/services/db');
const { seedBusiness } = require('./e2e/fixtures/seeds/01-business');
const { seedPractitioners } = require('./e2e/fixtures/seeds/02-practitioners');
const IDS = require('./e2e/fixtures/ids');

(async () => {
  await seedBusiness();
  await seedPractitioners();

  const r = await pool.query(
    `SELECT id, display_name, role FROM practitioners WHERE business_id = $1 ORDER BY display_name`,
    [IDS.BUSINESS]
  );
  assert(r.rows.length >= 3, 'FAIL: expected 3 practitioners');
  console.log('✓ 3 practitioners seeded');

  const alice = r.rows.find(p => p.id === IDS.PRAC_ALICE);
  assert(alice && alice.role === 'owner', 'FAIL: Alice not owner');
  console.log('✓ Alice is owner');

  // Idempotence
  await seedPractitioners();
  const r2 = await pool.query(`SELECT COUNT(*) AS c FROM practitioners WHERE business_id = $1`, [IDS.BUSINESS]);
  assert(parseInt(r2.rows[0].c) === 3, `FAIL: idempotence (got ${r2.rows[0].c} practs)`);
  console.log('✓ idempotent');

  console.log('\n✓ seed-02 OK');
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
```

- [ ] **Step 2: Run → FAIL**

```bash
node tests/seed-02-practitioners.test.js
```

Expected : Module not found.

- [ ] **Step 3: Créer le seed**

Crée `tests/e2e/fixtures/seeds/02-practitioners.js` :

```js
const { pool } = require('../../../../src/services/db');
const IDS = require('../ids');

const PRACS = [
  {
    id: IDS.PRAC_ALICE,
    display_name: 'Alice Owner',
    title: 'Propriétaire',
    email: 'alice-test@genda-test.be',
    role: 'owner',
    user_id: IDS.USER_ALICE_OWNER,
    color: '#4A90E2',
  },
  {
    id: IDS.PRAC_BOB,
    display_name: 'Bob Stylist',
    title: 'Coiffeur',
    email: 'bob-test@genda-test.be',
    role: 'practitioner',
    user_id: IDS.USER_BOB_STAFF,
    color: '#50C878',
  },
  {
    id: IDS.PRAC_CAROL,
    display_name: 'Carol Junior',
    title: 'Apprentie',
    email: 'carol-test@genda-test.be',
    role: 'practitioner',
    user_id: IDS.USER_CAROL_STAFF,
    color: '#FF6B9D',
  },
];

async function seedPractitioners() {
  const bcrypt = require('bcryptjs');
  const hashedPw = await bcrypt.hash('TestPassword123!', 10);

  for (const p of PRACS) {
    // 1. Créer user (pour login auth)
    await pool.query(`
      INSERT INTO users (id, email, password_hash, role)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email, password_hash = EXCLUDED.password_hash
    `, [p.user_id, p.email, hashedPw, p.role === 'owner' ? 'owner' : 'staff']);

    // 2. Créer practitioner
    await pool.query(`
      INSERT INTO practitioners (id, business_id, user_id, display_name, title, email, role, color)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      ON CONFLICT (id) DO UPDATE SET
        display_name = EXCLUDED.display_name, title = EXCLUDED.title,
        email = EXCLUDED.email, role = EXCLUDED.role, color = EXCLUDED.color,
        updated_at = NOW()
    `, [p.id, IDS.BUSINESS, p.user_id, p.display_name, p.title, p.email, p.role, p.color]);

    await pool.query(
      `INSERT INTO seed_tracking (entity_type, entity_id) VALUES ('practitioner', $1)
       ON CONFLICT DO NOTHING`, [p.id]
    );
    await pool.query(
      `INSERT INTO seed_tracking (entity_type, entity_id) VALUES ('user', $1)
       ON CONFLICT DO NOTHING`, [p.user_id]
    );
  }
}

module.exports = { seedPractitioners, PRACS };

if (require.main === module) {
  seedPractitioners().then(() => { console.log('✓ 3 pracs seeded'); process.exit(0); })
    .catch(e => { console.error(e); process.exit(1); });
}
```

- [ ] **Step 4: Run test → PASS**

```bash
node tests/seed-02-practitioners.test.js
```

Expected : `✓ seed-02 OK`.

- [ ] **Step 5: Commit**

```bash
git add tests/e2e/fixtures/seeds/02-practitioners.js tests/seed-02-practitioners.test.js
git commit -m "feat(e2e-infra): seed 02 praticiens (Alice/Bob/Carol) + users login"
```

---

## Task 9 : Seed 03 — Services (7 services + variants)

**Files:**
- Create: `tests/e2e/fixtures/seeds/03-services.js`

- [ ] **Step 1: Écrire le test**

Crée `tests/seed-03-services.test.js` :

```js
const assert = require('assert');
const { pool } = require('../src/services/db');
const { seedBusiness } = require('./e2e/fixtures/seeds/01-business');
const { seedServices } = require('./e2e/fixtures/seeds/03-services');
const IDS = require('./e2e/fixtures/ids');

(async () => {
  await seedBusiness();
  await seedServices();

  const r = await pool.query(
    `SELECT id, name, price_cents, duration_min, quote_only, promo_eligible FROM services
     WHERE business_id = $1 ORDER BY price_cents NULLS LAST`, [IDS.BUSINESS]
  );
  assert(r.rows.length === 7, `FAIL: expected 7 services (got ${r.rows.length})`);
  console.log('✓ 7 services seeded');

  const quote = r.rows.find(s => s.id === IDS.SVC_QUOTE);
  assert(quote?.quote_only === true, 'FAIL: SVC_QUOTE not quote_only');
  console.log('✓ SVC_QUOTE quote_only=true');

  const cheap = r.rows.find(s => s.id === IDS.SVC_CHEAP);
  assert(cheap?.promo_eligible === false, 'FAIL: SVC_CHEAP promo_eligible !== false');
  console.log('✓ SVC_CHEAP promo_eligible=false');

  const variants = await pool.query(
    `SELECT id FROM service_variants WHERE service_id = $1 ORDER BY duration_min`,
    [IDS.SVC_VARIANTS]
  );
  assert(variants.rows.length === 3, `FAIL: expected 3 variants (got ${variants.rows.length})`);
  console.log('✓ 3 variants seeded for SVC_VARIANTS');

  console.log('\n✓ seed-03 OK');
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
```

- [ ] **Step 2: Run → FAIL**

```bash
node tests/seed-03-services.test.js
```

- [ ] **Step 3: Créer le seed**

Crée `tests/e2e/fixtures/seeds/03-services.js` :

```js
const { pool } = require('../../../../src/services/db');
const IDS = require('../ids');

const SERVICES = [
  { id: IDS.SVC_SHORT, name: 'Coupe rapide', category: 'Coupe', duration_min: 30, price_cents: 2500, promo_eligible: true, quote_only: false, is_active: true, color: '#4A90E2' },
  { id: IDS.SVC_LONG, name: 'Coloration complète', category: 'Coloration', duration_min: 120, price_cents: 8000, promo_eligible: true, quote_only: false, is_active: true, color: '#E24A90' },
  { id: IDS.SVC_CHEAP, name: 'Barbe', category: 'Barbier', duration_min: 15, price_cents: 1200, promo_eligible: false, quote_only: false, is_active: true, color: '#8B4513' },
  { id: IDS.SVC_EXPENSIVE, name: 'Balayage premium', category: 'Coloration', duration_min: 180, price_cents: 15000, promo_eligible: true, quote_only: false, is_active: true, color: '#FFD700' },
  { id: IDS.SVC_VARIANTS, name: 'Soin visage', category: 'Soin', duration_min: 60, price_cents: 5500, promo_eligible: true, quote_only: false, is_active: true, color: '#50C878' },
  { id: IDS.SVC_QUOTE, name: 'Devis sur mesure', category: 'Autre', duration_min: 60, price_cents: null, promo_eligible: false, quote_only: true, is_active: true, color: '#696969' },
  { id: IDS.SVC_PASS, name: 'Séance abonnement', category: 'Abonnement', duration_min: 60, price_cents: 5000, promo_eligible: false, quote_only: false, is_active: true, color: '#9370DB' },
];

const VARIANTS = [
  { id: IDS.VAR_45MIN, service_id: IDS.SVC_VARIANTS, name: 'Express', duration_min: 45, price_cents: 4000 },
  { id: IDS.VAR_60MIN, service_id: IDS.SVC_VARIANTS, name: 'Standard', duration_min: 60, price_cents: 5500 },
  { id: IDS.VAR_90MIN, service_id: IDS.SVC_VARIANTS, name: 'Deluxe', duration_min: 90, price_cents: 7500 },
];

async function seedServices() {
  for (const s of SERVICES) {
    await pool.query(`
      INSERT INTO services (id, business_id, name, category, duration_min, price_cents,
        promo_eligible, quote_only, is_active, color)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      ON CONFLICT (id) DO UPDATE SET
        name = EXCLUDED.name, category = EXCLUDED.category,
        duration_min = EXCLUDED.duration_min, price_cents = EXCLUDED.price_cents,
        promo_eligible = EXCLUDED.promo_eligible, quote_only = EXCLUDED.quote_only,
        is_active = EXCLUDED.is_active, color = EXCLUDED.color,
        updated_at = NOW()
    `, [s.id, IDS.BUSINESS, s.name, s.category, s.duration_min, s.price_cents,
        s.promo_eligible, s.quote_only, s.is_active, s.color]);

    await pool.query(
      `INSERT INTO seed_tracking (entity_type, entity_id) VALUES ('service', $1)
       ON CONFLICT DO NOTHING`, [s.id]
    );
  }

  for (const v of VARIANTS) {
    await pool.query(`
      INSERT INTO service_variants (id, service_id, name, duration_min, price_cents)
      VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT (id) DO UPDATE SET
        name = EXCLUDED.name, duration_min = EXCLUDED.duration_min,
        price_cents = EXCLUDED.price_cents
    `, [v.id, v.service_id, v.name, v.duration_min, v.price_cents]);

    await pool.query(
      `INSERT INTO seed_tracking (entity_type, entity_id) VALUES ('service_variant', $1)
       ON CONFLICT DO NOTHING`, [v.id]
    );
  }

  // Link practitioners to services via practitioner_services
  const pracSvcLinks = [
    { prac: IDS.PRAC_ALICE, svcs: [IDS.SVC_SHORT, IDS.SVC_LONG, IDS.SVC_CHEAP, IDS.SVC_EXPENSIVE, IDS.SVC_VARIANTS, IDS.SVC_QUOTE, IDS.SVC_PASS] },
    { prac: IDS.PRAC_BOB, svcs: [IDS.SVC_SHORT, IDS.SVC_LONG, IDS.SVC_PASS] },
    { prac: IDS.PRAC_CAROL, svcs: [IDS.SVC_SHORT] },
  ];
  for (const link of pracSvcLinks) {
    for (const svc of link.svcs) {
      await pool.query(`
        INSERT INTO practitioner_services (practitioner_id, service_id)
        VALUES ($1, $2) ON CONFLICT DO NOTHING
      `, [link.prac, svc]);
    }
  }
}

module.exports = { seedServices, SERVICES, VARIANTS };

if (require.main === module) {
  seedServices().then(() => { console.log('✓ 7 services + 3 variants seeded'); process.exit(0); })
    .catch(e => { console.error(e); process.exit(1); });
}
```

- [ ] **Step 4: Run test → PASS**

```bash
node tests/seed-03-services.test.js
```

- [ ] **Step 5: Commit**

```bash
git add tests/e2e/fixtures/seeds/03-services.js tests/seed-03-services.test.js
git commit -m "feat(e2e-infra): seed 03 — 7 services + 3 variants + practitioner links"
```

---

## Task 10 : Seed 04 — Horaires (business + prac)

**Files:**
- Create: `tests/e2e/fixtures/seeds/04-schedules.js`

- [ ] **Step 1: Écrire le test**

Crée `tests/seed-04-schedules.test.js` :

```js
const assert = require('assert');
const { pool } = require('../src/services/db');
const { seedBusiness } = require('./e2e/fixtures/seeds/01-business');
const { seedPractitioners } = require('./e2e/fixtures/seeds/02-practitioners');
const { seedSchedules } = require('./e2e/fixtures/seeds/04-schedules');
const IDS = require('./e2e/fixtures/ids');

(async () => {
  await seedBusiness();
  await seedPractitioners();
  await seedSchedules();

  const biz = await pool.query(
    `SELECT COUNT(*) AS c FROM business_hours WHERE business_id = $1`, [IDS.BUSINESS]
  );
  assert(parseInt(biz.rows[0].c) >= 5, `FAIL: business_hours expected >=5 days (got ${biz.rows[0].c})`);
  console.log('✓ business_hours seeded (>=5 days)');

  const alicePrac = await pool.query(
    `SELECT COUNT(*) AS c FROM practitioner_hours WHERE practitioner_id = $1`, [IDS.PRAC_ALICE]
  );
  assert(parseInt(alicePrac.rows[0].c) >= 5, `FAIL: Alice hours expected >=5 (got ${alicePrac.rows[0].c})`);
  console.log('✓ Alice hours seeded');

  console.log('\n✓ seed-04 OK');
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
```

- [ ] **Step 2: Run → FAIL**

- [ ] **Step 3: Créer le seed**

Crée `tests/e2e/fixtures/seeds/04-schedules.js` :

```js
const { pool } = require('../../../../src/services/db');
const IDS = require('../ids');

// day_of_week: 0=Dim, 1=Lun, ..., 6=Sam
const BIZ_HOURS = [
  { dow: 1, open: '09:00', close: '18:00' },
  { dow: 2, open: '09:00', close: '18:00' },
  { dow: 3, open: '09:00', close: '18:00' },
  { dow: 4, open: '09:00', close: '18:00' },
  { dow: 5, open: '09:00', close: '18:00' },
  { dow: 6, open: '09:00', close: '17:00' },
];

const PRAC_HOURS = {
  [IDS.PRAC_ALICE]: [
    { dow: 2, open: '09:00', close: '18:00' }, { dow: 3, open: '09:00', close: '18:00' },
    { dow: 4, open: '09:00', close: '18:00' }, { dow: 5, open: '09:00', close: '18:00' },
    { dow: 6, open: '09:00', close: '17:00' },
  ],
  [IDS.PRAC_BOB]: [
    { dow: 1, open: '10:00', close: '19:00' }, { dow: 2, open: '10:00', close: '19:00' },
    { dow: 3, open: '10:00', close: '19:00' }, { dow: 4, open: '10:00', close: '19:00' },
    { dow: 5, open: '10:00', close: '19:00' },
  ],
  [IDS.PRAC_CAROL]: [
    { dow: 3, open: '14:00', close: '20:00' }, { dow: 4, open: '14:00', close: '20:00' },
    { dow: 5, open: '14:00', close: '20:00' }, { dow: 6, open: '14:00', close: '20:00' },
  ],
};

async function seedSchedules() {
  // Business hours : DELETE all then INSERT (idempotent via full reset of this narrow scope)
  await pool.query(`DELETE FROM business_hours WHERE business_id = $1`, [IDS.BUSINESS]);
  for (const h of BIZ_HOURS) {
    await pool.query(`
      INSERT INTO business_hours (business_id, day_of_week, open_time, close_time)
      VALUES ($1, $2, $3, $4)
    `, [IDS.BUSINESS, h.dow, h.open, h.close]);
  }

  // Practitioner hours : idem
  for (const [pracId, hours] of Object.entries(PRAC_HOURS)) {
    await pool.query(`DELETE FROM practitioner_hours WHERE practitioner_id = $1`, [pracId]);
    for (const h of hours) {
      await pool.query(`
        INSERT INTO practitioner_hours (practitioner_id, day_of_week, open_time, close_time)
        VALUES ($1, $2, $3, $4)
      `, [pracId, h.dow, h.open, h.close]);
    }
  }
}

module.exports = { seedSchedules };

if (require.main === module) {
  seedSchedules().then(() => { console.log('✓ schedules seeded'); process.exit(0); })
    .catch(e => { console.error(e); process.exit(1); });
}
```

- [ ] **Step 4: Run → PASS**

- [ ] **Step 5: Commit**

```bash
git add tests/e2e/fixtures/seeds/04-schedules.js tests/seed-04-schedules.test.js
git commit -m "feat(e2e-infra): seed 04 — horaires business + 3 praticiens"
```

---

## Task 11 : Seed 05 — Clients (3 clients)

**Files:**
- Create: `tests/e2e/fixtures/seeds/05-clients.js`

- [ ] **Step 1: Écrire le test**

Crée `tests/seed-05-clients.test.js` :

```js
const assert = require('assert');
const { pool } = require('../src/services/db');
const { seedBusiness } = require('./e2e/fixtures/seeds/01-business');
const { seedClients } = require('./e2e/fixtures/seeds/05-clients');
const IDS = require('./e2e/fixtures/ids');

(async () => {
  await seedBusiness();
  await seedClients();

  const r = await pool.query(`SELECT id, full_name, is_vip FROM clients WHERE business_id = $1`, [IDS.BUSINESS]);
  assert(r.rows.length === 3, `FAIL: expected 3 clients (got ${r.rows.length})`);
  const paul = r.rows.find(c => c.id === IDS.CLIENT_PAUL);
  assert(paul?.is_vip === true, 'FAIL: Paul not VIP');
  console.log('✓ 3 clients seeded, Paul VIP');

  console.log('\n✓ seed-05 OK');
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
```

- [ ] **Step 2: Run → FAIL**

- [ ] **Step 3: Créer le seed**

Crée `tests/e2e/fixtures/seeds/05-clients.js` :

```js
const { pool } = require('../../../../src/services/db');
const IDS = require('../ids');

const CLIENTS = [
  { id: IDS.CLIENT_JEAN, full_name: 'Jean Testeur', email: 'jean-test@genda-test.be', phone: '+32491000001', is_vip: false, consent_sms: true, consent_email: true, consent_marketing: false, booking_count: 0 },
  { id: IDS.CLIENT_MARIE, full_name: 'Marie Regular', email: 'marie-test@genda-test.be', phone: '+32491000002', is_vip: false, consent_sms: true, consent_email: true, consent_marketing: true, booking_count: 3 },
  { id: IDS.CLIENT_PAUL, full_name: 'Paul VIP', email: 'paul-test@genda-test.be', phone: '+32491000003', is_vip: true, consent_sms: true, consent_email: true, consent_marketing: true, booking_count: 10 },
];

async function seedClients() {
  for (const c of CLIENTS) {
    await pool.query(`
      INSERT INTO clients (id, business_id, full_name, email, phone, is_vip,
        consent_sms, consent_email, consent_marketing, booking_count)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      ON CONFLICT (id) DO UPDATE SET
        full_name = EXCLUDED.full_name, email = EXCLUDED.email, phone = EXCLUDED.phone,
        is_vip = EXCLUDED.is_vip, consent_sms = EXCLUDED.consent_sms,
        consent_email = EXCLUDED.consent_email, consent_marketing = EXCLUDED.consent_marketing,
        booking_count = EXCLUDED.booking_count,
        updated_at = NOW()
    `, [c.id, IDS.BUSINESS, c.full_name, c.email, c.phone, c.is_vip,
        c.consent_sms, c.consent_email, c.consent_marketing, c.booking_count]);

    await pool.query(
      `INSERT INTO seed_tracking (entity_type, entity_id) VALUES ('client', $1)
       ON CONFLICT DO NOTHING`, [c.id]
    );
  }
}

module.exports = { seedClients, CLIENTS };

if (require.main === module) {
  seedClients().then(() => { console.log('✓ 3 clients seeded'); process.exit(0); })
    .catch(e => { console.error(e); process.exit(1); });
}
```

- [ ] **Step 4: Run → PASS**

- [ ] **Step 5: Commit**

```bash
git add tests/e2e/fixtures/seeds/05-clients.js tests/seed-05-clients.test.js
git commit -m "feat(e2e-infra): seed 05 — 3 clients (Jean/Marie/Paul VIP)"
```

---

## Task 12 : Seed 06 — Promotions (7 types)

**Files:**
- Create: `tests/e2e/fixtures/seeds/06-promotions.js`

- [ ] **Step 1: Test**

Crée `tests/seed-06-promotions.test.js` :

```js
const assert = require('assert');
const { pool } = require('../src/services/db');
const { seedBusiness } = require('./e2e/fixtures/seeds/01-business');
const { seedServices } = require('./e2e/fixtures/seeds/03-services');
const { seedPromotions } = require('./e2e/fixtures/seeds/06-promotions');
const IDS = require('./e2e/fixtures/ids');

(async () => {
  await seedBusiness(); await seedServices(); await seedPromotions();
  const r = await pool.query(`SELECT id, title, reward_type, condition_type FROM promotions WHERE business_id = $1`, [IDS.BUSINESS]);
  assert(r.rows.length === 7, `FAIL: expected 7 promos (got ${r.rows.length})`);
  const types = new Set(r.rows.map(p => p.reward_type));
  ['discount_pct','discount_fixed','free_service','info_only'].forEach(t => {
    assert(types.has(t), `FAIL: missing reward_type ${t}`);
  });
  console.log('✓ 7 promos seeded, 4 reward_types present');
  console.log('\n✓ seed-06 OK');
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
```

- [ ] **Step 2: Run → FAIL**

- [ ] **Step 3: Créer**

Crée `tests/e2e/fixtures/seeds/06-promotions.js` :

```js
const { pool } = require('../../../../src/services/db');
const IDS = require('../ids');

const PROMOS = [
  { id: IDS.PROMO_PCT, title: 'Promo 20%', reward_type: 'discount_pct', reward_value: 20, condition_type: 'none', max_uses: 100 },
  { id: IDS.PROMO_FIXED, title: 'Promo 10€', reward_type: 'discount_fixed', reward_value: 1000, condition_type: 'min_amount', condition_min_cents: 5000 },
  { id: IDS.PROMO_SVC, title: 'Coloration -30%', reward_type: 'discount_pct', reward_value: 30, condition_type: 'specific_service', condition_service_id: IDS.SVC_LONG },
  { id: IDS.PROMO_FIRST, title: 'Bienvenue -15%', reward_type: 'discount_pct', reward_value: 15, condition_type: 'first_visit' },
  { id: IDS.PROMO_DATE, title: 'Printemps -10%', reward_type: 'discount_pct', reward_value: 10, condition_type: 'date_range', condition_start_date: new Date(), condition_end_date: new Date(Date.now() + 30 * 86400000) },
  { id: IDS.PROMO_FREE, title: 'Barbe offerte', reward_type: 'free_service', reward_value: null, reward_service_id: IDS.SVC_CHEAP, condition_type: 'specific_service', condition_service_id: IDS.SVC_LONG },
  { id: IDS.PROMO_INFO, title: 'Nouveauté à venir', reward_type: 'info_only', reward_value: null, condition_type: 'none' },
];

async function seedPromotions() {
  for (const p of PROMOS) {
    await pool.query(`
      INSERT INTO promotions (id, business_id, title, reward_type, reward_value, reward_service_id,
        condition_type, condition_service_id, condition_min_cents, condition_start_date, condition_end_date,
        max_uses, current_uses, is_active)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 0, true)
      ON CONFLICT (id) DO UPDATE SET
        title = EXCLUDED.title, reward_type = EXCLUDED.reward_type,
        reward_value = EXCLUDED.reward_value, reward_service_id = EXCLUDED.reward_service_id,
        condition_type = EXCLUDED.condition_type, condition_service_id = EXCLUDED.condition_service_id,
        condition_min_cents = EXCLUDED.condition_min_cents,
        condition_start_date = EXCLUDED.condition_start_date, condition_end_date = EXCLUDED.condition_end_date,
        max_uses = EXCLUDED.max_uses, is_active = true,
        updated_at = NOW()
    `, [p.id, IDS.BUSINESS, p.title, p.reward_type, p.reward_value, p.reward_service_id || null,
        p.condition_type, p.condition_service_id || null, p.condition_min_cents || null,
        p.condition_start_date || null, p.condition_end_date || null, p.max_uses || null]);

    await pool.query(
      `INSERT INTO seed_tracking (entity_type, entity_id) VALUES ('promotion', $1)
       ON CONFLICT DO NOTHING`, [p.id]
    );
  }
}

module.exports = { seedPromotions };

if (require.main === module) {
  seedPromotions().then(() => { console.log('✓ 7 promos seeded'); process.exit(0); })
    .catch(e => { console.error(e); process.exit(1); });
}
```

- [ ] **Step 4: Run → PASS**

- [ ] **Step 5: Commit**

```bash
git add tests/e2e/fixtures/seeds/06-promotions.js tests/seed-06-promotions.test.js
git commit -m "feat(e2e-infra): seed 06 — 7 promotions (types pct/fixed/svc/first/date/free/info)"
```

---

## Task 13 : Seed 07 — Gift cards (4 états)

**Files:**
- Create: `tests/e2e/fixtures/seeds/07-gift-cards.js`

- [ ] **Step 1: Test**

Crée `tests/seed-07-gift-cards.test.js` :

```js
const assert = require('assert');
const { pool } = require('../src/services/db');
const { seedBusiness } = require('./e2e/fixtures/seeds/01-business');
const { seedGiftCards } = require('./e2e/fixtures/seeds/07-gift-cards');
const IDS = require('./e2e/fixtures/ids');

(async () => {
  await seedBusiness(); await seedGiftCards();
  const r = await pool.query(`SELECT id, status, balance_cents FROM gift_cards WHERE business_id = $1`, [IDS.BUSINESS]);
  assert(r.rows.length === 4, `FAIL: expected 4 GC (got ${r.rows.length})`);
  const expired = r.rows.find(g => g.id === IDS.GC_EXPIRED);
  assert(expired?.status === 'expired', 'FAIL: GC_EXPIRED not expired');
  const cancelled = r.rows.find(g => g.id === IDS.GC_CANCELLED);
  assert(cancelled?.status === 'cancelled', 'FAIL: GC_CANCELLED not cancelled');
  console.log('✓ 4 GC seeded (active/partial/expired/cancelled)');
  console.log('\n✓ seed-07 OK');
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
```

- [ ] **Step 2: Run → FAIL**

- [ ] **Step 3: Créer**

Crée `tests/e2e/fixtures/seeds/07-gift-cards.js` :

```js
const { pool } = require('../../../../src/services/db');
const IDS = require('../ids');

const GCS = [
  { id: IDS.GC_ACTIVE, code: 'TESTACTIVE01', amount_cents: 10000, balance_cents: 10000, status: 'active', expires_at_days: 365 },
  { id: IDS.GC_PARTIAL, code: 'TESTPARTIAL1', amount_cents: 10000, balance_cents: 5000, status: 'active', expires_at_days: 365 },
  { id: IDS.GC_EXPIRED, code: 'TESTEXPIRED1', amount_cents: 10000, balance_cents: 10000, status: 'expired', expires_at_days: -30 },
  { id: IDS.GC_CANCELLED, code: 'TESTCANCEL01', amount_cents: 5000, balance_cents: 5000, status: 'cancelled', expires_at_days: 365 },
];

async function seedGiftCards() {
  for (const g of GCS) {
    const expiresAt = new Date(Date.now() + g.expires_at_days * 86400000).toISOString();
    await pool.query(`
      INSERT INTO gift_cards (id, business_id, code, amount_cents, balance_cents, status,
        buyer_name, buyer_email, expires_at)
      VALUES ($1, $2, $3, $4, $5, $6, 'Buyer Test', 'buyer-test@genda-test.be', $7)
      ON CONFLICT (id) DO UPDATE SET
        code = EXCLUDED.code, amount_cents = EXCLUDED.amount_cents,
        balance_cents = EXCLUDED.balance_cents, status = EXCLUDED.status,
        expires_at = EXCLUDED.expires_at, updated_at = NOW()
    `, [g.id, IDS.BUSINESS, g.code, g.amount_cents, g.balance_cents, g.status, expiresAt]);

    await pool.query(
      `INSERT INTO seed_tracking (entity_type, entity_id) VALUES ('gift_card', $1)
       ON CONFLICT DO NOTHING`, [g.id]
    );
  }
}

module.exports = { seedGiftCards };

if (require.main === module) {
  seedGiftCards().then(() => { console.log('✓ 4 GC seeded'); process.exit(0); })
    .catch(e => { console.error(e); process.exit(1); });
}
```

- [ ] **Step 4: Run → PASS**

- [ ] **Step 5: Commit**

```bash
git add tests/e2e/fixtures/seeds/07-gift-cards.js tests/seed-07-gift-cards.test.js
git commit -m "feat(e2e-infra): seed 07 — 4 GC (active/partial/expired/cancelled)"
```

---

## Task 14 : Seed 08 — Passes (3 états)

**Files:**
- Create: `tests/e2e/fixtures/seeds/08-passes.js`

- [ ] **Step 1: Test**

Crée `tests/seed-08-passes.test.js` :

```js
const assert = require('assert');
const { pool } = require('../src/services/db');
const { seedBusiness } = require('./e2e/fixtures/seeds/01-business');
const { seedServices } = require('./e2e/fixtures/seeds/03-services');
const { seedPasses } = require('./e2e/fixtures/seeds/08-passes');
const IDS = require('./e2e/fixtures/ids');

(async () => {
  await seedBusiness(); await seedServices(); await seedPasses();
  const r = await pool.query(
    `SELECT id, sessions_remaining, status FROM passes WHERE business_id = $1`, [IDS.BUSINESS]
  );
  assert(r.rows.length === 3, `FAIL: expected 3 passes (got ${r.rows.length})`);
  const empty = r.rows.find(p => p.id === IDS.PASS_EMPTY);
  assert(empty?.sessions_remaining === 0, 'FAIL: PASS_EMPTY not empty');
  console.log('✓ 3 passes seeded');
  console.log('\n✓ seed-08 OK');
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
```

- [ ] **Step 2: Run → FAIL**

- [ ] **Step 3: Créer**

Crée `tests/e2e/fixtures/seeds/08-passes.js` :

```js
const { pool } = require('../../../../src/services/db');
const IDS = require('../ids');

const PASSES = [
  { id: IDS.PASS_ACTIVE, code: 'PASSACT01', name: 'Abo 10 séances', sessions_total: 10, sessions_remaining: 5, price_cents: 40000, status: 'active', expires_at_days: 90 },
  { id: IDS.PASS_EXPIRED, code: 'PASSEXP01', name: 'Abo expiré', sessions_total: 10, sessions_remaining: 5, price_cents: 40000, status: 'active', expires_at_days: -10 },
  { id: IDS.PASS_EMPTY, code: 'PASSEMP01', name: 'Abo épuisé', sessions_total: 10, sessions_remaining: 0, price_cents: 40000, status: 'used', expires_at_days: 90 },
];

async function seedPasses() {
  for (const p of PASSES) {
    const expiresAt = new Date(Date.now() + p.expires_at_days * 86400000).toISOString();
    await pool.query(`
      INSERT INTO passes (id, business_id, service_id, code, name, sessions_total,
        sessions_remaining, price_cents, buyer_name, buyer_email, status, expires_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'Buyer Pass', 'buyer-pass@genda-test.be', $9, $10)
      ON CONFLICT (id) DO UPDATE SET
        code = EXCLUDED.code, name = EXCLUDED.name,
        sessions_total = EXCLUDED.sessions_total, sessions_remaining = EXCLUDED.sessions_remaining,
        price_cents = EXCLUDED.price_cents, status = EXCLUDED.status,
        expires_at = EXCLUDED.expires_at, updated_at = NOW()
    `, [p.id, IDS.BUSINESS, IDS.SVC_PASS, p.code, p.name, p.sessions_total,
        p.sessions_remaining, p.price_cents, p.status, expiresAt]);

    await pool.query(
      `INSERT INTO seed_tracking (entity_type, entity_id) VALUES ('pass', $1)
       ON CONFLICT DO NOTHING`, [p.id]
    );
  }
}

module.exports = { seedPasses };

if (require.main === module) {
  seedPasses().then(() => { console.log('✓ 3 passes seeded'); process.exit(0); })
    .catch(e => { console.error(e); process.exit(1); });
}
```

- [ ] **Step 4: Run → PASS**

- [ ] **Step 5: Commit**

```bash
git add tests/e2e/fixtures/seeds/08-passes.js tests/seed-08-passes.test.js
git commit -m "feat(e2e-infra): seed 08 — 3 passes (active/expired/empty)"
```

---

## Task 15 : Seed 09 — Waitlist (2 entries)

**Files:**
- Create: `tests/e2e/fixtures/seeds/09-waitlist.js`

- [ ] **Step 1: Test**

Crée `tests/seed-09-waitlist.test.js` :

```js
const assert = require('assert');
const { pool } = require('../src/services/db');
const { seedBusiness } = require('./e2e/fixtures/seeds/01-business');
const { seedPractitioners } = require('./e2e/fixtures/seeds/02-practitioners');
const { seedServices } = require('./e2e/fixtures/seeds/03-services');
const { seedWaitlist } = require('./e2e/fixtures/seeds/09-waitlist');
const IDS = require('./e2e/fixtures/ids');

(async () => {
  await seedBusiness(); await seedPractitioners(); await seedServices(); await seedWaitlist();
  const r = await pool.query(
    `SELECT id, preferred_days, preferred_time FROM waitlist_entries WHERE business_id = $1`, [IDS.BUSINESS]
  );
  assert(r.rows.length === 2, `FAIL: expected 2 WL entries (got ${r.rows.length})`);
  const marie = r.rows.find(w => w.id === IDS.WL_MARIE);
  // WL_MARIE has preferred_days=[] (edge case NULL/empty)
  assert(Array.isArray(marie?.preferred_days) && marie.preferred_days.length === 0, 'FAIL: WL_MARIE preferred_days not []');
  console.log('✓ 2 WL entries seeded');
  console.log('\n✓ seed-09 OK');
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
```

- [ ] **Step 2: Run → FAIL**

- [ ] **Step 3: Créer**

Crée `tests/e2e/fixtures/seeds/09-waitlist.js` :

```js
const { pool } = require('../../../../src/services/db');
const IDS = require('../ids');

const ENTRIES = [
  {
    id: IDS.WL_JEAN, practitioner_id: IDS.PRAC_ALICE, service_id: IDS.SVC_LONG,
    client_name: 'Jean Waitlist', client_email: 'jean-test@genda-test.be', client_phone: '+32491000001',
    preferred_days: [1, 2, 3, 4, 5], preferred_time: 'afternoon', priority: 1
  },
  {
    id: IDS.WL_MARIE, practitioner_id: IDS.PRAC_BOB, service_id: IDS.SVC_SHORT,
    client_name: 'Marie Waitlist', client_email: 'marie-test@genda-test.be', client_phone: '+32491000002',
    preferred_days: [], preferred_time: 'any', priority: 2
  },
];

async function seedWaitlist() {
  for (const e of ENTRIES) {
    await pool.query(`
      INSERT INTO waitlist_entries (id, business_id, practitioner_id, service_id,
        client_name, client_email, client_phone, preferred_days, preferred_time, priority, status)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'waiting')
      ON CONFLICT (id) DO UPDATE SET
        preferred_days = EXCLUDED.preferred_days, preferred_time = EXCLUDED.preferred_time,
        priority = EXCLUDED.priority, status = 'waiting', updated_at = NOW()
    `, [e.id, IDS.BUSINESS, e.practitioner_id, e.service_id,
        e.client_name, e.client_email, e.client_phone,
        JSON.stringify(e.preferred_days), e.preferred_time, e.priority]);

    await pool.query(
      `INSERT INTO seed_tracking (entity_type, entity_id) VALUES ('waitlist_entry', $1)
       ON CONFLICT DO NOTHING`, [e.id]
    );
  }
}

module.exports = { seedWaitlist };

if (require.main === module) {
  seedWaitlist().then(() => { console.log('✓ 2 WL entries seeded'); process.exit(0); })
    .catch(e => { console.error(e); process.exit(1); });
}
```

- [ ] **Step 4: Run → PASS**

- [ ] **Step 5: Commit**

```bash
git add tests/e2e/fixtures/seeds/09-waitlist.js tests/seed-09-waitlist.test.js
git commit -m "feat(e2e-infra): seed 09 — 2 waitlist entries (WL_MARIE avec preferred_days=[])"
```

---

## Task 16 : Seed 10 — Bookings historiques (5)

**Files:**
- Create: `tests/e2e/fixtures/seeds/10-bookings-historique.js`

- [ ] **Step 1: Test**

Crée `tests/seed-10-bookings.test.js` :

```js
const assert = require('assert');
const { pool } = require('../src/services/db');
const { seedBusiness } = require('./e2e/fixtures/seeds/01-business');
const { seedPractitioners } = require('./e2e/fixtures/seeds/02-practitioners');
const { seedServices } = require('./e2e/fixtures/seeds/03-services');
const { seedClients } = require('./e2e/fixtures/seeds/05-clients');
const { seedBookingsHistorique } = require('./e2e/fixtures/seeds/10-bookings-historique');
const IDS = require('./e2e/fixtures/ids');

(async () => {
  await seedBusiness(); await seedPractitioners(); await seedServices(); await seedClients();
  await seedBookingsHistorique();
  const r = await pool.query(`SELECT id, status FROM bookings WHERE business_id = $1`, [IDS.BUSINESS]);
  assert(r.rows.length === 5, `FAIL: expected 5 historique bookings (got ${r.rows.length})`);
  const statuses = r.rows.map(b => b.status).sort();
  assert(statuses.includes('completed'), 'FAIL: missing completed');
  assert(statuses.includes('no_show'), 'FAIL: missing no_show');
  assert(statuses.includes('cancelled'), 'FAIL: missing cancelled');
  console.log('✓ 5 bookings historiques seeded');
  console.log('\n✓ seed-10 OK');
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
```

- [ ] **Step 2: Run → FAIL**

- [ ] **Step 3: Créer**

Crée `tests/e2e/fixtures/seeds/10-bookings-historique.js` :

```js
const { pool } = require('../../../../src/services/db');
const IDS = require('../ids');

function dateOffsetH(days, hour) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  d.setHours(hour, 0, 0, 0);
  return d.toISOString();
}

const BOOKINGS = [
  { id: IDS.BK_COMPLETED_1, start_days: -30, start_hour: 10, end_hour: 11, status: 'completed', prac: IDS.PRAC_ALICE, svc: IDS.SVC_SHORT, client: IDS.CLIENT_MARIE, price: 2500 },
  { id: IDS.BK_COMPLETED_2, start_days: -20, start_hour: 14, end_hour: 16, status: 'completed', prac: IDS.PRAC_ALICE, svc: IDS.SVC_LONG, client: IDS.CLIENT_MARIE, price: 8000 },
  { id: IDS.BK_COMPLETED_3, start_days: -7, start_hour: 9, end_hour: 10, status: 'completed', prac: IDS.PRAC_BOB, svc: IDS.SVC_SHORT, client: IDS.CLIENT_PAUL, price: 2500 },
  { id: IDS.BK_NOSHOW_1, start_days: -3, start_hour: 15, end_hour: 16, status: 'no_show', prac: IDS.PRAC_ALICE, svc: IDS.SVC_SHORT, client: IDS.CLIENT_PAUL, price: 2500 },
  { id: IDS.BK_CANCELLED_1, start_days: -1, start_hour: 10, end_hour: 11, status: 'cancelled', prac: IDS.PRAC_BOB, svc: IDS.SVC_SHORT, client: IDS.CLIENT_MARIE, price: 2500 },
];

async function seedBookingsHistorique() {
  for (const b of BOOKINGS) {
    await pool.query(`
      INSERT INTO bookings (id, business_id, practitioner_id, service_id, client_id,
        start_at, end_at, status, booked_price_cents, created_at, appointment_mode)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW() - INTERVAL '${Math.abs(b.start_days)} days', 'cabinet')
      ON CONFLICT (id) DO UPDATE SET
        start_at = EXCLUDED.start_at, end_at = EXCLUDED.end_at, status = EXCLUDED.status,
        booked_price_cents = EXCLUDED.booked_price_cents, updated_at = NOW()
    `, [b.id, IDS.BUSINESS, b.prac, b.svc, b.client,
        dateOffsetH(b.start_days, b.start_hour), dateOffsetH(b.start_days, b.end_hour),
        b.status, b.price]);

    await pool.query(
      `INSERT INTO seed_tracking (entity_type, entity_id) VALUES ('booking_historique', $1)
       ON CONFLICT DO NOTHING`, [b.id]
    );
  }
}

module.exports = { seedBookingsHistorique };

if (require.main === module) {
  seedBookingsHistorique().then(() => { console.log('✓ 5 bookings historiques seeded'); process.exit(0); })
    .catch(e => { console.error(e); process.exit(1); });
}
```

- [ ] **Step 4: Run → PASS**

- [ ] **Step 5: Commit**

```bash
git add tests/e2e/fixtures/seeds/10-bookings-historique.js tests/seed-10-bookings.test.js
git commit -m "feat(e2e-infra): seed 10 — 5 bookings historiques (completed/no_show/cancelled)"
```

---

## Task 17 : Orchestrateur seed.js

**Files:**
- Create: `tests/e2e/fixtures/seed.js`

- [ ] **Step 1: Test**

Crée `tests/seed-orchestrator.test.js` :

```js
const assert = require('assert');
const { pool } = require('../src/services/db');
const { seedAll } = require('./e2e/fixtures/seed');
const IDS = require('./e2e/fixtures/ids');

(async () => {
  const t0 = Date.now();
  await seedAll();
  const duration = Date.now() - t0;
  console.log(`✓ full seed in ${duration}ms`);

  // Vérifier chaque entité majeure
  const checks = [
    { sql: `SELECT 1 FROM businesses WHERE id = $1 AND is_test_account = true`, id: IDS.BUSINESS, name: 'business' },
    { sql: `SELECT 1 FROM practitioners WHERE id = $1`, id: IDS.PRAC_ALICE, name: 'Alice' },
    { sql: `SELECT 1 FROM services WHERE id = $1`, id: IDS.SVC_LONG, name: 'SVC_LONG' },
    { sql: `SELECT 1 FROM clients WHERE id = $1`, id: IDS.CLIENT_JEAN, name: 'Jean' },
    { sql: `SELECT 1 FROM promotions WHERE id = $1`, id: IDS.PROMO_PCT, name: 'PROMO_PCT' },
    { sql: `SELECT 1 FROM gift_cards WHERE id = $1`, id: IDS.GC_ACTIVE, name: 'GC_ACTIVE' },
    { sql: `SELECT 1 FROM passes WHERE id = $1`, id: IDS.PASS_ACTIVE, name: 'PASS_ACTIVE' },
    { sql: `SELECT 1 FROM waitlist_entries WHERE id = $1`, id: IDS.WL_JEAN, name: 'WL_JEAN' },
    { sql: `SELECT 1 FROM bookings WHERE id = $1`, id: IDS.BK_COMPLETED_1, name: 'BK_COMPLETED_1' },
  ];
  for (const c of checks) {
    const r = await pool.query(c.sql, [c.id]);
    assert(r.rows.length === 1, `FAIL: ${c.name} missing`);
    console.log(`  ✓ ${c.name}`);
  }

  // Idempotence : 2nd full run
  await seedAll();
  console.log('✓ full seed idempotent');
  console.log('\n✓ seed-orchestrator OK');
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
```

- [ ] **Step 2: Run → FAIL**

- [ ] **Step 3: Créer**

Crée `tests/e2e/fixtures/seed.js` :

```js
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
  await seedServices();       // includes practitioner_services links
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
```

- [ ] **Step 4: Run → PASS**

- [ ] **Step 5: Commit**

```bash
git add tests/e2e/fixtures/seed.js tests/seed-orchestrator.test.js
git commit -m "feat(e2e-infra): seed orchestrator avec FK order strict + idempotence"
```

---

## Task 18 : Helpers api-client.js

**Files:**
- Create: `tests/e2e/fixtures/api-client.js`

- [ ] **Step 1: Créer**

Crée `tests/e2e/fixtures/api-client.js` :

```js
/**
 * E2E helpers: fetch authentifié staff/public + helpers DB.
 * Playwright native `request` fixture is preferred, but for node scripts we use fetch directly.
 */
const jwt = require('jsonwebtoken');
const IDS = require('./ids');
const BASE_URL = process.env.APP_BASE_URL || 'https://genda.be';

/**
 * Sign a JWT for a test user (owner or staff).
 * Uses same JWT_SECRET as prod.
 */
function signTestToken(userId, businessId, role = 'owner') {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error('JWT_SECRET missing — cannot sign test token');
  return jwt.sign(
    { id: userId, business_id: businessId, role },
    secret,
    { expiresIn: '1h' }
  );
}

function ownerToken() {
  return signTestToken(IDS.USER_ALICE_OWNER, IDS.BUSINESS, 'owner');
}
function staffToken() {
  return signTestToken(IDS.USER_BOB_STAFF, IDS.BUSINESS, 'staff');
}

/**
 * Authenticated staff fetch
 */
async function staffFetch(path, opts = {}) {
  const token = opts.token || ownerToken();
  const headers = { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json', ...(opts.headers || {}) };
  const res = await fetch(BASE_URL + path, { method: opts.method || 'GET', headers, body: opts.body ? JSON.stringify(opts.body) : undefined });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

/**
 * Public (unauthenticated) fetch
 */
async function publicFetch(path, opts = {}) {
  const headers = { 'Content-Type': 'application/json', ...(opts.headers || {}) };
  const res = await fetch(BASE_URL + path, { method: opts.method || 'GET', headers, body: opts.body ? JSON.stringify(opts.body) : undefined });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

/**
 * Fetch mock log entries (emails/SMS sent during test).
 */
async function getMockLogs(type, sinceTs) {
  const { pool } = require('../../../src/services/db');
  const r = await pool.query(
    `SELECT * FROM test_mock_log WHERE type = $1 AND created_at >= $2 ORDER BY created_at DESC`,
    [type, sinceTs]
  );
  return r.rows;
}

module.exports = { BASE_URL, signTestToken, ownerToken, staffToken, staffFetch, publicFetch, getMockLogs };
```

- [ ] **Step 2: Vérifier import**

```bash
node -e "const h = require('./tests/e2e/fixtures/api-client'); console.log(Object.keys(h))"
```

Expected : `['BASE_URL','signTestToken','ownerToken','staffToken','staffFetch','publicFetch','getMockLogs']`.

- [ ] **Step 3: Commit**

```bash
git add tests/e2e/fixtures/api-client.js
git commit -m "feat(e2e-infra): helpers api-client (auth JWT, fetch staff/public, getMockLogs)"
```

---

## Task 19 : Helpers stripe-test.js

**Files:**
- Create: `tests/e2e/fixtures/stripe-test.js`

- [ ] **Step 1: Créer**

Crée `tests/e2e/fixtures/stripe-test.js` :

```js
/**
 * Stripe test helpers : simulation webhooks avec signature valide.
 */
const Stripe = require('stripe');

const TEST_CARD_NUMBER = '4242424242424242';
const TEST_CARD_EXPIRY = '1234'; // 12/34
const TEST_CARD_CVC = '123';

function getStripeTest() {
  const key = process.env.STRIPE_SECRET_KEY_TEST || process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error('STRIPE_SECRET_KEY_TEST missing');
  return require('stripe')(key);
}

/**
 * Build a Stripe webhook event with valid signature.
 * @param {string} eventType - e.g. 'charge.refunded'
 * @param {object} dataObject - the `data.object` part
 * @returns {{ payload: string, signature: string }}
 */
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

/**
 * Fill Stripe Checkout card form with test card (Playwright).
 * @param {Page} page - Playwright page already on checkout.stripe.com
 */
async function fillTestCard(page) {
  await page.waitForURL(/checkout\.stripe\.com/);
  const frame = page.frameLocator('iframe[name*="card"]').first();
  await page.locator('[autocomplete="cc-number"]').fill(TEST_CARD_NUMBER);
  await page.locator('[autocomplete="cc-exp"]').fill(TEST_CARD_EXPIRY);
  await page.locator('[autocomplete="cc-csc"]').fill(TEST_CARD_CVC);
  await page.locator('[autocomplete="billing cc-name"]').fill('Test Cardholder');
  await page.locator('button[data-testid="hosted-payment-submit-button"]').click();
}

module.exports = { getStripeTest, buildSignedWebhook, fillTestCard, TEST_CARD_NUMBER, TEST_CARD_EXPIRY, TEST_CARD_CVC };
```

- [ ] **Step 2: Vérifier import**

```bash
node -e "const h = require('./tests/e2e/fixtures/stripe-test'); console.log(Object.keys(h))"
```

Expected : `['getStripeTest','buildSignedWebhook','fillTestCard','TEST_CARD_NUMBER','TEST_CARD_EXPIRY','TEST_CARD_CVC']`.

- [ ] **Step 3: Commit**

```bash
git add tests/e2e/fixtures/stripe-test.js
git commit -m "feat(e2e-infra): helpers stripe-test (webhook signé + Playwright card fill)"
```

---

## Task 20 : Playwright config

**Files:**
- Create: `tests/e2e/playwright.config.js`

- [ ] **Step 1: Créer**

Crée `tests/e2e/playwright.config.js` :

```js
// @ts-check
require('dotenv').config({ path: '.env.test' });
const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
  testDir: '.',
  testMatch: /.*\.spec\.js$/,
  timeout: 60 * 1000,            // 60s par test (certains flow Stripe longs)
  expect: { timeout: 10 * 1000 },
  fullyParallel: false,
  workers: 1,                     // série pour isolation
  retries: 0,                     // fail fast : corriger à la source
  reporter: [
    ['html', { outputFolder: 'playwright-report', open: 'never' }],
    ['list'],
    ['json', { outputFile: 'playwright-report/results.json' }]
  ],
  use: {
    baseURL: process.env.APP_BASE_URL || 'https://genda.be',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    actionTimeout: 15 * 1000,
    navigationTimeout: 30 * 1000,
  },
  globalSetup: require.resolve('./global-setup'),
  globalTeardown: require.resolve('./global-teardown'),
  outputDir: 'test-results',
});
```

- [ ] **Step 2: Vérifier**

```bash
npx playwright test --config=tests/e2e/playwright.config.js --list 2>&1 | head -5
```

Expected : pas de crash (même si 0 tests listés).

- [ ] **Step 3: Commit**

```bash
git add tests/e2e/playwright.config.js
git commit -m "feat(e2e-infra): playwright config (serial, retry=0, HTML+JSON reporters)"
```

---

## Task 21 : global-setup.js

**Files:**
- Create: `tests/e2e/global-setup.js`

- [ ] **Step 1: Créer**

Crée `tests/e2e/global-setup.js` :

```js
/**
 * Runs ONCE before all tests.
 * 1. Detect orphans from previous crashed runs → cleanup
 * 2. Run seed bootstrap (idempotent)
 * 3. Set TEST_RUN_START_TS env var so teardown knows when this run began
 */
require('dotenv').config({ path: '.env.test' });
const { pool } = require('../../src/services/db');
const { seedAll } = require('./fixtures/seed');
const IDS = require('./fixtures/ids');

async function detectAndCleanOrphans() {
  // Orphan = entity created on TEST business after last seed run, not in seed_tracking.
  const lastSeed = await pool.query(
    `SELECT COALESCE(MAX(seeded_at), '1970-01-01'::timestamptz) AS last_seeded FROM seed_tracking`
  );
  const lastSeeded = lastSeed.rows[0].last_seeded;

  const orphanBookings = await pool.query(
    `SELECT COUNT(*)::int AS c FROM bookings b
     WHERE b.business_id = $1 AND b.created_at > $2
       AND NOT EXISTS (SELECT 1 FROM seed_tracking st WHERE st.entity_id = b.id)`,
    [IDS.BUSINESS, lastSeeded]
  );

  if (orphanBookings.rows[0].c > 0) {
    console.warn(`[SETUP] Cleaning ${orphanBookings.rows[0].c} orphan bookings from previous run...`);
    await pool.query(`
      DELETE FROM bookings
      WHERE business_id = $1 AND created_at > $2
        AND id NOT IN (SELECT entity_id FROM seed_tracking WHERE entity_type IN ('booking_historique'))
    `, [IDS.BUSINESS, lastSeeded]);
  }
  // De même pour invoices, gift_cards (hors seed), etc si besoin :
  await pool.query(`
    DELETE FROM test_mock_log
    WHERE created_at < NOW() - INTERVAL '1 day'
  `);
}

module.exports = async () => {
  console.log('\n[GLOBAL SETUP] Starting...');
  const t0 = Date.now();

  // Safety : TEST_BUSINESS_ID must match IDS.BUSINESS
  if (process.env.TEST_BUSINESS_ID && process.env.TEST_BUSINESS_ID !== IDS.BUSINESS) {
    throw new Error(`TEST_BUSINESS_ID mismatch: env=${process.env.TEST_BUSINESS_ID}, ids.js=${IDS.BUSINESS}`);
  }

  // 1. Clean orphans
  await detectAndCleanOrphans();

  // 2. Seed
  await seedAll();

  // 3. Mark run start
  const runStart = new Date().toISOString();
  process.env.TEST_RUN_START_TS = runStart;
  // Write to a file so teardown can read it (workers don't share process.env)
  require('fs').writeFileSync('tests/e2e/.run-start-ts', runStart);

  console.log(`[GLOBAL SETUP] Done in ${Date.now() - t0}ms. Run started at ${runStart}\n`);
};
```

- [ ] **Step 2: Vérifier sans tests**

```bash
npx playwright test --config=tests/e2e/playwright.config.js 2>&1 | tail -5
```

Expected : setup tourne, pas de tests, teardown pas encore défini peut erreur.

- [ ] **Step 3: Commit**

```bash
git add tests/e2e/global-setup.js
git commit -m "feat(e2e-infra): global-setup — orphan cleanup + seedAll + RUN_START_TS"
```

---

## Task 22 : global-teardown.js (cleanup + résumé console)

**Files:**
- Create: `tests/e2e/global-teardown.js`

- [ ] **Step 1: Créer**

Crée `tests/e2e/global-teardown.js` :

```js
require('dotenv').config({ path: '.env.test' });
const fs = require('fs');
const path = require('path');
const { pool } = require('../../src/services/db');
const IDS = require('./fixtures/ids');

// ANSI colors
const C = { RESET: '\x1b[0m', GREEN: '\x1b[32m', RED: '\x1b[31m', YELLOW: '\x1b[33m', BOLD: '\x1b[1m', DIM: '\x1b[2m', CYAN: '\x1b[36m' };

async function cleanup(runStart) {
  if (!runStart) { console.warn('[TEARDOWN] No runStart, skipping cleanup'); return; }

  // Safety guards
  const bid = IDS.BUSINESS;
  if (!bid || bid.length !== 36) throw new Error('TEST_BUSINESS_ID invalid');
  const check = await pool.query(`SELECT is_test_account FROM businesses WHERE id = $1`, [bid]);
  if (!check.rows[0]?.is_test_account) {
    throw new Error(`ABORT: business ${bid} is NOT a test account — cleanup aborted`);
  }

  await pool.query('BEGIN');
  try {
    // Ordre enfants → parents (FK-safe)
    const tables = [
      ['gift_card_transactions', 'business_id'],
      ['pass_transactions', 'business_id'],
      ['invoice_items', 'invoice_id IN (SELECT id FROM invoices WHERE business_id = $1 AND created_at >= $2)'],
      ['invoices', 'business_id'],
      ['notifications', 'business_id'],
      ['bookings', 'business_id'],
      ['waitlist_entries', 'business_id'],
      ['gift_cards', 'business_id'],
      ['passes', 'business_id'],
      ['audit_logs', 'business_id'],
    ];
    for (const [table, col] of tables) {
      if (col === 'business_id') {
        await pool.query(
          `DELETE FROM ${table} WHERE business_id = $1 AND created_at >= $2
           AND id NOT IN (SELECT entity_id FROM seed_tracking WHERE entity_id IS NOT NULL)`,
          [bid, runStart]
        );
      } else {
        await pool.query(`DELETE FROM ${table} WHERE ${col}`, [bid, runStart]);
      }
    }
    // Clients créés pendant le run (pas les permanents seed)
    await pool.query(
      `DELETE FROM clients WHERE business_id = $1 AND created_at >= $2
       AND id NOT IN (SELECT entity_id FROM seed_tracking WHERE entity_type = 'client')`,
      [bid, runStart]
    );
    // test_mock_log : DELETE tout ce qui date du run
    await pool.query(`DELETE FROM test_mock_log WHERE created_at >= $1`, [runStart]);

    await pool.query('COMMIT');
    console.log(`${C.DIM}[TEARDOWN] Cleanup OK (runStart=${runStart})${C.RESET}`);
  } catch (e) {
    await pool.query('ROLLBACK');
    console.error(`${C.RED}[TEARDOWN] Cleanup failed: ${e.message}${C.RESET}`);
    throw e;
  }
}

function printSummary() {
  const reportPath = path.join(__dirname, 'playwright-report', 'results.json');
  if (!fs.existsSync(reportPath)) {
    console.log(`${C.YELLOW}[TEARDOWN] No report found, skipping summary${C.RESET}`);
    return;
  }
  const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
  const stats = report.stats || {};
  const { expected = 0, unexpected = 0, skipped = 0, flaky = 0, duration = 0 } = stats;
  const total = expected + unexpected + skipped + flaky;

  const byCategory = {};
  function walk(suite, fileName = '') {
    if (suite.file) fileName = suite.file;
    const catMatch = fileName.match(/C(\d+)-[^/]+/);
    const cat = catMatch ? catMatch[0] : 'misc';
    byCategory[cat] ??= { passed: 0, failed: 0, skipped: 0, fails: [], duration: 0 };
    for (const spec of (suite.specs || [])) {
      for (const t of (spec.tests || [])) {
        const res = t.results?.[0];
        if (!res) continue;
        byCategory[cat].duration += res.duration || 0;
        if (res.status === 'passed') byCategory[cat].passed++;
        else if (res.status === 'failed' || res.status === 'timedOut') {
          byCategory[cat].failed++;
          byCategory[cat].fails.push({ title: spec.title, error: (res.error?.message || 'no msg').slice(0, 100) });
        } else if (res.status === 'skipped') byCategory[cat].skipped++;
      }
    }
    for (const sub of (suite.suites || [])) walk(sub, fileName);
  }
  for (const s of (report.suites || [])) walk(s);

  const bar = '═'.repeat(69);
  const line = '━'.repeat(69);
  console.log(`\n${C.BOLD}╔${bar}╗`);
  console.log(`║  GENDA E2E — ${new Date().toLocaleString('fr-BE')}  ${' '.repeat(Math.max(0, 42 - new Date().toLocaleString('fr-BE').length))}║`);
  console.log(`╚${bar}╝${C.RESET}\n`);

  const successRate = total > 0 ? ((expected / total) * 100).toFixed(1) : '0';
  const statusColor = unexpected > 0 ? C.RED : (skipped > 0 ? C.YELLOW : C.GREEN);
  console.log(`  ${statusColor}${C.BOLD}${expected}/${total} passed  (${successRate}%)${C.RESET}`);
  if (unexpected > 0) console.log(`  ${C.RED}✗ ${unexpected} failed${C.RESET}`);
  if (skipped > 0) console.log(`  ${C.DIM}⊘ ${skipped} skipped${C.RESET}`);
  if (flaky > 0) console.log(`  ${C.YELLOW}⚠ ${flaky} flaky${C.RESET}`);

  console.log(`\n${C.CYAN}${line} Par catégorie ${line}${C.RESET}`);
  const cats = Object.keys(byCategory).sort();
  for (const cat of cats) {
    const c = byCategory[cat];
    const catTotal = c.passed + c.failed + c.skipped;
    const icon = c.failed > 0 ? `${C.RED}✗${C.RESET}` : (c.skipped > 0 && c.passed === 0 ? `${C.YELLOW}⊘${C.RESET}` : `${C.GREEN}✓${C.RESET}`);
    const pct = catTotal > 0 ? Math.round((c.passed / catTotal) * 100) : 0;
    const secs = (c.duration / 1000).toFixed(1);
    console.log(`  ${icon} ${cat.padEnd(36)} ${c.passed}/${catTotal}  ${String(pct).padStart(3)}%  ${secs}s`);
    for (const f of c.fails) {
      console.log(`      ${C.RED}✗${C.RESET} ${f.title.slice(0, 50).padEnd(50)}  ${C.DIM}${f.error}${C.RESET}`);
    }
  }

  const totalSec = (duration / 1000).toFixed(0);
  console.log(`\n${C.BOLD}Temps total: ${Math.floor(totalSec / 60)}min ${totalSec % 60}s${C.RESET}`);
  console.log(`\n${C.DIM}HTML report    : npm run test:e2e:report`);
  console.log(`Re-run fails   : npx playwright test --last-failed`);
  console.log(`${C.RESET}`);
}

module.exports = async () => {
  console.log('\n[GLOBAL TEARDOWN] Starting...');
  // Read run start timestamp
  let runStart;
  try { runStart = fs.readFileSync('tests/e2e/.run-start-ts', 'utf8').trim(); } catch (e) {}

  try {
    await cleanup(runStart);
  } catch (e) {
    console.error(`[TEARDOWN] Cleanup error: ${e.message}`);
  }

  printSummary();

  // Clean up run-start file
  try { fs.unlinkSync('tests/e2e/.run-start-ts'); } catch (e) {}

  await pool.end();
};
```

- [ ] **Step 2: Vérifier sans tests**

```bash
npx playwright test --config=tests/e2e/playwright.config.js 2>&1 | tail -10
```

Expected : setup OK, 0 tests, teardown affiche résumé vide.

- [ ] **Step 3: Commit**

```bash
git add tests/e2e/global-teardown.js
git commit -m "feat(e2e-infra): global-teardown — cleanup sécurisé + résumé console coloré"
```

---

## Task 23 : Smoke spec (validation infra)

**Files:**
- Create: `tests/e2e/smoke.spec.js`

- [ ] **Step 1: Créer**

Crée `tests/e2e/smoke.spec.js` :

```js
const { test, expect } = require('@playwright/test');
const IDS = require('./fixtures/ids');
const { publicFetch, staffFetch, getMockLogs } = require('./fixtures/api-client');

test.describe('Smoke — infrastructure', () => {

  test('seed business TEST exists with is_test_account=true', async () => {
    const { pool } = require('../../src/services/db');
    const r = await pool.query(`SELECT is_test_account, slug FROM businesses WHERE id = $1`, [IDS.BUSINESS]);
    expect(r.rows.length).toBe(1);
    expect(r.rows[0].is_test_account).toBe(true);
    expect(r.rows[0].slug).toBe('test-demo-salon');
  });

  test('public minisite loads for TEST business', async ({ request }) => {
    const res = await request.get(`/api/public/${'test-demo-salon'}`);
    expect(res.ok()).toBeTruthy();
  });

  test('staff login as Alice returns 200', async () => {
    const { body, status } = await staffFetch('/api/auth/me');
    expect(status).toBe(200);
    expect(body.user?.email || body.email).toContain('alice-test');
  });

  test('SKIP_EMAIL=1 writes to test_mock_log (not Brevo)', async () => {
    const { sendEmail } = require('../../src/services/email-utils');
    const before = await getMockLogs('email', new Date(Date.now() - 60000).toISOString());
    const beforeCount = before.length;

    await sendEmail({
      to: 'smoke-test@genda-test.be',
      subject: 'Smoke',
      html: '<p>Smoke test</p>',
      template: 'smoke_test'
    });

    const after = await getMockLogs('email', new Date(Date.now() - 60000).toISOString());
    expect(after.length).toBeGreaterThanOrEqual(beforeCount + 1);
  });
});
```

- [ ] **Step 2: Run smoke**

```bash
npx playwright test --config=tests/e2e/playwright.config.js smoke.spec.js
```

Expected : 4 tests passed.

- [ ] **Step 3: Vérifier HTML report**

```bash
npx playwright show-report tests/e2e/playwright-report --host 0.0.0.0 &
# Open http://localhost:9323 dans navigateur, vérifier 4 tests green
```

- [ ] **Step 4: Commit**

```bash
git add tests/e2e/smoke.spec.js
git commit -m "feat(e2e-infra): smoke.spec.js — 4 tests valident infra (business, minisite, login, email mock)"
```

---

## Task 24 : Scripts package.json + .gitignore + .env.test.example

**Files:**
- Modify: `package.json` (scripts section)
- Modify: `.gitignore`
- Create: `.env.test.example`

- [ ] **Step 1: Update package.json**

Dans `package.json`, ajouter dans `"scripts"` :

```json
"test:e2e": "playwright test --config=tests/e2e/playwright.config.js",
"test:e2e:smoke": "playwright test --config=tests/e2e/playwright.config.js smoke.spec.js",
"test:e2e:ui": "playwright test --ui --config=tests/e2e/playwright.config.js",
"test:e2e:debug": "PWDEBUG=1 playwright test --config=tests/e2e/playwright.config.js",
"test:e2e:bootstrap": "node tests/e2e/fixtures/seed.js",
"test:e2e:cleanup": "node scripts/test-cleanup-force.js",
"test:e2e:nuke": "node scripts/test-nuke.js",
"test:e2e:report": "playwright show-report tests/e2e/playwright-report",
"test:e2e:last-failed": "playwright test --last-failed --config=tests/e2e/playwright.config.js"
```

- [ ] **Step 2: Update .gitignore**

Ajouter à la fin de `.gitignore` :

```
# E2E tests
.env.test
tests/e2e/playwright-report/
tests/e2e/test-results/
tests/e2e/.run-start-ts
```

- [ ] **Step 3: Créer .env.test.example**

Crée `.env.test.example` :

```bash
# Genda E2E tests — copy to .env.test and fill in
# NEVER commit .env.test (gitignored)

# Production DB (test data isolated via is_test_account flag)
DATABASE_URL=postgresql://gendadb_user:XXX@dpg-xxx.oregon-postgres.render.com/gendadb

# Stripe TEST mode keys (NOT live)
STRIPE_SECRET_KEY=sk_test_XXX
STRIPE_SECRET_KEY_TEST=sk_test_XXX
STRIPE_PUBLISHABLE_KEY=pk_test_XXX
STRIPE_WEBHOOK_SECRET=whsec_test_XXX
STRIPE_CONNECT_TEST_ACCOUNT=acct_test_XXX

# App URL (prod Render)
APP_BASE_URL=https://genda.be

# JWT (same secret as prod so tokens work)
JWT_SECRET=<copy-from-render-env>

# Mock externals
SKIP_EMAIL=1
SKIP_SMS=1

# Test business ID (matches ids.js TEST_IDS.BUSINESS)
TEST_BUSINESS_ID=00000000-0000-4000-8000-000000000001
```

- [ ] **Step 4: Verify**

```bash
cat .env.test.example | wc -l
# Expected: ~20 lines
npm run test:e2e:smoke 2>&1 | tail -5
```

- [ ] **Step 5: Commit**

```bash
git add package.json .gitignore .env.test.example
git commit -m "feat(e2e-infra): scripts npm + gitignore + .env.test.example"
```

---

## Task 25 : Scripts de cleanup manuels (test-cleanup-force + test-nuke)

**Files:**
- Create: `scripts/test-cleanup-force.js`
- Create: `scripts/test-nuke.js`

- [ ] **Step 1: Créer test-cleanup-force.js**

Crée `scripts/test-cleanup-force.js` :

```js
#!/usr/bin/env node
/**
 * Manual cleanup : deletes ALL run data (bookings, invoices, GCs bought, etc.)
 * Preserves the seed (business TEST, services, practitioners, etc.)
 * Usage: npm run test:e2e:cleanup
 */
require('dotenv').config({ path: '.env.test' });
const readline = require('readline');
const { pool } = require('../src/services/db');
const IDS = require('../tests/e2e/fixtures/ids');

function ask(q) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(res => rl.question(q, ans => { rl.close(); res(ans); }));
}

(async () => {
  const bid = IDS.BUSINESS;
  const check = await pool.query(`SELECT name, is_test_account FROM businesses WHERE id = $1`, [bid]);
  if (check.rows.length === 0) { console.error('TEST business not found'); process.exit(1); }
  if (!check.rows[0].is_test_account) { console.error('ABORT: not a test account'); process.exit(1); }

  console.log(`\nBusiness: ${check.rows[0].name}`);
  console.log('This will DELETE ALL bookings/invoices/GCs/passes/waitlist data EXCEPT the seed.');
  const ans = await ask('\nConfirm [yes/no]: ');
  if (ans.trim().toLowerCase() !== 'yes') { console.log('Cancelled.'); process.exit(0); }

  const tables = [
    'gift_card_transactions', 'pass_transactions', 'invoice_items', 'invoices',
    'notifications', 'bookings', 'waitlist_entries', 'gift_cards', 'passes',
    'audit_logs', 'test_mock_log'
  ];
  for (const t of tables) {
    if (t === 'invoice_items') {
      await pool.query(`DELETE FROM invoice_items WHERE invoice_id IN (SELECT id FROM invoices WHERE business_id = $1)
        AND invoice_id NOT IN (SELECT entity_id FROM seed_tracking WHERE entity_id IS NOT NULL)`, [bid]);
    } else if (t === 'test_mock_log') {
      await pool.query(`DELETE FROM test_mock_log`);
    } else {
      await pool.query(
        `DELETE FROM ${t} WHERE business_id = $1
         AND id NOT IN (SELECT entity_id FROM seed_tracking WHERE entity_id IS NOT NULL)`,
        [bid]
      );
    }
    console.log(`  ✓ ${t}`);
  }
  console.log('\n✓ Cleanup complete. Seed preserved. Re-run bootstrap if needed.');
  await pool.end();
})();
```

- [ ] **Step 2: Créer test-nuke.js**

Crée `scripts/test-nuke.js` :

```js
#!/usr/bin/env node
/**
 * Nuclear reset : DELETE the entire TEST business and ALL related data.
 * After, run `npm run test:e2e:bootstrap` to recreate.
 * Usage: npm run test:e2e:nuke
 */
require('dotenv').config({ path: '.env.test' });
const readline = require('readline');
const { pool } = require('../src/services/db');
const IDS = require('../tests/e2e/fixtures/ids');

function ask(q) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(res => rl.question(q, ans => { rl.close(); res(ans); }));
}

(async () => {
  const bid = IDS.BUSINESS;
  const check = await pool.query(`SELECT name, is_test_account FROM businesses WHERE id = $1`, [bid]);
  if (check.rows.length === 0) { console.log('TEST business already absent. Nothing to do.'); process.exit(0); }
  if (!check.rows[0].is_test_account) { console.error('ABORT: not a test account'); process.exit(1); }

  console.log(`\n⚠️  NUCLEAR NUKE: DELETE business "${check.rows[0].name}" + ALL data`);
  const ans1 = await ask('Type "NUKE" to confirm (1/2): ');
  if (ans1.trim() !== 'NUKE') { console.log('Cancelled.'); process.exit(0); }
  const ans2 = await ask('Type "NUKE" again to confirm (2/2): ');
  if (ans2.trim() !== 'NUKE') { console.log('Cancelled.'); process.exit(0); }

  // CASCADE DELETE via FKs or explicit ordering
  await pool.query('BEGIN');
  try {
    const order = [
      'gift_card_transactions', 'pass_transactions', 'invoice_items', 'invoices',
      'notifications', 'bookings', 'waitlist_entries', 'gift_cards', 'passes',
      'audit_logs', 'clients', 'practitioner_services', 'practitioner_hours',
      'practitioners', 'business_hours', 'service_variants', 'services', 'promotions'
    ];
    for (const t of order) {
      await pool.query(`DELETE FROM ${t} WHERE business_id = $1`, [bid]);
    }
    await pool.query(`DELETE FROM users WHERE id IN ($1, $2, $3)`,
      [IDS.USER_ALICE_OWNER, IDS.USER_BOB_STAFF, IDS.USER_CAROL_STAFF]);
    await pool.query(`DELETE FROM businesses WHERE id = $1`, [bid]);
    await pool.query(`DELETE FROM seed_tracking`);
    await pool.query(`DELETE FROM test_mock_log`);
    await pool.query('COMMIT');
    console.log('\n✓ Nuke complete. Run `npm run test:e2e:bootstrap` to recreate.');
  } catch (e) {
    await pool.query('ROLLBACK');
    console.error('Nuke failed:', e.message);
    process.exit(1);
  }
  await pool.end();
})();
```

- [ ] **Step 3: Commit**

```bash
git add scripts/test-cleanup-force.js scripts/test-nuke.js
git commit -m "feat(e2e-infra): scripts manuels test-cleanup-force (yes/no) + test-nuke (NUKE×2)"
```

---

## Task 26 : GitHub Actions workflow

**Files:**
- Create: `.github/workflows/e2e.yml`

- [ ] **Step 1: Créer le workflow**

Crée `.github/workflows/e2e.yml` :

```yaml
name: E2E Tests (manual)

on:
  workflow_dispatch:
    inputs:
      category:
        description: 'Catégorie à tester (vide = toutes)'
        required: false
        default: ''
        type: string

jobs:
  e2e:
    runs-on: ubuntu-latest
    timeout-minutes: 90
    steps:
      - uses: actions/checkout@v4

      - name: Setup Node
        uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'

      - name: Install deps
        run: npm ci

      - name: Install Playwright browsers
        run: npx playwright install --with-deps chromium

      - name: Create .env.test
        run: |
          cat > .env.test <<EOF
          DATABASE_URL=${{ secrets.TEST_DATABASE_URL }}
          STRIPE_SECRET_KEY=${{ secrets.STRIPE_TEST_SECRET_KEY }}
          STRIPE_SECRET_KEY_TEST=${{ secrets.STRIPE_TEST_SECRET_KEY }}
          STRIPE_PUBLISHABLE_KEY=${{ secrets.STRIPE_TEST_PUBLISHABLE_KEY }}
          STRIPE_WEBHOOK_SECRET=${{ secrets.STRIPE_TEST_WEBHOOK_SECRET }}
          STRIPE_CONNECT_TEST_ACCOUNT=${{ secrets.STRIPE_CONNECT_TEST_ACCOUNT }}
          SKIP_EMAIL=1
          SKIP_SMS=1
          APP_BASE_URL=https://genda.be
          JWT_SECRET=${{ secrets.JWT_SECRET }}
          TEST_BUSINESS_ID=00000000-0000-4000-8000-000000000001
          EOF

      - name: Bootstrap test data
        run: npm run test:e2e:bootstrap

      - name: Run E2E
        run: |
          if [ -z "${{ inputs.category }}" ]; then
            npm run test:e2e
          else
            npx playwright test --config=tests/e2e/playwright.config.js tests/e2e/${{ inputs.category }}
          fi

      - name: Upload HTML report
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: playwright-report-${{ github.run_number }}
          path: tests/e2e/playwright-report/
          retention-days: 30

      - name: Upload traces on failure
        if: failure()
        uses: actions/upload-artifact@v4
        with:
          name: playwright-traces-${{ github.run_number }}
          path: tests/e2e/test-results/
          retention-days: 14
```

- [ ] **Step 2: Commit**

```bash
git add .github/workflows/e2e.yml
git commit -m "feat(e2e-infra): GitHub Actions workflow (manual trigger + input catégorie)"
```

---

## Task 27 : README.md tests

**Files:**
- Create: `tests/README.md`

- [ ] **Step 1: Créer**

Crée `tests/README.md` :

````markdown
# Genda E2E Tests

Suite de tests automatisés couvrant tous les flows business (client + staff).

## Setup (première fois)

1. Créer `.env.test` en copiant `.env.test.example` :
   ```
   cp .env.test.example .env.test
   ```

2. Remplir les valeurs :
   - `DATABASE_URL` : connection string Render (même que prod)
   - `STRIPE_SECRET_KEY_TEST` : `sk_test_XXX` depuis Stripe dashboard (mode test)
   - `STRIPE_WEBHOOK_SECRET` : secret webhook pour le mode test
   - `STRIPE_CONNECT_TEST_ACCOUNT` : `acct_test_XXX` (créer 1× via Stripe Connect test)
   - `JWT_SECRET` : même valeur que `JWT_SECRET` dans ton env Render prod

3. Installer les deps + browser :
   ```
   npm install
   npx playwright install chromium
   ```

4. Bootstrap du seed (crée le business TEST + ses dépendances) :
   ```
   npm run test:e2e:bootstrap
   ```

## Usage quotidien

### Lancer tous les tests

```bash
npm run test:e2e
```

Durée : ~50-60 min (180 tests en série).

### Lancer une catégorie seulement

```bash
npx playwright test --config=tests/e2e/playwright.config.js tests/e2e/C03-promos-edge
```

### Lancer le smoke (valide l'infra)

```bash
npm run test:e2e:smoke
```

### Debug interactif

```bash
npm run test:e2e:ui       # Playwright UI mode (live watch)
npm run test:e2e:debug    # Playwright Inspector (step-by-step)
```

### Ré-exécuter uniquement les tests qui ont foiré

```bash
npm run test:e2e:last-failed
```

### Voir le HTML report

```bash
npm run test:e2e:report
# Ouvre http://localhost:9323
```

## Nettoyage

### Cleanup partiel (garde le seed)

```bash
npm run test:e2e:cleanup
# Confirme avec "yes"
```

### Reset nucléaire (DELETE le business TEST)

```bash
npm run test:e2e:nuke
# Confirme "NUKE" × 2, puis re-bootstrap
```

## Exécution via GitHub Actions

Depuis l'UI GitHub : Actions → "E2E Tests (manual)" → Run workflow → choisir category (ou vide pour tout) → Run.

Secrets requis dans GHA (Settings → Secrets) :
- `TEST_DATABASE_URL`, `STRIPE_TEST_SECRET_KEY`, `STRIPE_TEST_WEBHOOK_SECRET`, `STRIPE_CONNECT_TEST_ACCOUNT`, `JWT_SECRET`, `STRIPE_TEST_PUBLISHABLE_KEY`

## Architecture

- **Business TEST** (`is_test_account=true`) persistant en prod, cleanup filtré
- **Mocks Brevo/Twilio** via flags `SKIP_EMAIL=1` / `SKIP_SMS=1` → écrit dans table `test_mock_log`
- **Stripe** : clé test via `STRIPE_SECRET_KEY` (env complet en mode test)
- **Seed idempotent** : `tests/e2e/fixtures/seeds/` modulaire, UUIDs déterministes dans `ids.js`
- **Cleanup** : filtre `created_at >= runStart` + exclusion `seed_tracking`

## Troubleshooting

**Q : Un test plante, data orpheline en DB.**
A : `npm run test:e2e:cleanup` → supprime tout sauf le seed.

**Q : Le seed est corrompu.**
A : `npm run test:e2e:nuke` puis `npm run test:e2e:bootstrap`.

**Q : Les tests échouent tous avec "business not found".**
A : Bootstrap pas fait. `npm run test:e2e:bootstrap`.

**Q : "STRIPE_SECRET_KEY missing"**
A : Vérifier `.env.test` existe et contient `STRIPE_SECRET_KEY=sk_test_XXX`.
````

- [ ] **Step 2: Commit**

```bash
git add tests/README.md
git commit -m "docs(e2e-infra): README tests (setup, usage, troubleshooting)"
```

---

## Task 28 : Validation finale — smoke full cycle

- [ ] **Step 1: Reset complet**

```bash
npm run test:e2e:nuke         # DELETE business TEST (confirm NUKE×2)
npm run test:e2e:bootstrap    # Re-crée tout
```

Expected : `✓ Full seed complete in Xms`.

- [ ] **Step 2: Lancer smoke**

```bash
npm run test:e2e:smoke
```

Expected : 4 tests passed, cleanup OK en teardown, résumé console s'affiche avec "4/4 passed".

- [ ] **Step 3: Vérifier cleanup**

```bash
# Check no orphan data
node -e "
const { pool } = require('./src/services/db');
const IDS = require('./tests/e2e/fixtures/ids');
(async () => {
  const r = await pool.query(\`SELECT COUNT(*) AS c FROM bookings WHERE business_id = \$1\`, [IDS.BUSINESS]);
  console.log('Bookings after cleanup:', r.rows[0].c);
  // Should only have the 5 historique from seed
  if (parseInt(r.rows[0].c) !== 5) { console.error('FAIL: expected 5 historique bookings'); process.exit(1); }
  console.log('✓ cleanup preserved seed');
  process.exit(0);
})();
"
```

Expected : `Bookings after cleanup: 5` + `✓ cleanup preserved seed`.

- [ ] **Step 4: Vérifier HTML report**

```bash
npm run test:e2e:report &
sleep 2
# Ouvrir http://localhost:9323 — vérifier 4 tests green, temps total affiché, pas de failed
```

- [ ] **Step 5: Vérifier GHA workflow (manuel)**

Commit + push, puis sur github.com/Damdidam/bookt → Actions → "E2E Tests (manual)" → Run workflow → catégorie vide → Run. Attendre completion (~5 min pour juste le smoke + bootstrap).

Expected : workflow green, artifact `playwright-report-<N>` téléchargeable.

- [ ] **Step 6: Commit final**

```bash
git add -f dist/  # si dist a bougé (probablement pas pour cette phase)
git commit --allow-empty -m "chore(e2e-infra): Phase 1 infrastructure complète ✓"
git push origin main
```

---

## Self-Review (rempli par l'écrivain du plan)

**1. Spec coverage**

Spec section → Task couvrant :
- ✅ Migration schema-v73 → Task 1
- ✅ Helper Stripe central → Task 2
- ✅ Mock SKIP_EMAIL → Task 3
- ✅ Mock SKIP_SMS → Task 4
- ✅ Install Playwright → Task 5
- ✅ UUIDs déterministes → Task 6
- ✅ Seed business → Task 7
- ✅ Seed praticiens → Task 8
- ✅ Seed services + variants → Task 9
- ✅ Seed horaires → Task 10
- ✅ Seed clients → Task 11
- ✅ Seed promotions → Task 12
- ✅ Seed GC → Task 13
- ✅ Seed passes → Task 14
- ✅ Seed waitlist → Task 15
- ✅ Seed bookings historique → Task 16
- ✅ Seed orchestrator → Task 17
- ✅ api-client helpers → Task 18
- ✅ stripe-test helpers → Task 19
- ✅ Playwright config → Task 20
- ✅ global-setup → Task 21
- ✅ global-teardown + résumé console → Task 22
- ✅ Smoke spec → Task 23
- ✅ Scripts npm + gitignore + .env.example → Task 24
- ✅ Scripts cleanup manuel → Task 25
- ✅ GitHub Actions workflow → Task 26
- ✅ README → Task 27
- ✅ Validation full cycle → Task 28

Pas de gap identifié.

**2. Placeholder scan**

Aucun "TBD", "TODO", "implement later" dans le plan. Tous les blocs de code sont complets.

**3. Type consistency**

- `IDS` = `TEST_IDS` exporté depuis `ids.js` ? ids.js `module.exports = { BUSINESS, ... }` → tasks importent `const IDS = require('../ids')` puis utilisent `IDS.BUSINESS`. Cohérent.
- `seedAll()` exporté depuis `tests/e2e/fixtures/seed.js` → global-setup `require('./fixtures/seed').seedAll()` → cohérent.
- `getMockLogs(type, sinceTs)` signature : exported from `api-client.js`, used in smoke.spec.js. Cohérent.
- `buildSignedWebhook(type, dataObject)` signature : exported from `stripe-test.js`. Pas utilisé dans les tasks Phase 1 (réservé Phase 5), mais exporté pour phases suivantes.

Un point à corriger : dans seed 02-practitioners.js, je référence `bcryptjs` — le package.json contient-il bcryptjs ? Vérifier.

---

## Execution Handoff

**Plan complete and saved to `docs/superpowers/plans/2026-04-18-tests-e2e-phase-1-infra.md`.** Two execution options :

**1. Subagent-Driven (recommended)** — je dispatch un fresh subagent par task, review entre chaque, itération rapide.

**2. Inline Execution** — j'exécute les tasks dans cette session avec checkpoints pour review.

Which approach ?
