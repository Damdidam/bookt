# Tests E2E Genda — Phase 2 (C01-C05 Booking + Finance) Implementation Plan

**Goal:** Écrire les ~80 tests E2E des catégories C01-C05 (booking public mono, multi-services, promos, post-booking client, refunds Stripe).

**Architecture:** Chaque catégorie = un dossier sous `tests/e2e/C0X-*/`, contient plusieurs fichiers `.spec.js` thématiques. Tests utilisent les helpers `api-client.js` + `stripe-test.js` + les fixtures `ids.js`. Chaque test = une assertion end-to-end avec proof d'état en DB et dans `test_mock_log`.

**Tech Stack:** Playwright Test natif (déjà installé). Fixtures Phase 1 (seed TEST business + helpers).

**Prérequis :** Phase 1 complétée (validée côté Hakim). `.env.test` correctement configuré avec JWT_SECRET de prod Render, STRIPE_SECRET_KEY_TEST, etc.

---

## Principe général par catégorie

Pour chaque catégorie (C01-C05), un subagent reçoit :
- Le catalogue complet des tests à écrire (nom + comportement attendu)
- Les helpers disponibles (api-client, stripe-test, ids)
- Le pattern d'un test existant (si déjà fait) ou un template
- Les assertions requises (DB state, mock_log, response HTTP)

Chaque subagent :
1. Lit les fichiers de référence (seed, helpers, routes correspondantes)
2. Crée un dossier `tests/e2e/C0X-*/` avec plusieurs `.spec.js`
3. Run les tests via `npm run test:e2e:category -- C0X-*`
4. Commit chaque spec file individuellement (pour granularité review)

---

## Task 1 : C01 — Booking public mono (27 tests)

**Dossier :** `tests/e2e/C01-booking-public-mono/`

**Fichiers spec à créer (~8 specs) :**

| Fichier | Tests | Description |
|---|---|---|
| `01-deposit-variations.spec.js` | 4 | Sans/avec deposit × nouveau/existing client |
| `02-quote-request.spec.js` | 1 | Client request quote (quote_only service) |
| `03-promos-all-types.spec.js` | 7 | Chaque type promo (PCT, FIXED, SVC, FIRST, DATE, FREE, INFO) |
| `04-last-minute.spec.js` | 2 | LM alone + LM combo promo |
| `05-gift-cards.spec.js` | 4 | GC partial/full/expired/cancelled |
| `06-passes.spec.js` | 4 | Pass debit/expiré/épuisé/pass+promo priorité |
| `07-consent-validation.spec.js` | 3 | SMS consent=false, email disposable, phone invalid |
| `08-edge-cases.spec.js` | 2 | Double-booking concurrent + slot passé |

**Endpoints testés :** `POST /api/public/bookings`, `GET /api/public/:slug/slots`

**Assertions types :**
- HTTP response status + body shape
- DB state : `SELECT * FROM bookings WHERE id = <created>`, vérifier status, deposit_required, promotion_*
- mock_log : `SELECT * FROM test_mock_log WHERE type='email'` pour confirmer email envoyé
- GC/pass state : balance décrementé après booking

## Task 2 : C02 — Booking multi-services (16 tests)

**Dossier :** `tests/e2e/C02-booking-multi-services/`

**Fichiers spec (~6 specs) :**

| Fichier | Tests | Description |
|---|---|---|
| `01-mono-vs-split-prac.spec.js` | 2 | Group mono-prac + split-prac |
| `02-pause-inter-services.spec.js` | 1 | Pause configurée entre services |
| `03-gift-cards-group.spec.js` | 2 | GC partial/full sur group |
| `04-passes-group.spec.js` | 2 | Pass sur 1/2 services dans group |
| `05-promos-group.spec.js` | 3 | specific_service, free_service, LM subset |
| `06-combos-threshold.spec.js` | 6 | Combos LM+promo+GC, deposit threshold on/off, auto-split, conflict, mix pass+deposit |

## Task 3 : C03 — Promos edge cases (11 tests)

**Dossier :** `tests/e2e/C03-promos-edge/`

**Fichiers spec (~3 specs) :**

| Fichier | Tests | Description |
|---|---|---|
| `01-activity-expiry.spec.js` | 4 | max_uses, desactivée, end_date, start_date futur |
| `02-conditions-validation.spec.js` | 4 | first_visit rejet/OK, specific_service non-eligible, promo_eligible=false |
| `03-stacking-lm.spec.js` | 3 | Stacking attempt + LM j-2/h-24 |

## Task 4 : C04 — Client post-booking (16 tests)

