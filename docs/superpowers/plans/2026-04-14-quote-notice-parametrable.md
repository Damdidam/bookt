# Délai de préavis paramétrable (prestations sur devis) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rendre `min_booking_notice_hours` entièrement paramétrable pour les prestations `quote_only` en supprimant le plancher 72h hardcodé dans `slot-engine.js`, avec label + hint adaptatifs côté UI et migration SQL préservant le comportement actuel.

**Architecture:** Un seul champ DB (`services.min_booking_notice_hours`) déjà existant, réutilisé pour classique et devis. La distinction sémantique vit uniquement côté UI. Plancher 72h retiré des 3 fonctions de calcul de créneaux. Migration one-shot pour préserver le comportement sur les prestations devis existantes.

**Tech Stack:** Node.js (Express), PostgreSQL (Render), vanilla JS frontend, déploiement Render manuel.

**Spec source:** `docs/superpowers/specs/2026-04-14-quote-notice-parametrable-design.md`

---

## File Structure

| Fichier | Type | Rôle |
|---|---|---|
| `schema-v70-quote-notice-migration.sql` | Create | Migration SQL one-shot qui fixe `min_booking_notice_hours = 72` sur toutes les prestations `quote_only` ayant `< 72`. |
| `src/services/slot-engine.js` | Modify (3 sites) | Supprimer le plancher runtime 72h aux lignes ~68, ~464, ~914. |
| `src/frontend/views/services.js` | Modify (1 site + nouvelle fonction) | Rendre label et hint adaptatifs selon `quote_only`, ajouter `svcUpdateNoticeLabel()` et brancher sur `onchange` du toggle. |
| `dist/**` | Regénéré | Résultat de `npm run build`. Forcé dans git selon convention du projet (CLAUDE memory : Rule feedback_build_before_push). |

---

## Task 1 : Créer la migration SQL v70

**Files:**
- Create: `schema-v70-quote-notice-migration.sql`

- [ ] **Step 1: Créer le fichier de migration**

Create `schema-v70-quote-notice-migration.sql` avec ce contenu exact :

```sql
-- ============================================================
-- GENDA v70 — Quote notice parametrable
-- Preserve existing 72h behavior for quote services before
-- removing the runtime floor in slot-engine.js
-- ============================================================
UPDATE services
SET min_booking_notice_hours = 72
WHERE quote_only = true
  AND COALESCE(min_booking_notice_hours, 0) < 72;
```

- [ ] **Step 2: Vérifier la syntaxe SQL**

Run: `grep -c "UPDATE services" schema-v70-quote-notice-migration.sql`
Expected: `1`

- [ ] **Step 3: Commit**

```bash
git add schema-v70-quote-notice-migration.sql
git commit -m "schema(v70): migration préservant 72h pour prestations devis existantes

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

## Task 2 : Retirer le plancher 72h runtime — site 1 (ligne ~68)

**Files:**
- Modify: `src/services/slot-engine.js:66-68` (fonction de calcul de créneaux mono-service)

- [ ] **Step 1: Lire le contexte actuel**

Run: `grep -n "Quote-only services need" src/services/slot-engine.js`
Expected: une ligne vers la ligne 67.

- [ ] **Step 2: Supprimer le bloc de 2 lignes**

Pattern exact à retirer (contexte : juste après `const service = svcResult.rows[0];`) :

```js
  // Quote-only services need minimum 72h notice for the merchant to review and set a price
  if (service.quote_only && (service.min_booking_notice_hours || 0) < 72) service.min_booking_notice_hours = 72;
```

La ligne vide suivante peut rester ou être supprimée selon ce qui reste cohérent avec le style environnant.

- [ ] **Step 3: Vérifier que seules 2 occurrences subsistent**

Run: `grep -c "min_booking_notice_hours || 0) < 72" src/services/slot-engine.js`
Expected: `2` (les 2 autres sites, à traiter dans Task 3 et Task 4)

- [ ] **Step 4: Vérifier que le fichier parse**

Run: `node -c src/services/slot-engine.js` ou `node --check src/services/slot-engine.js`
Expected: aucune erreur (exit code 0).

Si `node --check` n'est pas disponible pour les fichiers require-based, faire à la place :
Run: `node -e "require('./src/services/slot-engine.js')"`
Expected: peut échouer sur les dépendances DB mais **pas sur la syntaxe**. Une erreur de type `SyntaxError` est un échec ; une erreur type `Cannot find module 'pg'` ou équivalente est attendue et acceptable.

- [ ] **Step 5: Commit**

```bash
git add src/services/slot-engine.js
git commit -m "fix(slot-engine): retire plancher 72h runtime — site 1 (mono-service)

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

