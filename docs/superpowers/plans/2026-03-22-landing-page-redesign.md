# Landing Page Redesign — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refonte du contenu de la landing page genda.be pour mettre en avant les killer features et le positionnement anti-marketplace.

**Architecture:** Single-file rewrite de `/public/index.html`. Garde le design system existant (CSS variables, animations, fonts). Remplace le contenu section par section. Ajoute la section pain points et la section positionnement anti-marketplace.

**Tech Stack:** HTML/CSS inline, vanilla JS (animations IntersectionObserver existantes).

**Spec:** `docs/superpowers/specs/2026-03-22-landing-page-redesign.md`

---

## File Structure

| File | Action | Responsibility |
|------|--------|----------------|
| `public/index.html` | Modify | Toute la landing page (HTML + CSS inline + JS) |

Fichier unique. Pas de nouveau fichier.

---

## Task 1: Hero — nouveau messaging

**Files:**
- Modify: `public/index.html:433-493` (section hero)

- [ ] **Step 1: Remplacer le badge, headline, sous-titre et proof points**

Remplacer le contenu du hero (lignes 433-493). Le layout HTML reste identique (grid 2 colonnes, hero-text + hero-visual). Seul le texte change.

Badge : "Nouveau : créneaux vedettes & horaires à la carte" (remplace "Moteur de planning nouvelle génération")

Headline : "Concentrez-vous sur vos clients,<br><span class="accent">on s'occupe du reste.</span>" (remplace "Chaque minute<br>compte.")

Sous-titre : "Genda est l'outil de gestion de rendez-vous pensé pour les salons de coiffure, instituts de beauté et praticiens indépendants. Booking en ligne, agenda intelligent, rappels automatiques — tout est intégré."

CTA : "Essayer gratuitement" (primary) + "Voir comment ça marche" (outline, href="#engine")

Proof points :
- Aucun compte client requis
- Multi-praticien par RDV
- Rappels email & SMS

Le hero-visual (mockup calendrier) reste inchangé.

- [ ] **Step 2: Corriger les typos existantes dans le hero-visual**

Ligne 438 (hero-sub) et 563 : "assigné automatiquement" → "assigne automatiquement"

- [ ] **Step 3: Vérifier visuellement — ouvrir index.html dans le navigateur**

- [ ] **Step 4: Commit**

```bash
git add public/index.html
git commit -m "content(landing): new hero messaging — warm tone, killer features focus"
```

---

## Task 2: Section pain points — nouvelle section

**Files:**
- Modify: `public/index.html` — insérer après la section sectors (ligne ~511), avant engine-section

- [ ] **Step 1: Ajouter le CSS pour la section pain points**

Dans le bloc `<style>`, ajouter les styles pour `.pain-section`, `.pain-grid`, `.pain-card`. Grid 5 colonnes desktop, scroll horizontal mobile. Chaque card : icône + titre bold + 1 ligne de description. Fond `var(--surface-warm)`, border radius, padding.

```css
/* Pain points */
.pain-section{padding:64px 24px;max-width:var(--max-w);margin:0 auto;}
.pain-header{text-align:center;margin-bottom:40px;}
.pain-grid{display:grid;grid-template-columns:repeat(5,1fr);gap:16px;}
.pain-card{background:var(--white);border:1px solid var(--border-light);border-radius:var(--radius-sm);padding:24px 20px;text-align:center;}
.pain-card .pain-ico{width:40px;height:40px;margin:0 auto 12px;border-radius:10px;display:flex;align-items:center;justify-content:center;}
.pain-card .pain-ico svg{width:20px;height:20px;stroke-width:2;fill:none;stroke:currentColor;stroke-linecap:round;stroke-linejoin:round;}
.pain-card .pain-ico.red{background:var(--red-bg);color:var(--red);}
.pain-card .pain-ico.gold{background:var(--gold-bg);color:var(--gold);}
.pain-card .pain-ico.purple{background:var(--purple-bg);color:var(--purple);}
.pain-card .pain-ico.teal{background:var(--teal-bg);color:var(--teal);}
.pain-card .pain-ico.coral{background:var(--coral-light);color:var(--coral);}
.pain-card h4{font-size:.88rem;font-weight:600;margin-bottom:6px;line-height:1.3;}
.pain-card p{font-size:.78rem;color:var(--text-3);line-height:1.5;}
@media(max-width:900px){.pain-grid{grid-template-columns:repeat(3,1fr);}}
@media(max-width:600px){.pain-grid{grid-template-columns:1fr 1fr;gap:10px;}.pain-card{padding:18px 14px;}}
```

