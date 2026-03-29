# Promos Checkout — Design Spec

## Concept

Système de promotions personnalisables affiché pendant le flow de réservation minisite pour augmenter le panier moyen des commercants Genda.

Le commercant crée des promos (conditions + récompenses + texte/visuel libre). Le client les voit à 3 endroits dans le booking flow. Un service offert s'ajoute au panier et recalcule les créneaux disponibles.

## Data Model

### Table `promotions`

```sql
CREATE TABLE promotions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  title VARCHAR(200) NOT NULL,
  description TEXT,
  image_url VARCHAR(500),
  condition_type VARCHAR(20) NOT NULL DEFAULT 'none',
  -- CHECK (condition_type IN ('min_amount', 'specific_service', 'first_visit', 'date_range', 'none'))
  condition_min_cents INT,
  condition_service_id UUID REFERENCES services(id) ON DELETE SET NULL,
  condition_start_date DATE,
  condition_end_date DATE,
  reward_type VARCHAR(20) NOT NULL,
  -- CHECK (reward_type IN ('free_service', 'discount_pct', 'discount_fixed', 'info_only'))
  reward_service_id UUID REFERENCES services(id) ON DELETE SET NULL,
  reward_value INT,
  display_style VARCHAR(10) NOT NULL DEFAULT 'cards',
  -- CHECK (display_style IN ('cards', 'banner'))
  sort_order INT DEFAULT 0,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_promotions_business ON promotions(business_id) WHERE is_active = true;
```

**Contraintes :**
- Max 5 promos actives par commercant
- `reward_service_id` doit référencer un service existant du même business
- `reward_value` = pourcentage (1-100) si `discount_pct`, centimes si `discount_fixed`

## Booking Flow (book.html)

### Position dans le flow

```
Step 1  — Choisir une prestation
Step 1.5 — Promos (nouveau, conditionnel)
Step 2  — Choisir un praticien
Step 3  — Choisir un créneau
Step 4  — Coordonnées
Step 5  — Confirmation
```

### 3 points d'affichage

**1. Badges inline (Step 1)**
- Badge sur chaque service éligible à une promo : `🎁 Massage offert dès 50€`
- Calculé côté frontend à partir des promos chargées via l'API minisite
- Pas d'interaction — teaser visuel uniquement

**2. Step 1.5 — Promos (nouveau step)**
- S'affiche uniquement s'il y a ≥ 1 promo éligible au panier actuel
- Si aucune promo éligible → step sauté automatiquement
- Maximum 3 promos affichées (triées par sort_order)
- Le client peut :
  - **Ajouter** un service offert → ajouté au panier à 0€, recalcul durée
  - **Accepter** une réduction → appliquée au total dans le résumé
  - **Ignorer** et cliquer "Continuer →"
- Style selon `display_style` : cartes empilées ou bannière carousel

**3. Style d'affichage**
- **Cartes** : liste verticale, chaque promo = image + titre + description + bouton "Ajouter"
- **Bannière** : carousel horizontal avec dots, un seul item visible à la fois, bouton "En profiter"

### Vérification d'éligibilité (frontend)

| Condition | Vérification |
|-----------|-------------|
| `min_amount` | Somme `price_cents` du panier ≥ `condition_min_cents` |
| `specific_service` | `condition_service_id` présent dans le panier |
| `first_visit` | Flag `is_new_client` passé par l'API (vérifié après saisie email au step 4, appliqué rétroactivement) |
| `date_range` | `condition_start_date ≤ aujourd'hui ≤ condition_end_date` |
| `none` | Toujours éligible |

### Impact sur le créneau

Quand un service offert (`free_service`) est ajouté au panier :
- La durée totale augmente → le système multi-service existant recalcule les créneaux
- Le service offert a `price_cents = 0` dans le panier mais sa `duration_min` compte
- Le praticien doit couvrir ce service (sinon split mode s'active)

## Interface Commercant (Dashboard)

### Section Promotions (sidebar)

**Vue liste :**
- Tableau : titre, condition résumée, récompense résumée, période, toggle actif/inactif
- Bouton "+" pour créer (max 5 actives)
- Drag & drop pour réordonner (sort_order)

**Modale création/édition :**
- Titre (requis)
- Description (texte libre)
- Image (upload optionnel)
- Condition : dropdown type → champs dynamiques selon le type
- Récompense : dropdown type → champs dynamiques selon le type
- Validité : dates optionnelles (vide = pas de limite)
- Style d'affichage : cartes ou bannière
- Aperçu live en bas de la modale

### Raccourci depuis la fiche Service

Dans la modale d'édition d'un service, section "Promotion liée" :
- Toggle "Offrir un service si cette prestation est réservée"
- Si activé : dropdown service cadeau + champs titre/description
- Crée/modifie une promo `condition_type = 'specific_service'` en base

## API

### Staff endpoints

| Méthode | Route | Description |
|---------|-------|-------------|
| `GET /api/promotions` | Liste des promos du business |
| `POST /api/promotions` | Créer une promo |
| `PATCH /api/promotions/:id` | Modifier une promo |
| `DELETE /api/promotions/:id` | Supprimer une promo |
| `PATCH /api/promotions/reorder` | Réordonner |

### Public endpoint

`GET /api/public/:slug` — réponse minisite existante, ajouter :

```json
{
  "promotions": [
    {
      "id": "...",
      "title": "Massage crânien offert",
      "description": "Profitez d'un massage...",
      "image_url": "...",
      "condition_type": "min_amount",
      "condition_min_cents": 5000,
      "condition_service_id": null,
      "reward_type": "free_service",
      "reward_service_id": "...",
      "reward_service_name": "Massage crânien",
      "reward_service_duration_min": 25,
      "reward_value": null,
      "display_style": "cards"
    }
  ]
}
```

### first_visit handling

Au step 1.5, `first_visit` ne peut pas être vérifié (on ne connaît pas le client). Deux options :
- Afficher la promo `first_visit` à tout le monde au step 1.5 avec mention "Offre nouveau client"
- Vérifier au step 4 quand l'email est saisi, et retirer/appliquer la promo rétroactivement

Approche retenue : afficher à tout le monde, vérifier au submit. Si le client n'est pas nouveau, la promo est ignorée silencieusement côté backend.

## Résumé technique

- 1 table SQL (`promotions`)
- 1 nouveau fichier route staff (`src/routes/staff/promotions.js`)
- 1 nouveau fichier vue frontend (`src/frontend/views/promotions.js`)
- Modifications : `book.html` (step 1.5 + badges), `minisite.js` (ajouter promos à la réponse), `services.js` (raccourci promo dans la fiche service)
- Pas de migration complexe — CREATE TABLE simple