## Task 3 : Retirer le plancher 72h runtime — site 2 (ligne ~464)

**Files:**
- Modify: `src/services/slot-engine.js:462-465` (boucle multi-service, fonction suivante)

- [ ] **Step 1: Lire le contexte actuel**

Run: `grep -n "Quote-only services: enforce minimum 72h notice" src/services/slot-engine.js`
Expected: 2 lignes (l'une vers 462, l'autre vers 912).

- [ ] **Step 2: Supprimer le bloc de 3 lignes au premier site (ligne ~462)**

Pattern exact à retirer :

```js
  // Quote-only services: enforce minimum 72h notice
  for (const svc of svcResult.rows) {
    if (svc.quote_only && (svc.min_booking_notice_hours || 0) < 72) svc.min_booking_notice_hours = 72;
  }
```

ATTENTION : ce pattern apparaît **deux fois** dans le fichier. Utiliser un Edit sur une seule occurrence à la fois en incluant suffisamment de contexte environnant pour que le matching soit unique.

Pour cette étape, inclure le contexte **3 lignes avant** pour discriminer (exemple de contexte au site ~462) :

```js
    throw Object.assign(new Error(`Prestation(s) introuvable(s): ${missing.join(', ')}`), { type: 'not_found' });
  }
  // Quote-only services: enforce minimum 72h notice
  for (const svc of svcResult.rows) {
    if (svc.quote_only && (svc.min_booking_notice_hours || 0) < 72) svc.min_booking_notice_hours = 72;
  }

  // Build a lookup and expand to match serviceIds order (duplicates get independent copies)
```

Vérifier quel site on traite : le premier `grep -n` du step 1 donne les 2 numéros de ligne. On traite le plus petit en premier (site 2). Le site 3 (le plus grand) est traité dans Task 4.

- [ ] **Step 3: Vérifier qu'il ne reste qu'une occurrence**

Run: `grep -c "Quote-only services: enforce minimum 72h notice" src/services/slot-engine.js`
Expected: `1`

Run: `grep -c "min_booking_notice_hours || 0) < 72" src/services/slot-engine.js`
Expected: `1`

- [ ] **Step 4: Vérifier la syntaxe**

Run: `node -e "require('./src/services/slot-engine.js')" 2>&1 | grep -c SyntaxError`
Expected: `0`

- [ ] **Step 5: Commit**

```bash
git add src/services/slot-engine.js
git commit -m "fix(slot-engine): retire plancher 72h runtime — site 2 (multi-service)

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

## Task 4 : Retirer le plancher 72h runtime — site 3 (ligne ~914)

**Files:**
- Modify: `src/services/slot-engine.js:912-915` (dernière fonction de calcul)

- [ ] **Step 1: Lire le contexte actuel**

Run: `grep -n "Quote-only services: enforce minimum 72h notice" src/services/slot-engine.js`
Expected: 1 ligne (la dernière restante).

- [ ] **Step 2: Supprimer le bloc de 3 lignes au dernier site**

Pattern exact à retirer (identique au site 2) :

```js
  // Quote-only services: enforce minimum 72h notice
  for (const svc of svcResult.rows) {
    if (svc.quote_only && (svc.min_booking_notice_hours || 0) < 72) svc.min_booking_notice_hours = 72;
  }
```

- [ ] **Step 3: Vérifier qu'il ne reste AUCUNE occurrence**

Run: `grep -c "Quote-only services" src/services/slot-engine.js`
Expected: `0`

Run: `grep -c "min_booking_notice_hours || 0) < 72" src/services/slot-engine.js`
Expected: `0`

- [ ] **Step 4: Vérifier la syntaxe**

Run: `node -e "require('./src/services/slot-engine.js')" 2>&1 | grep -c SyntaxError`
Expected: `0`

- [ ] **Step 5: Commit**

```bash
git add src/services/slot-engine.js
git commit -m "fix(slot-engine): retire plancher 72h runtime — site 3 (dernier)

Plus aucun override runtime. min_booking_notice_hours en DB = valeur effective.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

## Task 5 : Label + hint adaptatifs dans le rendu de services.js

