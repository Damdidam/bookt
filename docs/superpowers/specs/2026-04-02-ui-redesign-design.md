# UI Redesign — Design Spec

**Date:** 2026-04-02
**Statut:** Validé
**Approche:** Big bang progressif (sous-projet par sous-projet)

---

## Contexte

Le dashboard Genda souffre de plusieurs problèmes structurels :
- Vue Paramètres surchargée (~85 champs dans une seule page scrollable)
- Cartes cadeau cachées (pas dans la sidebar)
- Navigation pas optimale (Prestations dans Planning, Mon site dans Salon)
- Pas de design system formel — inline styles fréquents (~308 dans settings, ~179 dans site)
- Incohérences visuelles entre les vues (badges, tables, cards, boutons)
- Doublons : mot de passe (Paramètres + Profil), affichage GC/passes (fiche client + vues dédiées)

**Public cible :** coiffeurs et esthéticiennes — pas de personnel IT. L'interface doit être intuitive et centralisée.

---

## Décisions actées

1. **Paramètres centralisés avec 7 onglets** — pas d'éclatement vers les vues fonctionnelles
2. **Sidebar réorganisée en 4 groupes** : Planning, Salon, Finance, Admin
3. **Cartes cadeau visible** dans le groupe Finance
4. **Prestations migre** de Planning vers Salon
5. **Cal-sync reste** dans la fiche praticien (pas de section Intégrations)
6. **GC + Passes restent dans la fiche client** — contexte complet d'un client
7. **Dashboard garde tout son contenu** — pas d'allègement
8. **Double affectation praticiens ↔ services conservée** — l'affectation donne un ordre de priorité
9. **Profil accessible via avatar** en bas de sidebar (plus de lien dans Admin)
10. **Suppression du doublon mot de passe** — uniquement dans Paramètres > Compte
11. **Rôle praticien strict** — Dashboard + Agenda + Clients + Profil (on itérera si besoin)

---

## Sous-projet 1 : Design System / Fondations

### Palette de couleurs

```css
:root {
  --color-primary: #6C5CE7;
  --color-primary-hover: #5A4BD1;
  --color-primary-light: #F0EEFF;

  --color-success: #27AE60;
  --color-warning: #F39C12;
  --color-danger: #E74C3C;
  --color-info: #3498DB;

  --color-bg: #F8F9FA;
  --color-surface: #FFFFFF;
  --color-border: #E9ECEF;

  --color-text-1: #2D3436;
  --color-text-2: #636E72;
  --color-text-3: #B2BEC3;
  --color-text-4: #DFE6E9;
}
```

### Typographie

```css
:root {
  --font-family: 'DM Sans', system-ui, sans-serif;
  --font-size-xs: 0.75rem;    /* badges, labels */
  --font-size-sm: 0.875rem;   /* body, inputs */
  --font-size-md: 1rem;        /* sous-titres */
  --font-size-lg: 1.25rem;     /* titres de section */
  --font-size-xl: 1.5rem;      /* titres de page */
}
```

### Spacing

```css
:root {
  --space-1: 0.25rem;   /* 4px */
  --space-2: 0.5rem;    /* 8px */
  --space-3: 0.75rem;   /* 12px */
  --space-4: 1rem;      /* 16px */
  --space-5: 1.5rem;    /* 24px */
  --space-6: 2rem;      /* 32px */
  --space-8: 3rem;      /* 48px */
}
```

### Composants de base

- **Boutons** : `.btn-primary`, `.btn-secondary`, `.btn-outline`, `.btn-danger`, `.btn-ghost` — tailles sm/md/lg
- **Cards** : `.card` avec `.card-header`, `.card-body`, `.card-footer`
- **Badges/Tags** : `.badge-success`, `.badge-warning`, `.badge-danger`, `.badge-info`, `.badge-neutral`
- **Inputs** : `.input`, `.select`, `.textarea`, `.toggle` — style unifié
- **Tables** : `.table` avec `.table-header`, `.table-row`, `.table-cell`
- **Modals** : `.modal`, `.modal-header`, `.modal-body`, `.modal-footer` (jamais de close on outside click)
- **Tabs** : `.tabs`, `.tab-item`, `.tab-active`
- **KPI tiles** : `.kpi-card` avec `.kpi-value`, `.kpi-label`
- **Empty states** : `.empty-state` avec icône + texte + CTA

### Migration

Les inline styles seront remplacés progressivement fichier par fichier en utilisant les nouvelles classes. Pas de breaking change — on ajoute le design system, puis on migre.

---

## Sous-projet 2 : Sidebar + Layout

### Nouvelle structure sidebar

```
Logo + badge plan
─────────────────
Dashboard
─────────────────
▾ Planning
  Agenda
  Clients
  Liste d'attente
─────────────────
▾ Salon
  Équipe
  Planning
  Horaires
  Prestations
─────────────────
▾ Finance
  Facturation
  Acomptes
  Cartes cadeau
  Abonnements
  Promotions
─────────────────
▾ Admin
  Statistiques
  Avis clients
  Mon site
  Paramètres
─────────────────
Avatar + nom → Profil
```