**Dossier :** `tests/e2e/C04-client-post-booking/`

**Fichiers spec (~5 specs) :**

| Fichier | Tests | Description |
|---|---|---|
| `01-confirm.spec.js` | 1 | Confirm pending via link email |
| `02-cancel-policies.spec.js` | 6 | Cancel avant/après deadline × 3 policies (full, net fees<, net fees>) |
| `03-cancel-gc-pass.spec.js` | 3 | Cancel GC coverage, pass coverage, modified_pending propagate |
| `04-reschedule.spec.js` | 5 | Simple, prix change, slot full, min-notice, groupe |
| `05-invitation.spec.js` | 2 | Confirm + reject invitation pro-initiated |

**Endpoints testés :** `POST /api/public/booking/:token/cancel`, `/confirm`, `/reschedule`, `/reject`

## Task 5 : C05 — Refunds Stripe (10 tests)

**Dossier :** `tests/e2e/C05-refunds-stripe/`

**Fichiers spec (~4 specs) :**

| Fichier | Tests | Description |
|---|---|---|
| `01-manual-refund-policies.spec.js` | 4 | Staff manuel : full, net fees>, net fees<, GC absorbed |
| `02-webhook-external.spec.js` | 2 | Stripe dashboard refund full + partial |
| `03-gc-pass-refund.spec.js` | 3 | GC refund, pass refund-full, pass 1-session |
| `04-cron-auto-refund.spec.js` | 1 | Cron expire pending → auto refund |

**Endpoints testés :** `PATCH /api/bookings/:id/cancel`, `/deposit-refund`, `POST /api/gift-cards/:id/refund`, `/passes/:id/refund-full`, webhook `/api/stripe/webhook`

---

## Test template (pattern à suivre pour tous les specs)

```js
const { test, expect } = require('@playwright/test');
const IDS = require('../fixtures/ids');
const { staffFetch, publicFetch, getMockLogs } = require('../fixtures/api-client');
const { buildSignedWebhook } = require('../fixtures/stripe-test');
const { pool } = require('../../../src/services/db');

test.describe('C01 — Booking public mono', () => {

  test('sans deposit, nouveau client, happy path', async () => {
    const sinceTs = new Date().toISOString();
    const startAt = new Date(Date.now() + 7 * 86400000);  // J+7
    startAt.setHours(10, 0, 0, 0);

    // Action : POST /api/public/bookings
    const { status, body } = await publicFetch('/api/public/bookings', {
      method: 'POST',
      body: {
        business_slug: 'test-demo-salon',
        service_id: IDS.SVC_SHORT,
        practitioner_id: IDS.PRAC_ALICE,
        start_at: startAt.toISOString(),
        client: {
          full_name: 'New Client E2E',
          email: `e2e-${Date.now()}@genda-test.be`,
          phone: '+32491777777',
          consent_sms: true,
          consent_email: true,
        }
      }
    });

    expect(status).toBe(201);
    expect(body.booking?.id).toBeTruthy();
    expect(body.booking.status).toBe('confirmed');

    // DB proof
    const r = await pool.query(`SELECT status, deposit_required FROM bookings WHERE id = $1`, [body.booking.id]);
    expect(r.rows[0].status).toBe('confirmed');
    expect(r.rows[0].deposit_required).toBe(false);

    // Email proof
    const emails = await getMockLogs('email', sinceTs);
    expect(emails.some(e => e.kind === 'email_confirmation' || e.payload?.subject?.match(/confirm/i))).toBeTruthy();
  });

  // ... other tests ...
});
```

---

## Ordre d'exécution

```
T1 (C01) → T2 (C02) → T3 (C03) → T4 (C04) → T5 (C05)
```

Séquentiel car chaque catégorie s'appuie sur les patterns de la précédente.

---

## Check-in après chaque task

Après chaque catégorie :
1. Vérifier les commits (1 par spec file, grouped commits OK)
2. Run `npm run test:e2e -- tests/e2e/C0X-*` pour valider tout passe
3. Review manuelle rapide (grep, lecture d'un spec random)
4. Passage à la task suivante seulement si tout vert

---

## Estimation

- T1 (C01, 27 tests, 8 specs) : 2-3 dispatches subagent
- T2 (C02, 16 tests, 6 specs) : 1-2 dispatches
- T3 (C03, 11 tests, 3 specs) : 1 dispatch
- T4 (C04, 16 tests, 5 specs) : 1-2 dispatches
- T5 (C05, 10 tests, 4 specs) : 1 dispatch

Total : ~7-10 subagent dispatches pour Phase 2.
