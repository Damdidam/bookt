# Tests E2E Genda — Design

**Date :** 2026-04-18
**Objectif :** Suite de tests automatisés exhaustive couvrant tous les flows business
de Genda (client + commerçant), permettant de valider le passage en prod et de
détecter les régressions avant chaque deploy.

## Contexte

Genda (Bookt) approche le passage en production. À ce jour :
- Un seul environnement (Render production).
- Tests existants limités à `tests/sanity.js` (API uniquement, couverture
  partielle).
- Aucun outil E2E UI (Playwright/Cypress).
- Historique d'audits montre ~150-180 bugs identifiés sur 8 passes, dont
  ~43 fixés récemment. Besoin d'une couverture continue pour éviter les
  régressions sur les flows financiers, légaux et opérationnels.

Le passage en prod nécessite une confiance élevée sur :
- Le flow de réservation public (tout combo service × promo × LM × GC × pass).
- Les refunds Stripe (politiques full/net, retention fees>charge).
- La légalité BE (factures, notes de crédit, TVA multi-taux).
- Les notifications (emails + SMS envoyés au bon moment avec le bon contenu).
- La cohérence multi-tenant (RLS, impersonation, RBAC).

## Décisions clés

| # | Décision | Choix |
|---|---|---|
| 1 | Portée | UI (Playwright browser) + API combinées |
| 2 | Environnement | Prod Render + business TEST dédié (pas de staging pour le moment) |
| 3 | Stratégie mocks | Hybride : Stripe sandbox (test mode) + Brevo/Twilio mock via env flags |
| 4 | Isolation data | Business TEST persistant avec flag `is_test_account`, cleanup par timestamp |
| 5 | Outil | Playwright Test natif (runner + browser + API + reports HTML) |
| 6 | Fréquence | Manuel : local (`npm run test:e2e`) + GitHub Actions button (workflow_dispatch) |
| 7 | Reporting | HTML report Playwright natif + résumé console custom en fin de run |
| 8 | Bootstrap | Seed script idempotent (`scripts/test-bootstrap.js`) versionné Git |
| 9 | Parallélisation | Série (1 worker) pour commencer — YAGNI sur l'isolation inter-tests |
| 10 | Catalogue | 20 catégories, ~180 scénarios exhaustifs (C01-C20) |

## Architecture

### Stack

- `@playwright/test` — runner, browser engines, API testing, reporter HTML
- `pg` — accès direct DB pour seed/cleanup
- `dotenv` — env vars locales

### Structure fichiers

```
tests/
├── e2e/
│   ├── playwright.config.js
│   ├── global-setup.js
│   ├── global-teardown.js
│   ├── fixtures/
│   │   ├── seed.js
│   │   ├── ids.js                     # UUIDs fixes déterministes
│   │   ├── api-client.js              # helpers fetch authentifié
│   │   ├── stripe-test.js             # helpers carte 4242 + webhooks
│   │   └── seeds/
│   │       ├── 01-business.js
│   │       ├── 02-practitioners.js
│   │       ├── 03-services.js
│   │       ├── 04-schedules.js
│   │       ├── 05-clients.js
│   │       ├── 06-promotions.js
│   │       ├── 07-gift-cards.js
│   │       ├── 08-passes.js
│   │       ├── 09-waitlist.js
│   │       └── 10-bookings-historique.js
│   ├── C01-booking-public-mono/       # 27 tests
│   ├── C02-booking-multi-services/    # 16 tests
│   ├── C03-promos-edge/               # 11 tests
│   ├── C04-client-post-booking/       # 16 tests
│   ├── C05-refunds-stripe/            # 10 tests
│   ├── C06-gift-cards/                # 12 tests
│   ├── C07-passes/                    # 9 tests
│   ├── C08-staff-dashboard-ops/       # 33 tests
│   ├── C09-invoices-legal-BE/         # 17 tests
│   ├── C10-waitlist/                  # 10 tests
│   ├── C11-multi-tenant-rbac/         # 7 tests
│   ├── C12-emails-sms-payloads/       # 24 tests
│   ├── C13-quotes-devis/              # 7 tests
│   ├── C14-dashboard-alerts/          # 7 tests
│   ├── C15-calendar-sync/             # 9 tests
│   ├── C16-webhooks/                  # 10 tests
│   ├── C17-minisite-public/           # 5 tests
│   ├── C18-settings-configuration/    # 9 tests
│   ├── C19-signup-onboarding/         # 7 tests
│   └── C20-cron-background/           # 9 tests
├── sanity.js                          # existant, inchangé
└── README.md                          # doc usage
.env.test                              # gitignored
.github/workflows/e2e.yml              # manual trigger (workflow_dispatch)
scripts/
├── test-bootstrap.js                  # alias vers seed.js, pour npm script
├── test-cleanup-force.js              # cleanup manuel interactif
└── test-nuke.js                       # reset nucléaire (confirmation 2x)
```

