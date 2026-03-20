# Bookt — Guide des Flows de Reservation

> Documentation complete des parcours client et regles metier pour les salons utilisant Bookt.

---

## Table des matieres

1. [Reservation en ligne](#1-reservation-en-ligne)
2. [Confirmation de rendez-vous](#2-confirmation-de-rendez-vous)
3. [Acompte (Depot)](#3-acompte)
4. [Annulation](#4-annulation)
5. [Report (Reschedule)](#5-report)
6. [Liste d'attente](#6-liste-dattente)
7. [Rappels automatiques](#7-rappels-automatiques)
8. [Avis client](#8-avis-client)
9. [Page "Gerer mon RDV"](#9-page-gerer-mon-rdv)
10. [Promo derniere minute](#10-promo-derniere-minute)
11. [Cartes cadeaux et acomptes](#11-cartes-cadeaux-et-acomptes)
12. [Etats d'un rendez-vous](#12-etats-dun-rendez-vous)
13. [Parametres configurables](#13-parametres-configurables)

---

## 1. Reservation en ligne

### Parcours client

1. Le client visite le minisite du salon (`genda.be/slug`)
2. Il choisit une ou plusieurs prestations
3. Il choisit un(e) praticien(ne) (ou laisse le systeme attribuer)
4. Il selectionne un creneau disponible parmi les propositions
5. Il renseigne ses coordonnees (email obligatoire, telephone optionnel)
6. Il confirme sa reservation

### Mono-prestation vs Multi-prestations

| | Mono-prestation | Multi-prestations |
|---|---|---|
| Nombre de RDV crees | 1 | 1 par prestation, lies par un `group_id` |
| Enchainement | — | Les prestations sont enchainees sans interruption |
| Tampons (buffers) | Avant + apres | Tampon avant uniquement sur la 1ere, tampon apres uniquement sur la derniere |
| Acompte | Calcule sur le prix/duree du service | Calcule sur le total de toutes les prestations |
| Annulation | 1 RDV annule | Tous les RDV du groupe annules ensemble |

### Informations demandees

- Prestation(s) et variante(s)
- Praticien(ne)
- Date et heure
- Mode (cabinet, visio, telephone, domicile)
- Email (obligatoire, valide)
- Telephone (optionnel, pour les SMS de rappel)
- Commentaire (max 5000 caracteres)

---

## 2. Confirmation de rendez-vous

### Deux modes

| Mode | Comportement |
|---|---|
| **Confirmation automatique** | Le RDV passe directement en `confirmed`. Le client recoit un email de confirmation. |
| **Confirmation requise** (defaut) | Le RDV est cree en `pending`. Le client recoit un email avec un bouton "Confirmer". |

### Delai de confirmation

- **Timeout** : configurable (defaut **30 minutes**)
- Si le client ne confirme pas dans le delai, le RDV est **automatiquement annule**
- Le creneau redevient disponible

### Emails envoyes

- **Confirmation automatique** : "Confirmation de votre RDV"
- **Confirmation requise** : "Confirmez votre RDV" avec bouton d'action
- **Acompte requis** : le paiement de l'acompte vaut confirmation (pas d'email de confirmation separe)

---

## 3. Acompte

### Quand un acompte est-il demande ?

L'acompte est declenche si **au moins une** de ces conditions est remplie :

| Condition | Detail |
|---|---|
| **Seuil de prix** | Le prix total >= seuil configure (ex: 100 EUR) |
| **Seuil de duree** | La duree totale >= seuil configure (ex: 60 min) |
| **Recidive no-show** | Le client a cumule >= X no-shows (defaut: 2) |

**Mode de seuil** : `any` (l'un OU l'autre suffit) ou `both` (les deux doivent etre atteints).

### Exemptions

- **Clients VIP** : jamais d'acompte demande
- **RDV dans moins de 2h** : l'acompte est saute (pas le temps de payer)

### Montant de l'acompte

| Type | Calcul |
|---|---|
| **Fixe** | Montant fixe (ex: 25 EUR) |
| **Pourcentage** | % du prix total des prestations (ex: 25%) |

### Deadline de paiement (adaptative)

La deadline s'adapte automatiquement selon le delai avant le RDV :

| Situation | Deadline |
|---|---|
| RDV dans plus de `deadline_hours` (ex: 24h) | `start_at - deadline_hours` (cas normal) |
| RDV dans moins de `deadline_hours` mais plus de 2h | `start_at - 2h` (deadline raccourcie) |
| RDV dans moins de 2h | Pas d'acompte (skip) |

**Exemple** : Un client reserve a 22h pour un RDV a 9h le lendemain. Deadline configuree = 24h.
- Ancienne logique : pas d'acompte (11h < 24h)
- Nouvelle logique : acompte exige, deadline a 7h (RDV - 2h)

### Si l'acompte n'est pas paye a temps

1. Le RDV est automatiquement annule
2. Le client recoit un email d'annulation
3. Un "strike" est ajoute au profil client
4. Le creneau redevient disponible (+ traitement liste d'attente)

### Modes de paiement

1. **Carte bancaire** (via Stripe Checkout)
2. **Carte cadeau** (debit automatique si le solde couvre l'acompte)
3. **Carte cadeau + Carte bancaire** (debit partiel de la carte cadeau, reste via Stripe)

---

## 4. Annulation

### Annulation par le client

Le client peut annuler depuis la page "Gerer mon RDV" (`/booking/:token`).

| Condition | Regle |
|---|---|
| **Delai de grace** | Annulation possible jusqu'a `cancel_deadline_hours` avant le RDV (defaut: 24h) |
| **Apres le delai** | Le bouton d'annulation disparait. Le client doit contacter le salon. |
| **Motif** | Optionnel, max 1000 caracteres |

### Remboursement de l'acompte

| Moment de l'annulation | Remboursement |
|---|---|
| Dans le delai de grace | Remboursement automatique via Stripe |
| Hors delai de grace | Pas de remboursement. Le client est prevenu par un bandeau. |

### Annulation par le staff

Le staff peut annuler a tout moment depuis le dashboard, avec ou sans remboursement de l'acompte.

### Multi-prestations

Quand un RDV du groupe est annule, **tous les RDV du groupe sont annules ensemble**.

---

## 5. Report

### Report par le client

Le client peut reporter son RDV depuis la page "Gerer mon RDV".

| Parametre | Defaut |
|---|---|
| **Nombre de reports autorises** | 1 par RDV |
| **Fenetre de report** | 30 jours a l'avance |

### Parcours

1. Le client clique "Modifier la date"
2. Les creneaux disponibles s'affichent (memes regles que la reservation initiale)
3. Il choisit un nouveau creneau
4. Confirmation avec affichage ancien/nouveau creneau
5. Email de confirmation du report envoye

### Impact sur l'acompte

L'acompte deja paye reste valable. Il n'est pas re-demande.

### Modification par le staff

1. Le staff modifie l'heure depuis le dashboard
2. Le RDV passe en `modified_pending`
3. Le client recoit un email avec les boutons "Accepter" / "Refuser"
4. Sans reponse dans le delai (defaut 24h) : la modification est **auto-acceptee**

---

## 6. Liste d'attente

### Modes

| Mode | Comportement |
|---|---|
| **Off** | Desactivee |
| **Manuel** | Le staff voit les correspondances et propose manuellement |
| **Auto** | Le systeme propose automatiquement les creneaux liberes |

### Parcours automatique

1. Un RDV est annule, un creneau se libere
2. Le systeme cherche les inscrits correspondants (prestation, praticien, jour, moment)
3. Le 1er match recoit une offre par email
4. Il a **2 heures** pour accepter ou decliner
5. S'il decline ou ne repond pas : le suivant dans la file est contacte
6. S'il accepte : un nouveau RDV est cree (memes regles d'acompte)

### Conditions

- Le creneau doit etre dans plus de 2h (sinon trop tard pour proposer)
- Une seule offre active a la fois par creneau

---

## 7. Rappels automatiques

### Rappel 24h avant

| Canal | Disponibilite |
|---|---|
| **Email** | Tous les plans (actif par defaut) |
| **SMS** | Plans Pro/Premium uniquement (si active + consentement client) |

Contenu : date, heure, prestation(s), praticien(ne), adresse + bouton "Gerer mon RDV"

### Rappel 2h avant

| Canal | Disponibilite |
|---|---|
| **SMS** | Plans Pro/Premium (canal principal a 2h) |
| **Email** | Optionnel (rarement active) |

### Multi-prestations

Tous les RDV du groupe sont traites en un seul envoi (pas de spam).

---

## 8. Avis client

### Demande d'avis

- Declenchee quand le RDV passe en `completed`
- Email envoye au client avec 5 etoiles cliquables
- Chaque etoile est un lien direct qui pre-remplit la note

### Depot d'avis

- Le client clique sur une etoile, arrive sur la page d'avis
- Il peut ajouter un commentaire (max 500 caracteres)
- L'avis est publie (ou mis en brouillon selon le reglage)

### Gestion par le salon

- Le salon peut **repondre** a un avis (max 500 caracteres)
- Le salon peut **signaler** ou **masquer** un avis abusif
- Seuls les avis `published` apparaissent sur le minisite public

---

## 9. Page "Gerer mon RDV"

Accessible via le lien `/booking/:token` present dans **tous** les emails.

### Actions disponibles selon le statut

| Statut | Actions possibles |
|---|---|
| `confirmed` | Voir details, modifier la date, annuler, ajouter au calendrier |
| `pending_deposit` | Voir details, payer l'acompte, annuler |
| `pending` | Voir details, confirmer |
| `modified_pending` | Accepter/refuser la modification proposee par le staff |
| `cancelled` | Voir le message d'annulation, lien pour reprendre un RDV |
| `completed` | Message de remerciement |
| `no_show` | Message informatif |

### Informations affichees

- Date et heure du RDV
- Prestation(s) et praticien(ne)
- Adresse du salon (avec lien Google Maps)
- Statut du RDV (badge colore)
- Informations de contact du salon
- Boutons "Ajouter au calendrier" (Google, Outlook, Apple)

---

## 10. Promo derniere minute

### Principe

Les prestations eligibles beneficient d'une reduction automatique quand le client reserve proche de la date.

### Parametres

| Parametre | Valeurs possibles |
|---|---|
| **Fenetre** | `j-2` (2 jours avant), `j-1` (veille), `same_day` (jour meme) |
| **Reduction** | Pourcentage (ex: 10%) |
| **Prix minimum** | La promo ne s'applique pas en dessous d'un certain prix |
| **Eligibilite** | Par prestation (certaines peuvent etre exclues) |

### Affichage

Le prix barre s'affiche avec le nouveau prix a cote (ex: ~~50 EUR~~ 45 EUR).

---

## 11. Cartes cadeaux et acomptes

### Debit automatique

Lors de la creation d'un RDV avec acompte, le systeme cherche automatiquement une carte cadeau :
1. Par code saisi manuellement par le client
2. Par email du client (correspondance automatique)

### Couverture

| Cas | Resultat |
|---|---|
| Solde carte >= acompte | Acompte paye integralement par carte cadeau. Pas de Stripe. |
| Solde carte < acompte | Carte debitee du maximum, le reste a payer via Stripe. |
| Pas de carte | Acompte complet via Stripe. |

### Remboursement

Si le RDV est annule et l'acompte avait ete paye par carte cadeau, le montant est **re-credite** sur la carte.

---

## 12. Etats d'un rendez-vous

```
pending ──────────────────────────────────────────┐
  │ (client confirme) → confirmed                 │ (timeout) → cancelled
  │ (acompte requis)  → pending_deposit            │

pending_deposit ──────────────────────────────────┐
  │ (acompte paye)    → confirmed                 │ (deadline passee) → cancelled

confirmed ────────────────────────────────────────┐
  │ (prestation terminee) → completed              │
  │ (client absent)       → no_show                │
  │ (staff modifie heure) → modified_pending       │
  │ (annulation)          → cancelled              │

modified_pending ─────────────────────────────────┐
  │ (client accepte / timeout) → confirmed         │ (client refuse) → cancelled

completed ────────────────── (fin du parcours)
no_show ──────────────────── (correction possible → confirmed)
cancelled ────────────────── (restauration possible → confirmed / pending_deposit)
```

---

## 13. Parametres configurables

### Acompte

| Parametre | Defaut | Description |
|---|---|---|
| `deposit_enabled` | `false` | Activer/desactiver les acomptes |
| `deposit_type` | `percent` | `fixed` ou `percent` |
| `deposit_fixed_cents` | `2500` | Montant fixe (en centimes) |
| `deposit_percent` | `50` | Pourcentage du prix total |
| `deposit_price_threshold_cents` | `0` | Seuil de prix declencheur |
| `deposit_duration_threshold_min` | `0` | Seuil de duree declencheur |
| `deposit_threshold_mode` | `any` | `any` = l'un ou l'autre, `both` = les deux |
| `deposit_noshow_threshold` | `2` | Nombre de no-shows avant acompte obligatoire |
| `deposit_deadline_hours` | `48` | Heures avant le RDV pour la deadline de paiement |

### Confirmation

| Parametre | Defaut | Description |
|---|---|---|
| `booking_confirmation_required` | `true` | Le client doit confirmer activement |
| `booking_confirmation_timeout_min` | `30` | Delai avant annulation auto (en minutes) |

### Annulation

| Parametre | Defaut | Description |
|---|---|---|
| `cancel_deadline_hours` | `24` | Heures avant le RDV pour annuler |

### Report

| Parametre | Defaut | Description |
|---|---|---|
| `reschedule_max_count` | `1` | Nombre de reports autorises |
| `reschedule_window_days` | `30` | Jours a l'avance pour reporter |

### Rappels

| Parametre | Defaut | Description |
|---|---|---|
| `reminder_email_24h` | `true` | Email de rappel 24h avant |
| `reminder_sms_24h` | `false` | SMS de rappel 24h avant (Pro+) |
| `reminder_email_2h` | `false` | Email de rappel 2h avant |
| `reminder_sms_2h` | `false` | SMS de rappel 2h avant (Pro+) |

---

*Document genere le 20 mars 2026 — Bookt v3.6*
