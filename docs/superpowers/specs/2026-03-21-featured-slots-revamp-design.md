# Refonte UX — Créneaux Vedettes (Featured Slots)

**Date:** 2026-03-21
**Scope:** Frontend uniquement (`featured-slots.js`) — aucun changement backend/DB

## Problème

Le mode vedette actuel est inutilisable pour une praticienne qui gère ses dispos au jour le jour :
- Workflow en 3 étapes (sélectionner → sauvegarder → verrouiller) = friction inutile
- Sélection cellule par cellule (30 min) = trop de clics pour couvrir une demi-journée
- Pas de drag-to-select
- Pas responsive (inutilisable sur tablette)

## Business case

Une esthéticienne dont les enfants sont souvent malades veut choisir ses créneaux chaque semaine au coup par coup. Elle ne peut pas planifier à l'avance. Elle a besoin d'un outil rapide et fluide.

## Design

### 1. Modèle simplifié : 2 états au lieu de 3

| Avant | Après |
|-------|-------|
| Vide → Sauvegardé → Verrouillé | Brouillon → Publié |
| 2 boutons (Enregistrer + Verrouiller) | 1 bouton (Publier / Dépublier) |

- **Publier** = sauvegarde les créneaux (`PUT /api/featured-slots`) + verrouille la semaine (`PUT /api/featured-slots/lock`) en une seule action
  - **Désactivé si 0 créneaux sélectionnés** (bouton grisé + tooltip "Sélectionnez au moins un créneau")
  - Si le verrouillage échoue après la sauvegarde → toast d'erreur, reste en Brouillon (les créneaux sont sauvegardés, l'utilisateur peut retenter)
- **Dépublier** = déverrouille (`DELETE /api/featured-slots/lock`), les créneaux restent sauvegardés côté serveur et visibles dans la grille pour édition
- Badge d'état visible : "Brouillon" (gris) ou "Publié" (vert)
- **"Brouillon"** signifie : la semaine n'est pas verrouillée, les créneaux peuvent exister en DB mais ne sont pas exposés aux clients sur le minisite

### 2. Drag-to-select

- **Mousedown** sur une cellule → début de sélection
- **Mousemove** → étend la sélection verticalement (même colonne/jour uniquement)
- **Mouseup** → applique le toggle :
  - Si cellule de départ était vide → sélectionne toute la plage
  - Si cellule de départ était sélectionnée → désélectionne toute la plage
- **Preview visuel** pendant le drag : bordure pointillée + fond semi-transparent sur les cellules survolées
- **Drag confiné à la colonne d'origine** : si le curseur quitte la colonne, la sélection reste figée sur la colonne d'origine. Le mouseup applique la sélection jusqu'au dernier slot survolé dans la colonne.
- **Touch support** : touchstart/touchmove/touchend avec `document.elementFromPoint()` pour détecter la cellule sous le doigt
- **Semaines passées** : toutes les interactions (clic, drag, sélection colonne, boutons) sont désactivées

### 3. Sélection par colonne

- Clic sur l'en-tête du jour → toggle toute la colonne
  - Si au moins une cellule vide (non bookée) → sélectionne tout
  - Si tout est déjà sélectionné → désélectionne tout
- Les cellules déjà bookées sont **toujours ignorées** (ni sélectionnées, ni désélectionnées)

### 4. Protection des créneaux déjà bookés

Les créneaux avec un RDV existant (statut != cancelled/no_show) :
- Affichés avec style distinct (grisés + icône X) — **inchangé**
- **Non sélectionnables** par clic simple
- **Ignorés** par le drag-to-select (le drag les survole sans les inclure)
- **Ignorés** par la sélection de colonne entière
- Tooltip au survol : "Créneau déjà réservé"

### 5. Responsive

- **Grille scrollable horizontalement** sur écran < 768px
- **Cellules tactiles** : min 44x44px (touch target iOS/Android)
- **Sur petit écran** : tap-to-toggle uniquement (pas de drag, trop imprécis sur mobile)
- **Sur tablette** : drag-to-select actif (écran assez grand pour être précis)
- Breakpoint tactile : drag activé si `@media (min-width: 768px) and (pointer: fine)`, sinon tap uniquement
- Header : wrap des contrôles en colonne sur mobile

### 6. UI Header simplifié

```
[Praticien ▼]  [◀ lun. 17 mars — dim. 23 mars ▶]  [● Brouillon / ✓ Publié]

                                    [12 créneaux]  [Tout effacer]  [Publier]
```

- Quand publié : le bouton principal devient "Dépublier" (style outline/danger), "Tout effacer" est masqué
- Quand brouillon : le bouton principal est "Publier" (style primary), "Tout effacer" visible
- Le compteur de créneaux reste visible
- Si un seul praticien : afficher son nom en texte (pas de select)

### 7. Backend

**Aucun changement.** Les endpoints et tables restent identiques :
- `GET /api/featured-slots` — liste les créneaux
- `PUT /api/featured-slots` — remplace les créneaux d'une semaine
- `DELETE /api/featured-slots` — supprime tous les créneaux d'une semaine (utilisé par "Tout effacer")
- `GET /api/featured-slots/lock` — vérifie le statut de verrouillage
- `PUT /api/featured-slots/lock` — verrouille la semaine
- `DELETE /api/featured-slots/lock` — déverrouille

Le frontend chaîne les appels pour "Publier" et fait un seul appel pour "Dépublier".

### 8. Navigation avec modifications non publiées

Quand l'utilisateur change de semaine ou de praticien avec des créneaux modifiés mais non publiés :
- Afficher un dialog de confirmation : "Vos modifications ne sont pas publiées. Quitter quand même ?"
- Si OK → naviguer sans sauvegarder
- Si Annuler → rester sur la semaine courante

### 9. Implémentation : render optimisé

Le `render()` actuel reconstruit tout le DOM à chaque toggle. Avec le drag (mousemove), ce serait trop coûteux. L'implémentation devra :
- Séparer le render initial (construction du DOM) d'une fonction légère de mise à jour des classes CSS des cellules
- Pendant le drag, ne mettre à jour que les classes des cellules concernées (pas de innerHTML)

### 10. Périmètre exclus

- Pas de vue multi-semaine
- Pas de template / récurrence
- Pas de copier-coller de semaine
- Pas de changement de schema DB
- Pas de nouvelle API