### Flow d'exécution

```
npm run test:e2e
  │
  ├─ global-setup.js
  │   ├─ Détecte orphans (runs précédents crashed) → cleanup préventif
  │   ├─ Exécute seed (UPSERT idempotent)
  │   └─ Écrit TEST_RUN_START_TS dans process.env
  │
  ├─ playwright runs specs (1 worker, série)
  │   └─ 180 tests sur ~50-60 min
  │
  ├─ global-teardown.js
  │   ├─ DELETE entités créées pendant le run (filtre created_at >= runStart)
  │   ├─ Préserve le seed (seed_tracking table)
  │   └─ Affiche résumé console coloré
  │
  └─ HTML report disponible: npm run test:e2e:report
```

## Catalogue scénarios (180 tests)

### C01 — Booking public mono (27 tests)

Couvre :
- Nouveau/existing client × sans/avec deposit (4)
- Quote-only service (demande devis) (1)
- 7 types promos × éligibilité (P-PCT, P-FIXED, P-SVC, P-FIRST, P-DATE,
  P-FREE, P-INFO) (7)
- Last-minute discount (LM) : slot < deadline (1)
- Combos : promo + LM (1)
- Gift card : partial/full coverage, expirée, cancelled (4)
- Pass : debit session, expiré, épuisé, + promo priorité (4)
- Pass + promo (priorité pass) (1)
- Consent SMS off (1)
- Email disposable rejet (1)
- Phone invalide rejet (1)
- Double-booking concurrent (race condition) (1)
- Slot passé (1)

### C02 — Booking multi-services (16 tests)

Couvre :
- Mono-prac vs split-prac (2)
- Pause inter-services (1)
- GC partial/full sur group (2)
- Pass sur 1 service / 2 services (2)
- Promo specific_service dans group (1)
- Promo free_service dans group (1)
- LM sur subset des services (1)
- Combo LM + promo + GC (1)
- Deposit threshold triggered vs skipped (VIP) (2)
- Auto-split practitioner (service sans prac fixé) (1)
- Conflict sur 1 prac mais pas autre (1)
- Mix pass + deposit sur group (1)

### C03 — Promos edge cases (11 tests)

- max_uses atteint (1)
- Promo désactivée (is_active=false) (1)
- Expirée (end_date passé) (1)
- Pas encore active (start_date futur) (1)
- first_visit sur client existing (rejet) (1)
- first_visit sur client avec bookings cancelled only (OK) (1)
- specific_service sur service non-éligible (1)
- promo_eligible=false sur service (1)
- Stacking attempt (2 promos simultanées) (1)
- LM window j-2 respecté (1)
- LM window h-24 respecté (1)

### C04 — Client post-booking (16 tests)

