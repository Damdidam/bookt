# Délai de préavis paramétrable pour prestations sur devis

**Date** : 2026-04-14
**Scope** : prestations `quote_only` uniquement (les prestations classiques ne sont pas touchées)
**Problème résolu** : le plancher 72h hardcodé dans `slot-engine.js` écrase silencieusement la valeur saisie par le commerçant. L'UI affiche `0` mais le comportement réel est `72`. Trompeur et non paramétrable.

## Objectif

Rendre le champ `min_booking_notice_hours` **entièrement paramétrable** pour les prestations sur devis. Le commerçant doit pouvoir choisir librement son délai (ex. 48h pour un tatoueur de petits motifs, 168h pour un artiste qui prépare des sleeves). Supprimer toute magie runtime : la base de données devient la source de vérité unique.

## Décisions de cadrage (Q&A)

| # | Question | Décision |
|---|---|---|
| 1 | Scope | Devis uniquement. Harmonisation avec les prestations classiques = hors scope (future spec). |
| 2A | Plancher minimum ? | Aucun. Le commerçant peut saisir 0h. |
| 2B | Valeur par défaut à la création | 0h (saisie consciente exigée). |
| 3 | Label | Adaptatif selon `quote_only`. Label devis = *« Délai minimum pour étudier la demande (heures) »*. |
| 4 | Comportement au toggle "Sur devis" | Changement de label uniquement. Pas d'alerte, pas de placeholder, pas de déplacement. |
| 5 | Prestations existantes | Migration SQL one-shot → 72h pour toutes les prestations devis qui ont `< 72` actuellement. Préserve exactement le comportement courant. |
| 6 | Hint d'aide au choix | Contextuel : *« Temps minimum entre la demande du client et le RDV, pour examiner le projet et fixer un prix. Ex. 48h, 72h, 168h. »* |

## Architecture

**Aucune nouvelle colonne, aucun nouveau schéma.** Réutilisation du champ existant `services.min_booking_notice_hours`. La distinction sémantique classique/devis vit uniquement côté UI (label + hint adaptés selon `quote_only`).

**Source de vérité** : la base de données. Après ce changement, la valeur stockée = la valeur effective. Plus aucun override runtime.

## Changements backend

### `src/services/slot-engine.js`

Supprimer les 3 occurrences du plancher hardcodé 72h :
- Ligne 68 (première fonction de calcul de créneaux)
- Ligne 464 (deuxième fonction de calcul de créneaux)
- Ligne 914 (troisième fonction de calcul de créneaux)

Pattern exact à retirer dans chaque cas :
```js
// Quote-only services need minimum 72h notice for the merchant to review and set a price
if (service.quote_only && (service.min_booking_notice_hours || 0) < 72)
  service.min_booking_notice_hours = 72;
```

Après suppression, le moteur utilise directement `service.min_booking_notice_hours` tel qu'en base, sans distinction classique/devis.

### `src/routes/staff/services.js`

Aucun changement. Le champ `min_booking_notice_hours` est déjà accepté en `POST /services` (ligne 71) et en `PATCH /services/:id` via la whitelist `UPDATABLE_FIELDS` (ligne 246). Aucune validation supplémentaire (A1 = pas de plancher).

### Migration SQL one-shot

Nouveau fichier : `schema-vXX-quote-notice-migration.sql` (numéro de version à choisir selon la convention courante du projet — dernier constaté : `schema-v35-quote-requests.sql`, donc **v36**).

```sql
-- ============================================================
-- GENDA v36 — Quote notice parametrable
-- Preserve existing 72h behavior for quote services
-- ============================================================
UPDATE services
SET min_booking_notice_hours = 72
WHERE quote_only = true
  AND COALESCE(min_booking_notice_hours, 0) < 72;
```

**IMPORTANT** : cette migration doit être jouée **AVANT** le déploiement du code backend. Sinon fenêtre de quelques minutes où les prestations devis existantes sont "ouvertes" à 0h, ce qui permet des demandes pour des créneaux très proches avant que le merchant puisse réagir.

## Changements frontend

### `src/frontend/views/services.js` — ligne 665

Un seul bloc à modifier. État initial au rendu basé sur `svc?.quote_only`.