### Changements vs aujourd'hui

| Élément | Avant | Après |
|---|---|---|
| Prestations | Groupe Planning | Groupe Salon |
| Mon site | Groupe Salon | Groupe Admin |
| Cartes cadeau | Caché | Groupe Finance |
| Profil | Lien dans Admin | Avatar footer sidebar |
| Badges compteurs | Aucun | Waitlist + Acomptes |

### RBAC

**Owner :** tout

**Praticien :** sidebar simplifiée, pas de groupes

```
Dashboard
Agenda
Clients
─────────
Avatar → Profil
```

### Comportement inchangé
- Groupes collapsibles avec persistance localStorage
- Labels dynamiques par secteur
- Dirty guard sur navigation
- Routing hash-based avec lazy import
- Mobile : sidebar en drawer

---

## Sous-projet 3 : Paramètres en onglets

### 7 onglets

| Onglet | Champs | Contenu |
|---|---|---|
| **Mon salon** | 14 | Nom, URL, email, téléphone, adresse, BCE, année, tagline, description, parking, IBAN, BIC, pied de page facture, secteur |
| **Réservation** | 16 | Chevauchements, multi-prestations, choix praticien, confirmation (toggle + délai + canal), incrément, waitlist mode, couleurs, vue défaut, optimisation, gaps, vedette |
| **Paiements** | 25 | Stripe connect, 8 méthodes, acomptes (13 champs), annulation (3), remboursement (2), abus (2), déplacement (3), modification client (4) |
| **Notifications** | 4 | Email 24h, Email 2h, SMS 24h (Pro+), SMS 2h (Pro+) |
| **Produits** | 8 | GC (activation, montants, libre + min/max, validité), Passes (activation, validité) |
| **Mon site** | 5 | URL réservation (readonly), widget (readonly), QR code, SEO titre, SEO description |
| **Compte** | 5+ | Mot de passe (actuel + nouveau + confirmation), plan & facturation, danger zone |

### Comportement
- Tabs horizontaux en haut de page
- Dernier onglet visité persisté en localStorage
- Mobile : tabs scrollables horizontalement
- Dirty guard par onglet
- Bouton save par sous-section (pas de save global par onglet)

---

## Sous-projet 4 : Vues financières

### Cartes cadeau — ajout dans la sidebar
La vue existe déjà (`gift-cards.js`). On l'ajoute dans le groupe Finance et on applique le design system.

### Ordre dans la sidebar
1. Facturation (quotidien)
2. Acomptes (fréquent)
3. Cartes cadeau (régulier)
4. Abonnements (régulier)
5. Promotions (occasionnel)

### Pattern commun aux 5 vues financières

```
┌──────────────────────────────────┐
│  KPI cards (3-4 tiles en ligne)  │
├──────────────────────────────────┤
│  Filtres  |  Recherche  |  + Créer │
├──────────────────────────────────┤
│  Table                           │
├──────────────────────────────────┤
│  Pagination / info               │
└──────────────────────────────────┘
```

### Badges statut unifiés

| Statut | Couleur | Utilisé dans |
|---|---|---|
| active / paid / confirmed | `--color-success` vert | Toutes |
| pending / sent / waiting | `--color-warning` jaune | Factures, Acomptes, Waitlist |
| used / completed | `--color-text-2` gris | GC, Passes |
| expired | `--color-warning` jaune | GC, Passes |
| cancelled / refunded | `--color-danger` rouge | Toutes |
| draft | `--color-text-3` gris clair | Factures |

### Pas de changement fonctionnel
- Modals de création/édition inchangés
- Actions (débit, remboursement, annulation) identiques
- Export CSV des acomptes maintenu
- Logique métier inchangée

---

## Sous-projet 5 : Autres vues — application du design system

### Par vue

| Vue | Niveau de changement |
|---|---|
| Dashboard | CSS uniquement — `.kpi-card`, `.card` sur toutes les sections |
| Agenda | CSS modals uniquement — le calendrier reste intact |
| Clients | CSS + suppression doublon MDP |
| Équipe | CSS uniquement — `.card` grille, standardiser tabs modal |
| Planning | CSS uniquement — badges, grille, modal absence |
| Horaires | CSS uniquement — `.card` sur 4 sections |
| Prestations | CSS + déplacement sidebar vers Salon |
| Waitlist | CSS uniquement — même pattern que vues financières |
| Avis | CSS uniquement — `.card` sur reviews |
| Mon site | CSS + déplacement sidebar vers Admin |
| Stats | CSS uniquement — `.card` containers, pills période |
| Profil | CSS + suppression section mot de passe |

### Aucune refonte fonctionnelle
On modernise le visuel et on réorganise la navigation. La logique métier, les formulaires, les actions restent identiques.

---

## Hors scope

- Refonte du calendrier/agenda (trop risqué, cœur de l'app)
- Nouvelles fonctionnalités (pas de feature creep)
- Refonte backend/API
- Dark mode
- Changement de stack (on reste vanilla JS)