- [ ] **Step 2: Ajouter le HTML de la section pain points**

Insérer après `</div><!-- end sectors -->` et avant `<!-- ENGINE SHOWCASE -->` :

```html
<!-- PAIN POINTS -->
<section class="pain-section">
  <div class="pain-header rv">
    <div class="s-label">Ça vous parle ?</div>
    <div class="s-title">Les problèmes que Genda résout</div>
  </div>
  <div class="pain-grid">
    <div class="pain-card rv d1">
      <div class="pain-ico red"><svg viewBox="0 0 24 24"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"/></svg></div>
      <h4>Vos clients appellent pour réserver, changer ou annuler</h4>
      <p>Vous perdez du temps au téléphone au lieu de travailler.</p>
    </div>
    <div class="pain-card rv d2">
      <div class="pain-ico gold"><svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg></div>
      <h4>Des trous dans votre agenda</h4>
      <p>Des créneaux vides que personne ne réserve entre deux rendez-vous.</p>
    </div>
    <div class="pain-card rv d3">
      <div class="pain-ico red"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg></div>
      <h4>Les no-shows vous coûtent cher</h4>
      <p>Des clients qui ne viennent pas, sans prévenir.</p>
    </div>
    <div class="pain-card rv d4">
      <div class="pain-ico purple"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg></div>
      <h4>Vos horaires changent d'une semaine à l'autre</h4>
      <p>Impératifs familiaux, temps partiel, freelances... difficile de tenir un planning fixe.</p>
    </div>
    <div class="pain-card rv d5">
      <div class="pain-ico coral"><svg viewBox="0 0 24 24"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg></div>
      <h4>Un rendez-vous, trois prestations, deux praticiens</h4>
      <p>C'est vous qui coordonnez les agendas à la main.</p>
    </div>
  </div>
</section>
```

- [ ] **Step 3: Commit**

```bash
git add public/index.html
git commit -m "content(landing): add pain points section"
```

---

## Task 3: Section features bento — remplacer le contenu

