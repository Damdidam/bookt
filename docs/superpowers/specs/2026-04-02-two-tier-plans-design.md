# Design — Deux plans Bookt (Gratuit + Pro 60€)

## Contexte

Simplification du modèle d'abonnement : passer de 3 plans (free/pro 39€/premium 79€) à 2 plans. Pas de migration nécessaire (aucun abonné payant existant). Le plan gratuit sert de trial permanent — pas de période d'essai.

## Les plans

| | **Gratuit** | **Pro** (60€/mois) |
|---|---|---|
| Praticiens | 1 | Illimités |
| RDV confirmés/semaine | 25 (en ligne bloqué, staff libre) | Illimités |
| Minisite | Oui | Oui |
| Thèmes | 1 (Classique) | Tous + couleur custom |
| Clients | Illimités | Illimités |
| Email rappels | Oui | Oui |
| SMS rappels | Non | 200/mois inclus, surplus 0,08€/SMS |
| Call filter | Non | 200 unités/mois, surplus 0,15€/unité |
| Statistiques avancées | Non | Oui |
| Voicemail | Non | Oui |
| Support prioritaire | Non | Oui |

Feature supprimée : domaine personnalisé (jamais implémenté).

## Enforcement backend

### Nouveau : limite praticiens (gratuit = 1)

- Route `POST /api/practitioners` : si `plan === 'free'` et déjà 1 praticien actif → 403
- Frontend : bouton "Ajouter un praticien" désactivé + badge upgrade si free

### Nouveau : limite 25 RDV/semaine (gratuit, en ligne uniquement)

Compteur :
```sql
SELECT COUNT(*) FROM bookings
WHERE business_id = $1
  AND status IN ('confirmed', 'pending', 'pending_deposit', 'modified_pending')
  AND start_at >= date_trunc('week', NOW() AT TIME ZONE 'Europe/Brussels')
  AND start_at < date_trunc('week', NOW() AT TIME ZONE 'Europe/Brussels') + INTERVAL '1 week'
```

- Gate sur `POST /:slug/bookings` (route publique) : si >= 25 → 403 avec message client-friendly
- La création staff (dashboard) n'est PAS bloquée — le commerçant peut toujours créer manuellement
- Bandeau dashboard quand 20+ atteints : "20/25 RDV cette semaine — Passez au Pro pour des RDV illimités"

Message client quand limite atteinte (minisite) : "Ce professionnel est complet pour cette semaine. Réessayez la semaine prochaine ou contactez directement le salon." Aucune mention du plan/pricing côté client.

### Nouveau : gate analytics (gratuit)

- Route `GET /api/dashboard/analytics` (et sous-routes) : si `plan === 'free'` → 403
- Frontend : page analytics affiche un écran upgrade au lieu des stats

### Existant à simplifier

| Feature | Avant | Après |
|---------|-------|-------|
| SMS gate | `['pro', 'premium'].includes(plan)` | `plan !== 'free'` |
| Call filter quotas | `{free: 0, pro: 100, premium: 300}` | `{free: {units: 0}, pro: {units: 200, extra_price_cents: 8}}` |
| Custom color/theme | Disabled si `plan === 'free'` (déjà en place) | Inchangé |
| PLANS_WITH_SMS | `['pro', 'premium']` | `['pro']` |

### À supprimer

- Toute référence à `'premium'` dans le code (plan value, conditions, UI)
- Feature "domaine personnalisé" dans le texte marketing (settings.js)
- `STRIPE_PRICE_PREMIUM` env var — un seul prix `STRIPE_PRICE_PRO` (60€/mois)
- Cards UI 3 colonnes → 2 colonnes dans la page abonnement

## Stripe

- Un seul `price_id` Stripe : 60€/mois récurrent
- Pas de trial Stripe (le plan gratuit est le trial permanent)
- Flow existant conservé : Checkout → webhook `checkout.session.completed` → set plan='pro'
- Downgrade : webhook `subscription.deleted` → plan='free', clear stripe fields
- Stripe Customer Portal pour gérer/annuler
- Suppression du code de gestion pro↔premium upgrade

## SMS surplus billing

Le surplus SMS (au-delà de 200/mois) est tracké côté serveur :
- Table `sms_usage` ou compteur dans `businesses` : `sms_count_month`, `sms_month_reset_at`
- Chaque SMS envoyé incrémente le compteur
- Si >= 200 : l'envoi continue mais le surplus est logué pour facturation
- Reset mensuel via cron ou au premier SMS du mois suivant
- Facturation surplus : via Stripe Usage-Based Billing (metered) ou invoice manuelle (phase 1 = log, phase 2 = Stripe metered)

## Call filter surplus

Même logique que SMS surplus. Quota 200 unités/mois, surplus logué pour facturation à 0,15€/unité.

## UI settings — page abonnement

Deux cards côte à côte :

**Card Gratuit** (si plan actuel = free) :
- Badge "Plan actuel"
- Liste des features gratuites
- Limites visibles : "1 praticien", "25 RDV/semaine", "Email uniquement"

**Card Pro 60€/mois** :
- Bouton CTA "Passer au Pro" → Stripe Checkout
- Liste complète des features
- "Illimité" en face de praticiens et RDV
- "200 SMS/mois inclus"

Si déjà Pro :
- Card Pro avec badge "Plan actuel"
- Lien "Gérer mon abonnement" → Stripe Customer Portal
- Card Gratuit avec texte "Votre ancien plan" (pas de downgrade direct — via Portal)

## Bandeau upgrade dans le dashboard

Pour les business en free, un bandeau contextuel s'affiche :
- **Limite RDV** : quand >= 20/25, bandeau jaune "20/25 RDV cette semaine — Passez au Pro"
- **Tentative ajout praticien** : toast "Passez au Pro pour ajouter des praticiens"
- **Page analytics** : écran complet "Statistiques disponibles avec le plan Pro" + CTA
- **Toggles SMS** : déjà disabled avec badge (existant, à garder)

## Fichiers impactés (estimation)

### Backend
- `src/routes/staff/signup.js` — plan reste 'free' (inchangé)
- `src/routes/staff/stripe.js` — simplifier à un seul price, supprimer premium logic
- `src/routes/staff/practitioners.js` — ajouter guard plan=free max 1
- `src/routes/public/index.js` — ajouter guard 25 RDV/semaine pour plan=free
- `src/routes/staff/dashboard.js` — ajouter guard analytics plan=free
- `src/services/reminders.js` — simplifier PLANS_WITH_SMS
- `src/routes/public/booking-notifications.js` — simplifier plan checks
- `src/routes/staff/bookings-status.js` — simplifier plan checks
- `src/routes/staff/calls.js` — simplifier PLAN_QUOTAS
- `src/routes/admin/index.js` — plan values ['free', 'pro'] au lieu de 3

### Frontend
- `src/frontend/views/settings.js` — refondre la section abonnement (2 plans)
- `src/frontend/views/home.js` — bandeau upgrade + compteur RDV
- `src/frontend/views/analytics.js` — écran upgrade si free
- `src/frontend/views/team.js` — guard ajout praticien
- `src/frontend/views/site.js` — supprimer refs premium

### Cleanup global
- Grep `premium` dans tout src/ + public/ → supprimer ou remplacer par 'pro'
- Grep `STRIPE_PRICE_PREMIUM` → supprimer
