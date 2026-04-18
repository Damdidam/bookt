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

Durée : ~50-60 min (180 tests en série, toutes phases).

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

Secrets requis dans GHA (Settings → Secrets and variables → Actions) :
- `TEST_DATABASE_URL` : même connection string que prod
- `STRIPE_TEST_SECRET_KEY` : `sk_test_XXX`
- `STRIPE_TEST_PUBLISHABLE_KEY` : `pk_test_XXX`
- `STRIPE_TEST_WEBHOOK_SECRET` : `whsec_test_XXX`
- `STRIPE_CONNECT_TEST_ACCOUNT` : `acct_test_XXX`
- `JWT_SECRET` : copier depuis Render env var

## Architecture

- **Business TEST** (`is_test_account=true`) persistant en prod, cleanup filtré
- **Mocks Brevo/Twilio** via flags `SKIP_EMAIL=1` / `SKIP_SMS=1` → écrit dans table `test_mock_log`
- **Stripe** : clé test via `STRIPE_SECRET_KEY` (env complet en mode test)
- **Seed idempotent** : `tests/e2e/fixtures/seeds/` modulaire, UUIDs déterministes dans `ids.js`
- **Cleanup** : filtre `created_at >= runStart` + exclusion `seed_tracking`

## Catégories (5 phases, 20 catégories, 180 tests)

| Phase | Catégories | Description |
|---|---|---|
| Phase 1 | Infrastructure | seed, mocks, config (ce qu'il y a pour l'instant) |
| Phase 2 | C01-C05 | Booking public + refunds Stripe |
| Phase 3 | C06-C10 | GC + Passes + Invoices + Staff + Waitlist |
| Phase 4 | C11-C15 | RBAC + Emails + Quotes + Alerts + Calendar |
| Phase 5 | C16-C20 | Webhooks + Minisite + Settings + Signup + Cron |

## Troubleshooting

**Q : Un test plante, data orpheline en DB.**
A : `npm run test:e2e:cleanup` → supprime tout sauf le seed.

**Q : Le seed est corrompu.**
A : `npm run test:e2e:nuke` puis `npm run test:e2e:bootstrap`.

**Q : Les tests échouent tous avec "business not found".**
A : Bootstrap pas fait. `npm run test:e2e:bootstrap`.

**Q : "STRIPE_SECRET_KEY missing"**
A : Vérifier `.env.test` existe et contient `STRIPE_SECRET_KEY=sk_test_XXX`.

**Q : SSL/TLS required**
A : `.env.test` doit contenir `NODE_ENV=production` (active SSL dans le pg pool pour connexion Render).

**Q : Staff login 401**
A : `JWT_SECRET` dans `.env.test` doit matcher EXACTEMENT celui de Render prod, sinon les JWTs signés en test sont refusés.