**Files:**
- Modify: `public/index.html:636-752` (section #features, bento grid)

- [ ] **Step 1: Remplacer le header de la section features**

```html
<div class="s-center rv">
  <div class="s-label">Tout-en-un</div>
  <div class="s-title">Tout ce dont votre salon a besoin</div>
  <p class="s-desc">Booking en ligne, rappels, acomptes, cartes cadeau, minisite, analytics. Tout est intégré, rien à bricoler.</p>
</div>
```

- [ ] **Step 2: Remplacer les 11 bento cards par les 8 nouveaux blocs**

Garder le même markup pattern (`.bento-card`, `.bento-ico`, `h3`, `p`, `.bento-pills`). Remplacer le contenu des cards avec les 8 blocs de la spec :

1. **(span2) Réservation en ligne 24/7, sans compte client** — icône teal (check circle)
2. **Agenda intelligent & promotions last-minute** — icône gold (calendar)
3. **Rappels & acomptes intelligents** — icône green (bell + dollar)
4. **Horaires à la carte** — icône purple (clock)
5. **Multi-service en un clic** — icône coral (users)
6. **Cartes cadeau, abonnements & fidélité** — icône gold (gift) — tag "Bientôt" sur abonnements
7. **Votre site web inclus** — icône coral (globe)
8. **(span2) Planning d'équipe & analytics** — icône red (bar chart) + icône purple (team)

Textes exacts : voir spec section 6.

- [ ] **Step 3: Commit**

```bash
git add public/index.html
git commit -m "content(landing): replace bento features with 8 killer feature blocks"
```

---

## Task 4: Section positionnement anti-marketplace

**Files:**
- Modify: `public/index.html` — insérer après la section bento features, avant feat-section

- [ ] **Step 1: Ajouter le CSS**

```css
/* Anti-marketplace positioning */
.anti-mp{padding:80px 24px;background:var(--text);color:var(--white);text-align:center;}
.anti-mp-inner{max-width:720px;margin:0 auto;}
.anti-mp h2{font-family:var(--serif);font-size:2rem;margin-bottom:16px;}
.anti-mp .anti-mp-desc{font-size:1rem;color:rgba(255,255,255,.75);line-height:1.7;margin-bottom:40px;}
.anti-mp .anti-mp-desc strong{color:var(--white);}
.anti-mp-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:24px;max-width:600px;margin:0 auto;}
.anti-mp-item{text-align:center;}
.anti-mp-item .ami-ico{width:48px;height:48px;border-radius:12px;margin:0 auto 10px;display:flex;align-items:center;justify-content:center;font-size:1.4rem;}
.ami-ico.no{background:rgba(220,68,68,.15);color:#F87171;}
.ami-ico.yes{background:rgba(58,158,92,.15);color:#4ADE80;}
.anti-mp-item span{font-size:.82rem;font-weight:600;color:rgba(255,255,255,.9);}
@media(max-width:600px){.anti-mp h2{font-size:1.5rem;}.anti-mp-grid{grid-template-columns:1fr;gap:16px;}}
```

- [ ] **Step 2: Ajouter le HTML**

Insérer après `</section><!-- end #features -->` et avant `<!-- FEATURE BLOCKS -->` :

```html
<!-- ANTI-MARKETPLACE POSITIONING -->
<section class="anti-mp rv">
  <div class="anti-mp-inner">
    <h2>Genda n'est pas une marketplace.</h2>
    <p class="anti-mp-desc">Pas de commission sur vos réservations. Pas d'annuaire où vos clients comparent vos prix avec le salon d'en face. Pas de concurrence organisée entre nos propres clients.<br><br>Genda est <strong>votre</strong> outil. Dédié à 100% à votre salon, votre équipe, votre croissance.</p>
    <div class="anti-mp-grid">
      <div class="anti-mp-item rv d1"><div class="ami-ico no">✕</div><span>0% de commission, jamais</span></div>
      <div class="anti-mp-item rv d2"><div class="ami-ico no">✕</div><span>Pas de marketplace</span></div>
      <div class="anti-mp-item rv d3"><div class="ami-ico yes">✓</div><span>100% dédié à votre salon</span></div>
    </div>
  </div>
</section>
```

- [ ] **Step 3: Commit**

```bash
git add public/index.html
git commit -m "content(landing): add anti-marketplace positioning section"
```

---

## Task 5: Feature blocks détaillés — mettre à jour

**Files:**
- Modify: `public/index.html:756-820` (feat-section)

- [ ] **Step 1: Mettre à jour le bloc booking**

Dans le premier `feat-block`, mettre à jour la liste :
- Ajouter : "Aucun compte client requis — nom, email, c'est réservé"
- Ajouter : "Replanification par le client via lien email"
- Ajouter : "Rappels email + SMS automatiques"
- Garder : Multi-services, split auto, temps de pose

- [ ] **Step 2: Mettre à jour le bloc dashboard**

Dans le deuxième `feat-block reverse`, mettre à jour :
- Ajouter mention promotions last-minute
- Ajouter mention analytics avancés (CA, panier moyen, heatmap)
- Mettre à jour les KPI mockup si pertinent

- [ ] **Step 3: Corriger typo ligne 612 "Conges" → "Congés"**

- [ ] **Step 4: Commit**

```bash
git add public/index.html
git commit -m "content(landing): update feature blocks with new messaging"
```

---

## Task 6: FAQ — ajouter 4 nouvelles questions

**Files:**
- Modify: `public/index.html:882-893` (section #faq)

- [ ] **Step 1: Ajouter les 4 nouvelles questions après les 7 existantes**

```html
<div class="faq-item"><div class="faq-q" onclick="this.parentElement.classList.toggle('open')">Est-ce que mes clients doivent télécharger une app ? <span class="arr"><svg viewBox="0 0 24 24"><polyline points="6 9 12 15 18 9"/></svg></span></div><div class="faq-a">Non. Tout fonctionne directement dans le navigateur, sur mobile comme sur ordinateur. Aucune application à installer, ni pour vous, ni pour vos clients.</div></div>
<div class="faq-item"><div class="faq-q" onclick="this.parentElement.classList.toggle('open')">Mes clients peuvent modifier leur rendez-vous eux-mêmes ? <span class="arr"><svg viewBox="0 0 24 24"><polyline points="6 9 12 15 18 9"/></svg></span></div><div class="faq-a">Oui. Chaque confirmation contient un lien qui permet au client de modifier la date, l'heure ou d'annuler son rendez-vous. Vous n'avez plus besoin de gérer ça par téléphone.</div></div>
<div class="faq-item"><div class="faq-q" onclick="this.parentElement.classList.toggle('open')">Comment fonctionnent les rappels ? <span class="arr"><svg viewBox="0 0 24 24"><polyline points="6 9 12 15 18 9"/></svg></span></div><div class="faq-a">Un email de rappel est envoyé automatiquement avant chaque rendez-vous. Avec le plan Pro, vos clients reçoivent aussi un SMS. Le timing est configurable.</div></div>
<div class="faq-item"><div class="faq-q" onclick="this.parentElement.classList.toggle('open')">C'est quoi les créneaux vedettes ? <span class="arr"><svg viewBox="0 0 24 24"><polyline points="6 9 12 15 18 9"/></svg></span></div><div class="faq-a">Un praticien peut choisir ses disponibilités semaine par semaine, directement sur le calendrier. Seuls ces créneaux sont proposés aux clients en ligne. Idéal pour les freelances ou les horaires variables.</div></div>
```

- [ ] **Step 2: Commit**

```bash
git add public/index.html
git commit -m "content(landing): add 4 new FAQ entries"
```

---

## Task 7: CTA final + footer — mettre à jour

**Files:**
- Modify: `public/index.html:896-912` (final-cta + footer)

- [ ] **Step 1: Remplacer le CTA final**

```html
<div class="final-cta rv">
  <h2>Concentrez-vous sur vos clients. On s'occupe de l'agenda.</h2>
  <p>Rejoignez Genda. Gratuit, sans engagement.</p>
  <a class="btn-white" href="/signup.html">Créer mon salon gratuitement</a>
</div>
```

- [ ] **Step 2: Mettre à jour le footer tagline**

Remplacer le `f-tagline` :
"L'outil de gestion de rendez-vous dédié aux professionnels de la beauté et du bien-être. Pas de marketplace, pas de commission — juste votre salon."

- [ ] **Step 3: Commit**

```bash
git add public/index.html
git commit -m "content(landing): update CTA final and footer tagline"
```

---

## Task 8: Vérification visuelle + push

- [ ] **Step 1: Ouvrir index.html et vérifier chaque section**

Checklist visuelle :
1. Hero — nouveau texte, proof points, CTA
2. Sectors — toujours visible après hero
3. Pain points — 5 cards, responsive
4. Engine — 4 cards inchangées
5. Stats bar — chiffres corrects
6. Features bento — 8 blocs, pas 11
7. Anti-marketplace — section dark, 3 icônes
8. Feature blocks — textes mis à jour
9. Steps — inchangé
10. Pricing — inchangé
11. FAQ — 11 questions (7 + 4)
12. CTA final — nouveau texte
13. Footer — nouvelle tagline

- [ ] **Step 2: Vérifier responsive mobile (< 600px)**

- [ ] **Step 3: Commit final si corrections nécessaires**

- [ ] **Step 4: Push**

```bash
git push origin main
```