**Files:**
- Modify: `src/frontend/views/services.js:665` (bloc HTML du champ min_notice)

- [ ] **Step 1: Localiser le bloc actuel**

Run: `grep -n "svc_min_notice" src/frontend/views/services.js`
Expected: au moins 2 lignes — une dans le bloc HTML (~665), une dans `body.min_booking_notice_hours` (~904).

- [ ] **Step 2: Remplacer le bloc HTML par une version qui calcule label et hint selon `quote_only`**

Ligne actuelle (665) :

```js
  m+=`<div class="svc-form-row" style="margin-bottom:14px"><div class="field"><label>Préavis minimum (heures)</label><input type="number" id="svc_min_notice" value="${svc?.min_booking_notice_hours||0}" min="0" placeholder="0"><small style="color:var(--text-secondary);font-size:11px">Délai minimum avant qu'un client puisse réserver en ligne</small></div></div>`;
```

Remplacer par (juste avant, sur la ligne précédente, on calcule les textes) :

```js
  const _isQuote = !!svc?.quote_only;
  const _minNoticeLabel = _isQuote ? 'Délai minimum pour étudier la demande (heures)' : 'Préavis minimum (heures)';
  const _minNoticeHint = _isQuote
    ? 'Temps minimum entre la demande du client et le RDV, pour examiner le projet et fixer un prix. Ex. 48h, 72h, 168h.'
    : 'Délai minimum avant qu\'un client puisse réserver en ligne';
  m+=`<div class="svc-form-row" style="margin-bottom:14px"><div class="field"><label id="svc_min_notice_label">${_minNoticeLabel}</label><input type="number" id="svc_min_notice" value="${svc?.min_booking_notice_hours||0}" min="0" placeholder="0"><small id="svc_min_notice_hint" style="color:var(--text-secondary);font-size:11px">${_minNoticeHint}</small></div></div>`;
```

Justification des choix :
- Préfixe `_` : cohérent avec le style local du fichier (exemples `_qoPro`, `_pd`, `_d` ailleurs dans le même fichier).
- IDs stables sur label/hint : nécessaires pour la mutation DOM au toggle (Task 6).
- Texte du hint : copie exacte de la spec (section frontend).

- [ ] **Step 3: Vérifier la présence des nouveaux IDs**

Run: `grep -c "svc_min_notice_label\|svc_min_notice_hint" src/frontend/views/services.js`
Expected: `2` minimum (peut être plus si on les référence ailleurs plus tard — à ce stade exactement 2).

- [ ] **Step 4: Vérifier la syntaxe**

Run: `node --check src/frontend/views/services.js`
Expected: aucune erreur.

- [ ] **Step 5: Commit**

```bash
git add src/frontend/views/services.js
git commit -m "feat(services): label+hint adaptatifs pour min_notice selon quote_only

Affichage initial correct. Réactivité au toggle dans commit suivant.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

## Task 6 : Handler `svcUpdateNoticeLabel()` + branchement `onchange` du toggle

**Files:**
- Modify: `src/frontend/views/services.js` (ajout fonction + modif onchange de `#svc_quote_only`)

- [ ] **Step 1: Localiser l'emplacement de la checkbox quote_only**

Run: `grep -n "svc_quote_only" src/frontend/views/services.js`
Expected: plusieurs lignes — notamment celle du rendu HTML (~646) et celle du body de sauvegarde (~905).

- [ ] **Step 2: Ajouter `onchange="svcUpdateNoticeLabel()"` à l'input checkbox**

Ligne actuelle (646, simplifiée sur le `<input>`) :

```js
<input type="checkbox" id="svc_quote_only" ${svc?.quote_only?'checked':''} ${_qoPro?'':'disabled'}>
```

Devient :

```js
<input type="checkbox" id="svc_quote_only" ${svc?.quote_only?'checked':''} ${_qoPro?'':'disabled'} onchange="svcUpdateNoticeLabel()">
```

- [ ] **Step 3: Ajouter la fonction `svcUpdateNoticeLabel` dans le même fichier**

Localiser une fonction soeur exposée globalement. Exemple :

Run: `grep -n "^window\.svc\|window\.svcTogglePose\|window\.svcToggleSched" src/frontend/views/services.js`
Expected: lignes où des handlers similaires sont exposés sur `window`.

Ajouter la fonction à côté des autres (exemple : juste après `window.svcTogglePose` ou une autre fonction UI voisine) :