| `quote_only` | Label | Hint sous le champ |
|---|---|---|
| `false` (ou absent) | *« Préavis minimum (heures) »* | *« Délai minimum avant qu'un client puisse réserver en ligne »* (inchangé) |
| `true` | *« Délai minimum pour étudier la demande (heures) »* | *« Temps minimum entre la demande du client et le RDV, pour examiner le projet et fixer un prix. Ex. 48h, 72h, 168h. »* |

Ajouter des IDs stables pour pouvoir muter le DOM :
- `#svc_min_notice_label` sur le `<label>`
- `#svc_min_notice_hint` sur le `<small>`

### Réactivité au toggle `#svc_quote_only`

Créer une fonction `svcUpdateNoticeLabel()` qui lit l'état de la checkbox et met à jour `textContent` du label et du hint.

Appeler cette fonction depuis :
- Le `onchange` de `#svc_quote_only` (à ajouter).
- Une fois à la fin du rendu du formulaire, pour garantir la cohérence si le HTML initial est rendu dans un état puis remis à jour par `svc?.quote_only`.

### Aucune validation frontend

Le champ garde `min="0"`. Pas de plancher 72h, pas de warning. Le commerçant est libre.

### Valeur à la réouverture d'une prestation

- Jay-One (post-migration) → champ affiche `72`, label devis, hint devis.
- Nouvelle prestation devis → champ vide/`0` par défaut (défaut DB). Le commerçant saisit consciemment.

## Fichiers touchés

| Fichier | Type | Changement |
|---|---|---|
| `src/services/slot-engine.js` | Backend | Supprimer 3 blocs de 2 lignes (lignes 68, 464, 914). |
| `src/frontend/views/services.js` | Frontend | Modifier ligne 665 (label/hint adaptatifs) + ajouter handler `svcUpdateNoticeLabel()` + brancher sur `onchange` de `#svc_quote_only`. |
| `schema-v36-quote-notice-migration.sql` | Migration SQL | Nouveau fichier one-shot. |

Aucun changement : `routes/staff/services.js`, `routes/public/quote-request.js`, `routes/public/index.js`, `minisite.js`, schéma DB.

## Plan de test post-déploiement

1. **Backup DB** de production avant migration SQL.
2. Jouer la migration SQL → vérifier `SELECT id, name, min_booking_notice_hours FROM services WHERE quote_only = true;` — toutes les lignes doivent avoir `>= 72`.
3. Déployer backend + frontend (`npm run build` + `git add -f dist/` + push + trigger Render).
4. Ouvrir Jay-One dans l'éditeur de prestation → le champ doit afficher **72**, label *« Délai minimum pour étudier la demande (heures) »*, hint contextuel devis.
5. Changer la valeur à **48** → sauver → rouvrir → doit afficher 48.
6. Côté public : tenter une demande de devis pour un créneau à +30h → doit être **refusée** (créneau non proposé par le slot-engine). Tenter à +50h → doit **passer**.
7. Décocher "Sur devis" sur Jay-One dans l'éditeur (sans sauver) → label doit repasser à *« Préavis minimum (heures) »*, hint générique. Recocher → hint devis revient.
8. Créer une nouvelle prestation, cocher "Sur devis" → champ délai = 0/vide par défaut, label + hint contextuels immédiatement.
9. Tester une prestation **classique** non touchée → label/hint inchangés.
10. Test extrême : mettre `min_booking_notice_hours = 0` sur un service devis → une demande pour un créneau dans 1h doit passer (confirme suppression du plancher).

## Hors scope (pour éviter scope creep)

- Harmonisation du label/hint pour les prestations **classiques** (non-devis).
- Boutons raccourcis `[24h][48h][72h][168h]` (option D de Q6 — rejetée).
- Alerte visuelle quand `quote_only = true` et valeur = 0 (option D de Q4 — rejetée).
- Toggle unité heures/jours (rejeté implicitement, on reste en heures).
- Affichage explicite du délai côté client (minisite / quote form) — le slot-engine filtre déjà les créneaux non éligibles ; le client ne voit pas de message texte, il voit simplement des créneaux disponibles.

## Risques identifiés

- **Ordre de déploiement** : migration SQL AVANT code backend, sinon fenêtre où les services devis sont ouverts à 0h.
- **Cache frontend** : vérifier que le `onchange` met bien à jour le DOM. Vanilla JS donc faible risque, mais à tester.
- **Prestations devis existantes avec valeur déjà > 72** : la migration SQL utilise `COALESCE(..., 0) < 72` donc ne touche pas les valeurs déjà supérieures. Pas de régression.