- Confirm pending booking via link email (1)
- Cancel sans deposit avant deadline (1)
- Cancel avec deposit paid, policy full (refund full) (1)
- Cancel avec deposit paid, policy full, après deadline (retention) (1)
- Cancel policy net, fees < charge (net refund) (1)
- Cancel policy net, fees > charge (retention fees_exceed) (1)
- Cancel avec GC coverage (restore GC) (1)
- Cancel avec pass coverage (restore pass session) (1)
- Cancel modified_pending propagate (1)
- Reschedule simple même prix (1)
- Reschedule avec changement prix (variant) (1)
- Reschedule vers slot full (conflict) (1)
- Reschedule avec min_booking_notice violated (1)
- Reschedule groupe multi-services (1)
- Reject invitation pro-initiated (1)
- Confirm invitation pro-initiated (1)

### C05 — Refunds Stripe (10 tests)

- Staff manuel policy full (1)
- Staff manuel policy net, fees > charge (retention) (1)
- Staff manuel policy net, fees < charge (net refund) (1)
- Staff manuel avec GC coverage absorbed (1)
- Webhook externe Stripe dashboard full refund (1)
- Webhook externe partial refund (pas de cascade) (1)
- POST /api/gift-cards/:id/refund (1)
- POST /api/passes/:id/refund-full (1)
- POST /api/passes/:id/refund (1 session) (1)
- Cron expire pending → auto-refund (1)

### C06 — Gift cards (12 tests)