```js
window.svcUpdateNoticeLabel = function(){
  const isQuote = !!document.getElementById('svc_quote_only')?.checked;
  const lbl = document.getElementById('svc_min_notice_label');
  const hint = document.getElementById('svc_min_notice_hint');
  if (lbl) lbl.textContent = isQuote ? 'Délai minimum pour étudier la demande (heures)' : 'Préavis minimum (heures)';
  if (hint) hint.textContent = isQuote
    ? 'Temps minimum entre la demande du client et le RDV, pour examiner le projet et fixer un prix. Ex. 48h, 72h, 168h.'
    : 'Délai minimum avant qu\'un client puisse réserver en ligne';
};
```

Si la convention du fichier est plutôt `function svcXxx(){...}` exposée via une autre méthode, aligner sur celle-là (vérifier comment `svcTogglePose` est définie et exposée).

- [ ] **Step 4: Vérifier la syntaxe**

Run: `node --check src/frontend/views/services.js`
Expected: aucune erreur.

- [ ] **Step 5: Vérifier la présence du nouveau handler dans le `onchange`**

Run: `grep -c "onchange=\"svcUpdateNoticeLabel()\"" src/frontend/views/services.js`
Expected: `1`

- [ ] **Step 6: Commit**

```bash
git add src/frontend/views/services.js
git commit -m "feat(services): svcUpdateNoticeLabel() pour label+hint réactifs au toggle devis

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

## Task 7 : Build frontend + forcer dist/ dans git

**Files:**
- Modify: `dist/**` (regénéré par npm run build)

Rappel : CLAUDE memory Rule `feedback_build_before_push` — toujours `npm run build` + `git add -f dist/` avant tout push frontend.

- [ ] **Step 1: Lancer le build**

Run: `npm run build`
Expected: exit code 0, aucune erreur de bundling.

- [ ] **Step 2: Vérifier que dist/ contient les nouveaux textes**

Run: `grep -c "Délai minimum pour étudier la demande" dist/**/*.js 2>/dev/null || grep -rc "Délai minimum pour étudier la demande" dist/`
Expected: au moins `1`.

Run: `grep -c "svcUpdateNoticeLabel" dist/**/*.js 2>/dev/null || grep -rc "svcUpdateNoticeLabel" dist/`
Expected: au moins `1`.

Si les greps retournent 0, le build n'a pas pris les changements ou le chemin n'inclut pas services.js — revérifier le contenu de `dist/` avant de commit.

- [ ] **Step 3: Force-add dist/ et commit**

```bash
git add -f dist/
git commit -m "build: regénère dist/ avec min_notice adaptatif

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

## Task 8 : Push main + trigger Render deploy

Rappel : CLAUDE memory Rule `feedback_render_deploy` — toujours trigger Render manuellement après push.

- [ ] **Step 1: Push**

Run: `git push origin main`
Expected: push OK, pas de rejet.

- [ ] **Step 2: Trigger Render deploy**

Déclencher le deploy sur Render (dashboard Render, bouton "Manual Deploy" → "Deploy latest commit" pour le service Genda/Bookt).

Attendre la fin du build/deploy. Vérifier l'état "Live" sur le dashboard Render.

- [ ] **Step 3: Smoke test endpoint public**

