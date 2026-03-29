# Promos Backend Integration — Design Spec

**Date:** 2026-03-29
**Scope:** Intégrer les promos dans le backend (booking creation, dépôts, calendrier, facturation)

## Contexte

Les promos sont implémentées côté frontend (book.html, site.html) mais rien n'est enregistré en DB lors de la création d'un booking. Le commerçant ne voit aucune trace de la réduction dans le calendrier ni dans la facture.

## 1. Schema DB

Migration `schema-v54-booking-promotions.sql` :

```sql
ALTER TABLE bookings
  ADD COLUMN promotion_id UUID REFERENCES promotions(id) ON DELETE SET NULL,
  ADD COLUMN promotion_label VARCHAR(200),
  ADD COLUMN promotion_discount_pct INTEGER,
  ADD COLUMN promotion_discount_cents INTEGER NOT NULL DEFAULT 0;
```

- `promotion_id` — FK vers la promo (SET NULL si supprimée, on garde label/montant)
- `promotion_label` — snapshot du titre au moment du booking
- `promotion_discount_pct` — % appliqué (nullable, rempli seulement si discount_pct)
- `promotion_discount_cents` — montant déduit en centimes (toujours rempli si promo, 0 sinon)

Pour `free_service` : le service offert est ajouté au booking multi-prestation, `promotion_discount_cents` = prix du service offert.

## 2. Booking Creation

Dans `src/routes/public/index.js` (POST /api/public/:slug/bookings) :

### Frontend envoie
- `promotion_id` — l'ID de la promo appliquée (ou null)

### Backend valide (100% server-side)
- La promo existe, est active, appartient au business
- Vérification de la condition :
  - `specific_service` → le service concerné est dans le panier
  - `min_amount` → total panier (avant réduction) >= `condition_min_cents`
  - `first_visit` → le client n'existe PAS dans la table `clients` pour ce business
  - `date_range` → `NOW()` est entre `condition_start_date` et `condition_end_date`
  - `none` → toujours valide
- Si validation échoue → promo ignorée silencieusement (booking créé sans promo)

### Calcul du discount
- `discount_pct` + `specific_service` → `service_price * reward_value / 100`
- `discount_pct` + autre condition → `total_panier * reward_value / 100`
- `discount_fixed` + `specific_service` → `min(reward_value, service_price)`
- `discount_fixed` + autre condition → `min(reward_value, total_panier)`
- `free_service` → service offert ajouté au panier, réduction = prix du service offert

### Sauvegarde
- `promotion_id`, `promotion_label` (= promo.title), `promotion_discount_pct`, `promotion_discount_cents`

## 3. Acomptes (dépôts)

Dans `shouldRequireDeposit()` (helpers.js) :

- **Seuil de déclenchement** : comparé au prix ORIGINAL (pas réduit) — empêche l'abus de promo pour éviter le dépôt
- **Montant du dépôt** : calculé sur le prix RÉDUIT (`totalPriceCents - promotion_discount_cents`)

Exemple :
```
Prix original : 250€
Promo -20% : -50€ → prix réduit : 200€
Seuil dépôt : 100€ → déclenché (comparé à 250€)
Dépôt 50% : 50% de 200€ = 100€
```

Cas `free_service` : le service offert a un prix de 0€, n'impacte ni seuil ni montant.

## 4. Calendrier (modale détail)

Dans `booking-detail.js`, `fcOpenDetail()` :

- **Bandeau promo** visible si `promotion_discount_cents > 0` :
  - Icône + `promotion_label`
  - Prix original barré + prix réduit
  - Montant de la réduction
- **Service offert** (`free_service`) : mention "(offert)" à côté du nom du service dans la liste multi-prestation
- Purement informatif, pas de bouton d'action
- L'API `GET /api/bookings/:id/detail` retourne déjà toutes les colonnes — les nouvelles colonnes `promotion_*` sont automatiquement incluses

## 5. Facturation

Dans `invoices.js`, génération automatique des lignes depuis un booking avec promo :

1. **Ligne(s) service** — au prix original (comme aujourd'hui)
   - "PlexR à froid — 250,00€"
2. **Ligne de réduction** (si `promotion_discount_cents > 0`)
   - Description : "Réduction : {promotion_label}"
   - `unit_price_cents` : `-promotion_discount_cents` (négatif)
   - `quantity` : 1
3. **Service offert** (cas `free_service`) — apparaît à 0€
   - "Soin visage (offert) — 0,00€"

Totaux :
- `subtotal_cents` = somme de toutes les lignes (y compris négative)
- `vat_amount_cents` = subtotal × taux TVA
- `total_cents` = subtotal + TVA

Pas de changement au schéma `invoice_items` (supporte déjà les montants négatifs).

## Règles métier

- **1 promo max par booking** (approche A — colonnes sur bookings)
- **Validation 100% server-side** — le frontend peut afficher ce qu'il veut
- **`first_visit`** = le client n'existe pas dans la table `clients` pour ce business
- **`date_range`** = la date de réservation (NOW()) doit être dans la plage, pas la date du RDV
- **Réduction `specific_service`** = appliquée sur le service concerné seulement
- **Réduction `min_amount`/`first_visit`/`date_range`/`none`** = appliquée sur le total du panier
- **`promotion_label`** snapshotté au booking — indépendant de la promo (qui peut être modifiée/supprimée)

## Fichiers impactés

| Fichier | Changement |
|---------|-----------|
| `schema-v54-booking-promotions.sql` | Nouvelle migration — 4 colonnes sur bookings |
| `src/routes/public/index.js` | Validation promo + calcul discount + sauvegarde |
| `src/routes/public/helpers.js` | `shouldRequireDeposit()` — dépôt sur prix réduit |
| `src/frontend/views/agenda/booking-detail.js` | Bandeau promo dans la modale |
| `src/routes/staff/invoices.js` | Ligne de réduction auto dans la facture |
| `public/book.html` | Envoyer `promotion_id` dans le POST booking |