- Achat public via Stripe + email recipient (1)
- Vente staff (cash/autre) (1)
- Utilisation sur booking (debit complet) (1)
- Utilisation partielle + Stripe deposit pour le reste (1)
- Refund GC status='used' (balance+) (1)
- Cancel avec balance + stripe PI → guard M3 (use_refund_endpoint) (1)
- Cancel sans stripe → OK (1)
- Expire via cron (1)
- Warning J-7 expiry → email sent (1)
- Reactivate (cancelled → active) (1)
- Code invalid (typo) rejet (1)
- Cross-tenant (code d'un autre business) rejet (1)

### C07 — Passes/Abonnements (9 tests)

- Achat public via Stripe (1)
- Achat staff (1)
- Debit session sur booking (1)
- Refund-full avec Stripe (1)
- Refund-full fees > remaining (retention) (1)
- Cancel avec sessions > 0 + stripe → guard use_refund_full (1)
- Expire via cron (1)
- Warning J-7 expiry → email sent (1)
- Service mismatch rejet (1)

### C08 — Staff dashboard & ops (33 tests)

- Login owner + token (1)
- Login practitioner → scope reduced (1)
- Login invalid → 401 (1)
- JWT expired → refresh flow (1)
- Stats quotidiennes (5 KPIs) (1)
- Agenda day/week/multi-prac (3)
- Create booking pro (owner, client existing, nouveau client) (3)
- Modifier start_at / service / praticien (3)
- Ungroup booking group (1)
- Cancel booking pro avec raison (1)
- Cancel booking pro cascade sibling (1)
- Mark no-show (1)
- Mark completed (1)
- CRUD service (create, edit, delete avec pass actif 409, delete OK) (4)
- Create service avec variants (1)
- CRUD praticien (create, edit, delete, photo) (4)
- CRUD promotion (create, activate, edit) (3)
- CRUD horaires business / horaires prac (2)
- Create absence → impact availability (1)
- CSV import avec doublons E164 (1)
- CSV avec ligne invalide → errors[] retourné (1)
- Recherche client (autocomplete) (1)
- Détail client + historique bookings (1)

### C09 — Invoices & légal BE (17 tests)

- Create invoice draft from booking (1)
- Edit invoice items draft (1)
- Transitions status valides (draft→sent, sent→paid, sent→overdue, paid→refunded) (4)
- Transitions bloquées (paid→cancelled, cancelled→draft) (2)
- Create credit note from paid (1)
- Create credit note from sent (1)
- Create credit note from draft (rejet) (1)
- Create credit note from quote (rejet) (1)
- Double credit note same invoice (409) (1)
- Credit note PDF contient "Annule la facture F-XXX du DD/MM/YYYY" (1)
- Mark original cancelled after CN (1)
- Invoice multi-TVA (6%+21%) (1)
- Invoice export CSV (1)
- Invoice structured_comm unique (1)
- Invoice PDF impersonation audit log (1)

### C10 — Waitlist (10 tests)

- Inscription sans booking avant (1)
- Inscription avec filtres preferred_days + preferred_time (1)
- preferred_days=[] match n'importe quel jour (1)
- Annuler booking → offre auto à waitlist #1 (1)
- Accepter offre → booking créé (1)
- Refuser offre → offre au #2 (1)
- Offre expire après 2h → offre au #2 (1)
- Slot too soon (< 2h) skip offre (1)
- Staff invite manuellement (1)
- Staff delete entry (1)

### C11 — Multi-tenant & RBAC (7 tests)

- Prac login : dashboard ne montre QUE ses RDV (1)
- Prac ne peut pas PATCH booking autre prac (1)
- Cross-tenant : JWT business A tente accès business B → 403 (1)
- Impersonation admin → audit log écrit (1)
- blockIfImpersonated sur destructive routes (1)
- Owner permissions vs staff limité (1)
- JWT cross-business (b_id dans token vs b_id dans URL) → 403 (1)

### C12 — Emails & SMS (24 tests)

Via mocks (SKIP_EMAIL=1, SKIP_SMS=1), assertion sur `test_mock_log` :

- Email confirmation booking public sans deposit (1)
- Email confirmation booking public avec deposit paid (1)
- Email deposit paid pro (1)
- Email cancel client + cancel pro (avec raison) (2)
- Email reschedule (1)
- Email reminder 24h / 2h (cron simulé) (2)
- Email post-RDV (review request) (1)
- Email new booking pro (1)
- Email dispute alert pro (1)
- Email gift card purchase (1)
- Email pass purchase (1)
- Email expiry warning J-7 GC / pass (2)
- Email waitlist offer (1)
- Email invoice sent avec PDF attaché (1)
- Email refund confirmation Stripe succeeded (1)
- Email retention (3 variants: fees_exceed, no_stripe_key, stripe_failure) (3)
- SMS confirmation booking (1)
- SMS reminder 24h (1)
- SMS STOP → consent_sms=false (1)
- SMS respectant consent_sms=false → skip (1)
- SMS plan gate (free skip) (1)

### C13 — Quotes/Devis (7 tests)

- Client request quote (quote_only service) (1)
- Staff voit quote requests liste (1)
- Staff répond au quote (1)
- Client accepte quote → booking créé (1)
- Client refuse quote (1)
- Quote expire → status changed (1)
- Quote PDF génération (1)

### C14 — Dashboard alerts (7 tests)

- Alert pending_confirmations (1)
- Alert unpaid_deposits (1)
- Alert recent_no_shows (1)
- Alert upcoming_absences (1)
- Alert invoice_overdue (1)
- Alert GC/Pass expiring J-7 (1)
- Alert scope by practitioner (RBAC) (1)

### C15 — Calendar sync (9 tests)

- OAuth Google init + callback (1)
- OAuth Outlook init + callback (1)
- iCal export valide (1)
- Sync new booking → external event (1)
- Sync update booking → external event updated (1)
- Sync cancel booking → external event deleted (1)
- Token encryption roundtrip (1)
- Token refresh flow (expired → refreshed) (1)
- Disconnect account (clear tokens) (1)

### C16 — Webhooks (10 tests)

- Stripe checkout.session.completed (GC) (1)
- Stripe checkout.session.completed (Pass) (1)
- Stripe payment_intent.succeeded (deposit) (1)
- Stripe charge.refunded full (1)
- Stripe charge.refunded partial (pas de cascade) (1)
- Stripe signature invalid → 400 (1)
- Stripe replay protection (idempotence) (1)
- Twilio STOP inbound → consent_sms=false (1)
- Twilio START inbound → consent_sms=true (1)
- Brevo bounce webhook (si configuré) (1)

### C17 — Minisite public (5 tests)

- Load minisite + cache hit (1)
- Disponibilités affichées correctement (1)
- Services filtrés par catégorie (1)
- Promo banner si promo active (1)
- SEO meta tags présents (title, description, og:*) (1)

### C18 — Settings & configuration (9 tests)

- Sauvegarder cancel policy (R6 fix) (1)
- Sauvegarder deposit settings (1)
- Sauvegarder cancel_abuse (1)
- Sauvegarder refund_policy (full/net) (1)
- Sauvegarder horaires business (1)
- Toggle SMS enabled (1)
- Toggle email reminders (1)
- Upload business logo (1)
- Theme colors (1)

### C19 — Signup & onboarding (7 tests)

- Signup new business (1)
- Signup email already exists → 409 (1)
- Signup disposable email rejet (1)
- Signup BCE invalide rejet (1)
- Stripe Connect onboarding init (1)
- Stripe Connect webhook account.updated (1)
- First login → onboarding UI (1)

### C20 — Cron jobs & background (9 tests)

- Cron expire pending bookings (1)
- Cron expire GC (1)
- Cron expire passes (1)
- Cron J-7 warning GC (1)
- Cron J-7 warning pass (1)
- Cron notification processor (1)
- Cron reminder 24h (1)
- Cron reminder 2h (1)
- Cron deposit expiry (1)

## Bootstrap (seed)

### Table `seed_tracking` (nouvelle)

```sql
CREATE TABLE seed_tracking (
  entity_type TEXT NOT NULL,
  entity_id UUID NOT NULL,
  seeded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (entity_type, entity_id)
);
```

Le seed y enregistre chaque entité qu'il crée/maintient. Le cleanup utilise
cette table pour distinguer "créé par seed" (à garder) vs "créé par test"
(à supprimer).

### Table `test_mock_log` (nouvelle)

```sql
CREATE TABLE test_mock_log (
  id SERIAL PRIMARY KEY,
  type TEXT NOT NULL,        -- 'email' | 'sms' | 'stripe_webhook_sent'
  kind TEXT,                  -- 'booking_confirmation' | 'cancel_client' | ...
  recipient TEXT,             -- email/phone destinataire
  payload JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_test_mock_log_lookup ON test_mock_log (type, created_at DESC);
```

Écrite uniquement si `SKIP_EMAIL=1` ou `SKIP_SMS=1`. Cleanup en teardown.

### Colonne `is_test_account` sur businesses

```sql
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS is_test_account BOOLEAN NOT NULL DEFAULT false;
CREATE INDEX idx_businesses_test ON businesses(is_test_account) WHERE is_test_account = true;
```

### Entités seedées

**1. Business TEST**
- `name: "TEST — Demo Salon Genda"`, `slug: "test-demo-salon"`
- `is_test_account: true`
- BCE: BE0999999999, IBAN: BE68 5390 0754 7034
- `stripe_account_id: acct_test_xxx` (Stripe Connect test mode)
- Settings complets (deposit, cancel, refund_policy, reminders, LM, etc.)

**2. Praticiens (3)**
| Nom | Rôle | Skills | Horaires |
|---|---|---|---|
| Alice Owner | owner | tous services | Mar-Sam 9h-18h |
| Bob Stylist | practitioner | services A, B | Lun-Ven 10h-19h |
| Carol Junior | practitioner | service A seul | Mer-Sam 14h-20h |

**3. Services (7)**
- S-SHORT (30min, 25€, promo_eligible)
- S-LONG (120min, 80€, promo_eligible)
- S-CHEAP (15min, 12€, promo_eligible=false)
- S-EXPENSIVE (180min, 150€, deposit required)
- S-VARIANTS (45/60/90min, 40/55/75€, 3 variants)
- S-QUOTE (quote_only)
- S-PASS (60min, 50€, ciblé pass)

**4. Clients (3)**
- Jean Testeur (0 bookings, email: jean-test@genda-test.be)
- Marie Regular (3 bookings complétés)
- Paul VIP (10 bookings, is_vip=true)

**5. Promotions (7)**
- P-PCT (20%, none)
- P-FIXED (10€, min_amount 50€)
- P-SVC (30%, specific_service S-LONG)
- P-FIRST (15%, first_visit)
- P-DATE (10%, date_range J à J+30)
- P-FREE (free S-CHEAP si S-LONG)
- P-INFO (info_only)

**6. Gift cards (4)**
- GC-ACTIVE (100€, expires J+365)
- GC-PARTIAL (50€/100€, 1 usage)
- GC-EXPIRED (100€, expires J-30)
- GC-CANCELLED (50€, sans stripe_PI)

**7. Passes (3)**
- PASS-ACTIVE (5/10 sessions, expires J+90)
- PASS-EXPIRED (5 sessions, expires J-10, status=active)
- PASS-EMPTY (0 sessions, status=used)

**8. Waitlist entries (2)**
- WL-JEAN (preferred_days=[1..5], afternoon)
- WL-MARIE (preferred_days=[] — edge NULL/empty)

**9. Bookings historiques (5)**
- BK-COMPLETED-1..3 (J-30 à J-7, facture payée)
- BK-NOSHOW-1 (J-3)
- BK-CANCELLED-1 (J-1, deposit refunded)

### UUIDs déterministes (`fixtures/ids.js`)

```js
export const TEST_IDS = {
  BUSINESS: '00000000-0000-4000-8000-000000000001',
  PRAC_ALICE: '00000000-0000-4000-8000-000000000010',
  PRAC_BOB: '00000000-0000-4000-8000-000000000011',
  SVC_SHORT: '00000000-0000-4000-8000-000000000100',
  SVC_LONG: '00000000-0000-4000-8000-000000000101',
  // etc — un UUID fixe par entité seedée
};
```

Les tests référencent les entités par ces IDs, sans query DB.

## Mocks externes

### Brevo/Twilio — patch minimal dans les services

```js
// src/services/email.js (début de chaque sendXxxEmail)
if (process.env.SKIP_EMAIL === '1') {
  await query(
    `INSERT INTO test_mock_log (type, kind, recipient, payload) 
     VALUES ('email', $1, $2, $3)`,
    [opts.template, opts.to, JSON.stringify(opts)]
  );
  return { mocked: true, messageId: 'mock-' + Date.now() };
}
// [code Brevo existant inchangé]
```

Même pattern pour `src/services/sms.js`. Un helper `logMock()` centralise.

Tests C12 vérifient :
```js
const emails = await db.query(
  `SELECT * FROM test_mock_log WHERE type='email' AND recipient=$1 
   AND created_at > $2 ORDER BY created_at DESC LIMIT 1`,
  ['jean-test@genda-test.be', testStartTs]
);
expect(emails.rows[0].kind).toBe('booking_confirmation');
expect(emails.rows[0].payload.serviceName).toBe('Coupe rapide');
```

### Stripe — business-scoped test key

Patch dans `src/services/stripe.js` :

```js
function getStripeClient(business) {
  const isTestBusiness = business?.is_test_account === true;
  const key = isTestBusiness 
    ? process.env.STRIPE_SECRET_KEY_TEST 
    : process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error('STRIPE_SECRET_KEY missing');
  return require('stripe')(key);
}
```

L'instance prod a `STRIPE_SECRET_KEY=sk_live_XXX` pour tous les business non-test
et `STRIPE_SECRET_KEY_TEST=sk_test_XXX` pour le business TEST. Business TEST
utilise `acct_test_XXX` (Stripe Connect test mode).

### Tests webhooks

```js
const event = {
  id: 'evt_test_' + Date.now(),
  type: 'charge.refunded',
  data: { object: { id: 'ch_test_xxx', payment_intent: 'pi_test_xxx' } }
};
const payload = JSON.stringify(event);
const sig = stripe.webhooks.generateTestHeaderString({
  payload, secret: process.env.STRIPE_WEBHOOK_SECRET
});
await request.post('/api/stripe/webhook', {
  data: payload,
  headers: { 'stripe-signature': sig, 'content-type': 'application/json' }
});
```

## CI

### Workflow `.github/workflows/e2e.yml`

Trigger manuel via `workflow_dispatch` (bouton "Run workflow" dans GitHub UI).

Input `category` optionnel (dropdown avec les 20 catégories + option vide
pour tout lancer).

Steps :
1. Checkout + Node 20 + cache npm
2. `npm ci`
3. `npx playwright install --with-deps chromium`
4. Écrit `.env.test` depuis les GitHub Secrets
5. `npm run test:e2e:bootstrap`
6. `npm run test:e2e` (ou catégorie spécifique)
7. Upload HTML report en artifact (30 jours rétention)
8. Upload traces en artifact si fail (14 jours)

### Secrets GitHub requis

- `TEST_DATABASE_URL`
- `STRIPE_TEST_SECRET_KEY`
- `STRIPE_TEST_WEBHOOK_SECRET`
- `STRIPE_CONNECT_TEST_ACCOUNT`
- `JWT_SECRET` (même valeur que Render prod)

## Cleanup & isolation

### global-teardown.js

Après chaque run, DELETE ordonné (FK-safe) des entités créées pendant le run :

```js
const runStart = process.env.TEST_RUN_START_TS;
const bid = process.env.TEST_BUSINESS_ID;

// Garde-fous
if (!bid || bid.length !== 36) throw new Error('TEST_BUSINESS_ID invalid');
const check = await pool.query(`SELECT is_test_account FROM businesses WHERE id = $1`, [bid]);
if (!check.rows[0]?.is_test_account) throw new Error(`ABORT: business not test`);

// DELETE enfants → parents
await pool.query(`BEGIN`);
await pool.query(`DELETE FROM gift_card_transactions WHERE business_id = $1 AND created_at >= $2`, [bid, runStart]);
await pool.query(`DELETE FROM pass_transactions WHERE business_id = $1 AND created_at >= $2`, [bid, runStart]);
await pool.query(`DELETE FROM invoice_items WHERE invoice_id IN (SELECT id FROM invoices WHERE business_id = $1 AND created_at >= $2)`, [bid, runStart]);
await pool.query(`DELETE FROM invoices WHERE business_id = $1 AND created_at >= $2`, [bid, runStart]);
await pool.query(`DELETE FROM notifications WHERE business_id = $1 AND created_at >= $2`, [bid, runStart]);
await pool.query(`DELETE FROM bookings WHERE business_id = $1 AND created_at >= $2`, [bid, runStart]);
await pool.query(`DELETE FROM waitlist_entries WHERE business_id = $1 AND created_at >= $2`, [bid, runStart]);
await pool.query(`DELETE FROM gift_cards WHERE business_id = $1 AND created_at >= $2`, [bid, runStart]);
await pool.query(`DELETE FROM passes WHERE business_id = $1 AND created_at >= $2`, [bid, runStart]);
await pool.query(`DELETE FROM clients WHERE business_id = $1 AND created_at >= $2 AND email LIKE '%-test@genda-test.be'`, [bid, runStart]);
await pool.query(`DELETE FROM audit_logs WHERE business_id = $1 AND created_at >= $2`, [bid, runStart]);
await pool.query(`DELETE FROM test_mock_log WHERE created_at >= $1`, [runStart]);
await pool.query(`COMMIT`);
```

Ce qui est préservé :
- Business TEST + ses 3 praticiens + 7 services + horaires + settings
- Les 3 clients permanents (Jean, Marie, Paul)
- Les 7 promotions
- Les 4 GC + 3 passes + 2 waitlist + 5 bookings historiques

### Scripts de cleanup manuel

- `scripts/test-cleanup-force.js` : demande confirmation `[yes/no]`, vérifie
  `is_test_account=true`, reset tout sauf seed.
- `scripts/test-nuke.js` : supprime le business TEST entièrement + rebuild
  complet. Nécessite saisie `NUKE` confirmée 2×.

### Gestion runs crashed

global-setup détecte les orphans (entités TEST créées après le dernier
seed_tracking.seeded_at mais non présentes dans seed_tracking) et les
cleanup préventivement avec un warn.

## Reporting

### HTML report natif Playwright

Généré dans `tests/e2e/playwright-report/`. Contient :
- Dashboard interactif (filtres, sorting)
- Détail par test (logs, screenshots, videos sur fail, timeline steps)
- Traces ZIP visualisables via `playwright show-trace`

### Résumé console (global-teardown.js)

Affiche après le run :
- Stats globales (X/Y passed, %)
- Breakdown par catégorie
- Liste des échecs avec message d'erreur
- Temps total
- Commandes utiles (report, traces, re-run)

## Scripts `package.json`

```json
{
  "test:e2e": "playwright test --config=tests/e2e/playwright.config.js",
  "test:e2e:ui": "playwright test --ui --config=tests/e2e/playwright.config.js",
  "test:e2e:debug": "PWDEBUG=1 playwright test --config=tests/e2e/playwright.config.js",
  "test:e2e:bootstrap": "node tests/e2e/fixtures/seed.js",
  "test:e2e:cleanup": "node scripts/test-cleanup-force.js",
  "test:e2e:nuke": "node scripts/test-nuke.js",
  "test:e2e:report": "playwright show-report tests/e2e/playwright-report",
  "test:e2e:last-failed": "playwright test --last-failed --config=tests/e2e/playwright.config.js"
}
```

## Modifications requises dans `src/`

1. `src/services/stripe.js` — ajouter `getStripeClient(business)` helper
   utilisant clé test si `business.is_test_account=true`.
2. `src/services/email.js` + tous les `email-*.js` — ajouter le check
   `SKIP_EMAIL=1` → INSERT `test_mock_log` au début de chaque sendXxxEmail.
3. `src/services/sms.js` — idem avec `SKIP_SMS=1`.
4. Migrations schema :
   - `schema-v73-is-test-account.sql` : ajout col `is_test_account` +
     index + tables `seed_tracking` + `test_mock_log`.

## Estimation temps de run

- Install deps + Playwright browsers : ~90s (GHA)
- Bootstrap seed : ~5s
- 180 tests en série : ~50-60 min
- Teardown : ~5s
- **Total : ~55-65 min par run complet**

GHA free tier (2000 min/mois) → ~30-35 runs complets gratuits/mois.

## Out of scope (pour une itération future)

- Tests de charge / performance (k6, Artillery)
- Tests visuel regression (screenshots diff)
- Tests mobile (Playwright supporte mobile emulation mais non prioritaire)
- Parallélisation avec isolation slots (à faire si 60 min devient bloquant)
- Staging Render dédié (à faire après validation de cette suite)
- Monitoring synthétique prod (Pingdom/UptimeRobot)
- Tests cross-browser (seul chromium initialement)

## Risques

| Risque | Mitigation |
|---|---|
| Cleanup rate, data orpheline pollue DB prod | `is_test_account` check + `created_at >= runStart` filtre + scripts manuels |
| Stripe test account pas configuré | Doc setup explicite dans README, step-by-step Stripe dashboard |
| GHA free tier épuisé | Manual trigger = 35 runs/mois suffisent, sinon Render-hosted runner |
| Business TEST corrompu | Script `test-nuke.js` reset complet en 30 sec |
| Tests flaky (network timing) | Playwright retry=0 initialement, corriger à la source. Peut passer retry=1 ciblé |

## Questions ouvertes

Aucune. Toutes les décisions sont prises. Prêt pour writing-plans.