Run (remplacer `<base>` par l'URL de prod) :

```bash
curl -sS -o /dev/null -w "%{http_code}\n" https://<base>/api/public/health 2>/dev/null || curl -sS -o /dev/null -w "%{http_code}\n" https://<base>/
```

Expected: `200` ou `301/302` (selon redirections).

---

## Task 9 : Migration SQL sur la DB Render

**IMPORTANT:** Cette étape DOIT être jouée après le deploy backend mais AVANT les tests utilisateur. Le code backend ne fait plus de floor runtime, donc si la migration n'est pas jouée, les prestations devis existantes tomberont à 0h.

Référence connexion DB : `memory/reference_render_db.md`.

- [ ] **Step 1: Backup DB avant migration**

Sur le dashboard Render → service Postgres Genda → "Backups" → "Create Backup" (ou utiliser `pg_dump` via la connection string). Attendre confirmation du backup.

- [ ] **Step 2: Connexion psql + dry-run SELECT**

Run (connection string dans la memory) :

```bash
psql "$RENDER_DB_URL" -c "SELECT id, name, quote_only, min_booking_notice_hours FROM services WHERE quote_only = true ORDER BY name;"
```

Expected: liste des prestations devis avec leurs valeurs courantes (souvent `0`).

- [ ] **Step 3: Jouer la migration**

Run:

```bash
psql "$RENDER_DB_URL" -f schema-v70-quote-notice-migration.sql
```

Expected: sortie `UPDATE N` où `N` = nombre de lignes mises à jour (= nombre de prestations devis ayant `< 72`).

- [ ] **Step 4: Vérification post-migration**

Run:

```bash
psql "$RENDER_DB_URL" -c "SELECT COUNT(*) FROM services WHERE quote_only = true AND min_booking_notice_hours < 72;"
```

Expected: `0`.

Run:

```bash
psql "$RENDER_DB_URL" -c "SELECT name, min_booking_notice_hours FROM services WHERE quote_only = true ORDER BY name;"
```

Expected: toutes les valeurs `>= 72` (la majorité à exactement 72).

---

## Task 10 : Validation fonctionnelle (test sequence user)

Rappel : CLAUDE memory Rule `feedback_user_test_before_ok` — c'est "pushé" tant que Hakim n'a pas re-testé. Cette séquence est destinée à Hakim.

**Test 1 — Ouverture Jay-One**
- [ ] Dashboard → Prestations → ouvrir Jay-One.
- [ ] Champ délai affiche **72**.
- [ ] Label = *« Délai minimum pour étudier la demande (heures) »*.
- [ ] Hint sous le champ = *« Temps minimum entre la demande du client et le RDV, pour examiner le projet et fixer un prix. Ex. 48h, 72h, 168h. »*.

**Test 2 — Modification à 48h**
- [ ] Changer la valeur à 48, sauver.
- [ ] Fermer et rouvrir la prestation → valeur = 48.

**Test 3 — Réactivité du toggle**
- [ ] Dans le même formulaire, décocher "Sur devis" (ne pas sauver).
- [ ] Le label passe instantanément à *« Préavis minimum (heures) »*.
- [ ] Le hint passe à *« Délai minimum avant qu'un client puisse réserver en ligne »*.
- [ ] Recocher "Sur devis" → les textes devis reviennent. Annuler / ne pas sauver.

**Test 4 — Nouvelle prestation devis**
- [ ] Créer une nouvelle prestation.
- [ ] Cocher "Sur devis".
- [ ] Le label et le hint deviennent immédiatement devis.
- [ ] Le champ délai est à 0.

**Test 5 — Prestation classique intacte**
- [ ] Ouvrir une prestation non-devis existante.
- [ ] Label = *« Préavis minimum (heures) »*, hint générique.
- [ ] Rien n'a changé.

**Test 6 — Côté public : filtrage correct avec 48h**
- [ ] Sur le minisite public de Jay-One (service réglé à 48h dans Test 2), tenter une demande de devis pour un créneau dans 30h : ne doit **pas** être proposé (ou doit être refusé côté serveur si on le force).
- [ ] Créneau dans 50h : doit être proposé et acceptable.

**Test 7 — Suppression totale du plancher**
- [ ] Mettre `min_booking_notice_hours = 0` sur un service devis (Jay-One ou autre).
- [ ] Côté public : un créneau dans 1h doit être proposé. Confirme que le plancher runtime est bien retiré.

---

## Self-Review (done)

- **Spec coverage** : Migration SQL (Task 1 + 9) ✓ ; retrait plancher runtime 3 sites (Task 2, 3, 4) ✓ ; label/hint adaptatifs (Task 5) ✓ ; réactivité toggle (Task 6) ✓ ; build dist/ (Task 7) ✓ ; deploy (Task 8) ✓ ; tests fonctionnels (Task 10) couvrent les 10 points de la section "Plan de test" de la spec ✓ ; hors-scope non implémenté ✓.
- **Placeholder scan** : aucun TBD, code complet fourni à chaque step, commandes et expected output partout.
- **Type consistency** : IDs `svc_min_notice_label` / `svc_min_notice_hint` définis en Task 5 et utilisés en Task 6 — identiques. Fonction `svcUpdateNoticeLabel` référencée en Task 6 (onchange) et définie dans le même Task 6 — identique.
- **Risques notés** : ordre migration/deploy rappelé dans Task 9. Conflit de pattern identique ligne 464/914 discriminé par contexte dans Task 3.
