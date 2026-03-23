# Passes / Packs de séances — Design Spec

## Concept

Un pass = un pack de X séances pour un service précis, vendu à prix fixe par le commerçant. Le client achète le pass sur le minisite (sans réservation immédiate), reçoit un code, et l'utilise à chaque réservation du service couvert. Le pass remplace l'acompte (engagement client). No-show = séance perdue, annulation = séance re-créditée.

## Décisions prises

- **Scope MVP** : 1 pass = 1 service précis (pas de catégorie ou multi-services)
- **Pricing** : prix fixe défini par le commerçant (pas de calcul automatique)
- **Décompte** : à la réservation (comme un acompte). Annulation → re-crédit. No-show → perdu.
- **Achat** : page dédiée sur le minisite (pattern cartes cadeaux)
- **Utilisation** : auto-détection par email client + saisie manuelle du code en fallback
- **Gestion templates** : dans la fiche service (toggle + liste de formules), pas dans une section séparée
- **Plusieurs formules par service** : ex: pack 5, pack 10, pack 20 avec remises croissantes

## Data Model

### Table `pass_templates` — Les modèles créés par le commerçant

```sql
CREATE TABLE IF NOT EXISTS pass_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  service_id UUID NOT NULL REFERENCES services(id),
  name VARCHAR(200) NOT NULL,
  sessions_count INTEGER NOT NULL CHECK (sessions_count > 0),
  price_cents INTEGER NOT NULL CHECK (price_cents > 0),
  validity_days INTEGER DEFAULT 365,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pt_business ON pass_templates(business_id);
CREATE INDEX IF NOT EXISTS idx_pt_service ON pass_templates(business_id, service_id);
```

### Table `passes` — Les passes achetés par les clients

```sql
CREATE TABLE IF NOT EXISTS passes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  pass_template_id UUID REFERENCES pass_templates(id),
  service_id UUID NOT NULL REFERENCES services(id),
  code VARCHAR(12) UNIQUE NOT NULL,
  name VARCHAR(200) NOT NULL,
  sessions_total INTEGER NOT NULL,
  sessions_remaining INTEGER NOT NULL,
  price_cents INTEGER NOT NULL,
  buyer_name VARCHAR(200),
  buyer_email VARCHAR(200),
  status VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active','used','expired','cancelled')),
  stripe_payment_intent_id VARCHAR(100),
  expires_at TIMESTAMPTZ,
  created_by UUID,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pass_business ON passes(business_id);
CREATE INDEX IF NOT EXISTS idx_pass_code ON passes(code);
CREATE INDEX IF NOT EXISTS idx_pass_status ON passes(business_id, status);
CREATE INDEX IF NOT EXISTS idx_pass_email ON passes(buyer_email, business_id);
CREATE INDEX IF NOT EXISTS idx_pass_service ON passes(service_id, business_id);
```

### Table `pass_transactions` — Journal des opérations

```sql
CREATE TABLE IF NOT EXISTS pass_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pass_id UUID NOT NULL REFERENCES passes(id),
  business_id UUID NOT NULL,
  booking_id UUID REFERENCES bookings(id),
  sessions INTEGER NOT NULL DEFAULT 1,
  type VARCHAR(20) CHECK (type IN ('purchase','debit','refund')),
  note TEXT,
  created_by UUID,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ptx_pass ON pass_transactions(pass_id);
CREATE INDEX IF NOT EXISTS idx_ptx_booking ON pass_transactions(booking_id);
```

## Business Settings (JSONB)

Ajoutés dans `businesses.settings` :
- `passes_enabled` (boolean, default false)
- `pass_validity_days` (integer, default 365, range 30-730)

## Code Format

`PS-XXXX-XXXX` — même pattern que les cartes cadeaux (`GC-XXXX-XXXX`), alphabet sans ambiguïté (pas de I/O/0/1).

## API Endpoints

### Staff Routes — `/api/passes`

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/passes` | Liste passes + stats (filter status, search) |
| GET | `/api/passes/templates` | Liste templates du business |
| POST | `/api/passes/templates` | Créer un template (service_id, name, sessions_count, price_cents, validity_days) |
| PATCH | `/api/passes/templates/:id` | Modifier un template (name, price, active toggle) |
| DELETE | `/api/passes/templates/:id` | Supprimer un template (soft: is_active=false) |
| POST | `/api/passes` | Créer un pass manuellement (pour un client en salon) |
| PATCH | `/api/passes/:id` | Changer statut (cancel) |
| POST | `/api/passes/:id/debit` | Débiter 1 séance manuellement |
| POST | `/api/passes/:id/refund` | Re-créditer 1 séance |

### Public Routes — `/api/public`

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/public/:slug/pass-config` | Config des passes pour le minisite (templates actifs) |
| POST | `/api/public/:slug/pass/checkout` | Créer session Stripe Checkout pour achat pass |
| POST | `/api/public/pass/validate` | Valider un code pass (retourne séances restantes, service) |
| POST | `/api/public/deposit/:token/check-passes` | Auto-détection passes par email client |

### Stripe Webhook

Dans `checkout.session.completed` avec `metadata.type = 'pass'` :
- Créer le pass en DB avec code généré
- Créer transaction `purchase`
- Envoyer email au client (code + détails du pass)
- Broadcast SSE

