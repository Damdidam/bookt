# Refonte Landing Page genda.be

**Date:** 2026-03-22
**Scope:** Refonte contenu + structure de `/public/index.html`. Même stack (HTML/CSS inline, vanilla JS). Garde le design system existant (CSS variables, animations `rv`, fonts DM Serif + Outfit).

## Objectif

Positionnement + conversion. Montrer que Genda n'est pas "un Calendly de plus" mais un outil dédié aux salons de beauté avec un moteur intelligent. Ton chaleureux/humain.

## Cible

Primaire : salons de coiffure / esthétique (équipes 2-10). Secondaire : praticiens indépendants.

## Structure de la page

### 1. Navigation (inchangée)
Liens : Le moteur · Fonctionnalités · Tarifs · FAQ · Se connecter · **Essai gratuit**

### 2. Hero

**Badge :** "Nouveau : créneaux vedettes & horaires à la carte"
**Headline :** "Concentrez-vous sur vos clients, on s'occupe du reste."
**Sous-titre :** "Genda est l'outil de gestion de rendez-vous pensé pour les salons de coiffure, instituts de beauté et praticiens indépendants. Booking en ligne, agenda intelligent, rappels automatiques — tout est intégré."
**CTA :** "Essayer gratuitement" (primary) + "Voir comment ça marche" (outline, scroll #engine)
**Proof points :**
- Aucun compte client requis
- Multi-praticien par RDV
- Rappels email & SMS

**Visual :** Garder le mockup calendrier existant (il est excellent) — mettre à jour les noms/prestations si besoin.

### 3. Pain points — "Ça vous parle ?"

5 blocs icône + titre + 1 ligne. Grid 5 colonnes desktop, scroll horizontal mobile.

1. **"Vos clients appellent pour réserver, changer ou annuler"** — Vous perdez du temps au téléphone au lieu de travailler.
2. **"Des trous dans votre agenda"** — Des créneaux vides que personne ne réserve entre deux rendez-vous.
3. **"Les no-shows vous coûtent cher"** — Des clients qui ne viennent pas, sans prévenir.
4. **"Vos horaires changent d'une semaine à l'autre"** — Impératifs familiaux, temps partiel, freelances... difficile de tenir un planning fixe.
5. **"Un rendez-vous, trois prestations, deux praticiens"** — Votre cliente veut couleur + coupe + soin, et c'est vous qui coordonnez les agendas à la main.

### 4. Section moteur (existante, à garder)

Les 4 cartes existantes (pose optimization, multi-praticien, gap analyzer, contexte réel) sont excellentes. **Garder tel quel** — c'est le coeur du positionnement technique.

### 5. Stats bar (à mettre à jour)

- +30% de créneaux récupérés grâce aux temps de pose
- -60% de no-shows avec rappels & acomptes
- 0 conflit de planning grâce au moteur
- 24/7 réservation en ligne, 0 appel à gérer

### 6. Features — 8 blocs bento

Layout bento grid (comme l'actuel). Chaque bloc : icône + titre + 2-3 lignes + pills.

**Bloc 1 (span2) : Réservation en ligne 24/7, sans compte client**
Vos clients réservent en 30 secondes depuis votre minisite. Pas de création de compte, pas de mot de passe. Ils choisissent le service, le praticien, le créneau — et peuvent modifier ou annuler eux-mêmes sans appeler.
Pills : Sans inscription · Replanification client · Confirmation auto · Mobile-first

**Bloc 2 : Agenda intelligent & promotions last-minute**
Le moteur optimise chaque créneau et détecte les trous. Créneau vide pour aujourd'hui ? Proposez-le à prix réduit automatiquement pour encourager les réservations de dernière minute.
Pills : Gap analyzer · Promos auto · Smart ranking

**Bloc 3 : Rappels & acomptes intelligents**
Vos clients reçoivent un rappel par email ou SMS avant leur rendez-vous. Pour les créneaux à risque, configurez des acomptes sur mesure : par prix, durée, ou profil client. Les récidivistes de no-show paient d'office, vos VIP en sont exemptés.
Pills : Email + SMS · Acompte Stripe · Seuil prix/durée · No-show récidiviste · VIP exempt

**Bloc 4 : Horaires à la carte**
Chaque praticien choisit ses disponibilités semaine par semaine, directement sur le calendrier. Idéal pour les freelances, les temps partiels, ou quand la vie impose ses propres horaires.
Pills : Mode vedette · Multi-semaine · Par praticien

**Bloc 5 : Multi-service en un clic**
Le client réserve couleur + coupe + soin en une seule réservation. Le système détecte quels praticiens sont nécessaires, les assigne automatiquement, et enchaîne les créneaux sans chevauchement.
Pills : Jusqu'à 5 prestations · Split auto · Variantes

**Bloc 6 : Cartes cadeau, abonnements & fidélité**
Vendez des cartes cadeau en quelques clics — solde, historique, expiration, tout est suivi. Vos clients réguliers prennent un abonnement avec solde de séances décrémenté automatiquement à chaque rendez-vous.
Pills : Code unique · Solde partiel · Abonnements · Fidélité
Note : tag "Bientôt" sur abonnements si pas encore développé

**Bloc 7 : Votre site web inclus**
Un mini-site professionnel prêt en 5 minutes. Galerie, avis clients, équipe, horaires et bouton de réservation. 3 familles de thèmes. Votre domaine personnalisé si vous le souhaitez.
Pills : 3 thèmes · Galerie · Avis clients · SEO · Domaine custom

**Bloc 8 : Planning d'équipe & analytics**
Visualisez congés, absences et disponibilités sur un planning centralisé. Suivez votre CA, taux de no-show, remplissage par praticien et conversion appels → réservations avec des tableaux de bord clairs.
Pills : Planning visuel · KPIs · Heatmap · Conversion appels

### 7. Section positionnement — "Ce qu'on n'est PAS"

Fond contrasté (dark ou surface-warm). Ton direct.

> **Genda n'est pas une marketplace.**
>
> Pas de commission sur vos réservations. Pas d'annuaire où vos clients comparent vos prix avec le salon d'en face. Pas de concurrence organisée entre nos propres clients.
>
> Genda est **votre** outil. Dédié à 100% à votre salon, votre équipe, votre croissance.

3 icônes en dessous :
- 🚫 commission → "0% de commission, jamais"
- 🚫 annuaire → "Pas de marketplace"
- ✅ dédié → "100% dédié à votre salon"

### 8. Feature blocks détaillés (existants, à mettre à jour)

Garder les 2 blocs existants (booking détaillé + dashboard) mais mettre à jour le contenu :

**Bloc booking :** Ajouter mention rappels email+SMS, replanification par le client, pas de compte requis.

**Bloc dashboard :** Ajouter mention analytics avancés, promotions last-minute.

### 9. Steps "Comment ça marche" (garder tel quel)

Les 4 étapes actuelles sont claires et concises.

### 10. Pricing (garder tel quel)

3 tiers : Gratuit (0€) / Pro (39€) / Premium (79€). Contenu inchangé pour l'instant.

### 11. FAQ (à compléter)

Garder les 7 questions existantes. Ajouter :
- "Est-ce que mes clients doivent télécharger une app ?" → Non, tout fonctionne dans le navigateur.
- "Mes clients peuvent modifier leur RDV eux-mêmes ?" → Oui, via le lien dans l'email de confirmation.
- "Comment fonctionnent les rappels ?" → Email automatique + SMS optionnel (plan Pro+). Configurable.
- "C'est quoi les créneaux vedettes ?" → Un praticien peut choisir ses dispos semaine par semaine. Seuls ces créneaux sont proposés aux clients. Idéal pour les freelances ou les horaires variables.

### 12. CTA final

**Headline :** "Concentrez-vous sur vos clients. On s'occupe de l'agenda."
**Sous-titre :** "Rejoignez Genda. Gratuit, sans engagement."
**CTA :** "Créer mon salon gratuitement"

### 13. Footer (à mettre à jour)

Tagline : "L'outil de gestion de rendez-vous dédié aux professionnels de la beauté et du bien-être. Pas de marketplace, pas de commission — juste votre salon."

## Sections supprimées de l'actuel

- **Sectors tags** ("Coiffure", "Esthétique"...) : garder mais déplacer après le hero, avant les pain points
- **Feature blocks "Réservation intelligente" et "Dashboard"** : garder, mettre à jour le contenu

## Ce qui NE change PAS

- Design system (CSS variables, fonts, couleurs)
- Animations (fade-up, rv/vis)
- Layout responsive existant
- Pricing structure
- Logo et nav
- Mockups visuels (calendrier hero, phone, dashboard mini)

## Périmètre exclus

- Pas de nouvelles pages (reste single-page)
- Pas de changement backend
- Pas de refonte du design system
- Pas de vidéo/animation complexe
- Facturation belge retirée des features principales (Peppol pas supporté)
- Documents pré-RDV retirés (plus lié à l'activité)