## Flows détaillés

### 1. Commerçant crée un template

Dashboard → Prestations → ouvre un service → section "Abonnements" (toggle)
- Active le toggle → section dépliée
- Liste les formules existantes (si aucune, vide)
- Bouton "+ Ajouter une formule"
- Par formule : nom (auto-suggestion: "Pack {X} {service}"), nombre de séances, prix total, validité
- Plusieurs formules possibles par service (ex: Pack 5, Pack 10, Pack 20)
- Toggle actif/inactif par formule
→ CRUD via `/api/passes/templates` (lié au service_id)

### 2. Client achète un pass

Minisite `/{slug}/pass` → voit les templates actifs → choisit → remplit nom/email → Stripe Checkout → webhook crée le pass → email avec code `PS-ABCD-EFGH`.

Page HTML : `public/pass.html` — calquée sur `gift-card.html` mais affiche une liste de templates (cards) au lieu d'un montant libre.

### 3. Client utilise son pass au booking

Booking flow → étape confirmation/acompte → le système check si le client a un pass actif pour ce service (via email) :
- Si oui → "Vous avez un pass (7/10 séances) — Utiliser 1 séance ?"
- Si non → saisie manuelle du code
→ 1 séance débitée → booking confirmé sans acompte

Logique identique au debit carte cadeau dans le booking flow, sauf :
- Check `service_id` match (le pass ne s'applique que si le service correspond)
- Décrémente `sessions_remaining` au lieu de `balance_cents`
- Transaction type `debit` avec `sessions: 1`

### 4. Annulation → re-crédit

Même pattern que `gift-card-refund.js` :
- Booking annulé → cherche `pass_transactions` de type `debit` pour ce booking
- Re-crédite 1 séance → transaction `refund`
- Si le pass était `used`, le remettre en `active`

### 5. No-show → pas de re-crédit

Quand le staff marque no-show, pas de refund pass. La séance est perdue.

### 6. Expiry cron

Même pattern que `giftcard-expiry.js` :
- Toutes les heures, marquer les passes `active` dont `expires_at < NOW()` en `expired`

### 7. Staff debit/refund manuel

Dashboard → Passes → sélectionne un pass → actions :
- Débiter : -1 séance (optionnel: lié à un booking)
- Rembourser : +1 séance
Même UI que les cartes cadeaux.

## Frontend

### Staff Dashboard — `src/frontend/views/passes.js`

Page dédiée "Passes" dans le sidebar (après "Cartes cadeau", icône ticket) :
- **KPI** : passes vendus, actifs, séances restantes total
- **Table** : code, client, service, séances X/Y, statut, expiration, actions (debit/refund/cancel)
- **Filtres** : statut + recherche (code, nom, email)

Les templates ne sont PAS ici — ils sont dans la fiche service (page Prestations → service → section Abonnements).

### Fiche service — Section Abonnements

Dans `src/frontend/views/services.js`, dans le modal/détail d'un service :
- **Toggle** "Proposer des abonnements" (off par défaut)
- Quand activé, affiche la liste des formules :
  - Chaque formule = card inline : nom, séances, prix, validité, toggle actif
  - Bouton "+ Ajouter une formule"
  - Inline edit ou mini-modal pour chaque formule
- Le toggle global `passes_enabled` dans les settings business doit aussi être activé (sinon la section affiche un message "Activez les abonnements dans Paramètres")

### Page publique — `public/pass.html`

Calquée sur `gift-card.html` :
- Hero avec branding business
- Cards pour chaque template actif (service, séances, prix, économie vs prix unitaire)
- Formulaire : nom, email
- Stripe Checkout
- Success state avec confetti

## Emails

### Email d'achat — `sendPassPurchaseEmail()`

Calqué sur `sendGiftCardEmail()` :
- Sujet : "Votre pass {name} — {Business}"
- Corps : code (monospace), service, séances, validité
- CTA : "Réserver maintenant" → `/{slug}/book`

### Email de confirmation debit (optionnel, v2)

Quand une séance est utilisée, email récap : "Séance 3/10 utilisée. 7 restantes."

## Fichiers à créer/modifier

### Nouveaux fichiers
- `schema-v60-passes.sql` — migration DB
- `src/routes/staff/passes.js` — routes staff
- `src/frontend/views/passes.js` — vue dashboard
- `public/pass.html` — page publique d'achat
- `src/services/pass-refund.js` — refund auto sur annulation
- `src/services/pass-expiry.js` — cron expiry

### Fichiers à modifier
- `src/server.js` — register routes + cron
- `src/routes/staff/settings.js` — ajouter settings passes
- `src/routes/staff/services.js` — CRUD templates dans la fiche service
- `src/routes/staff/stripe.js` — webhook handler pour type `pass`
- `src/routes/public/index.js` — endpoints publics (config, checkout, validate, check-passes)
- `src/routes/public/index.js` — intégration dans le booking flow (debit pass au lieu d'acompte)
- `src/frontend/router.js` — ajouter route passes
- `src/frontend/views/services.js` — section abonnements dans la fiche service
- `public/dashboard.html` — sidebar item
- `src/services/email.js` — template email pass
- `src/services/booking-cancellation.js` ou flow cancel — appeler pass-refund
