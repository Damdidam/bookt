# Tests Fonctionnels — Early Production Checklist

## Priorites
- **P0** = Bloquant production (doit passer)
- **P1** = Important (peut causer perte de revenus / mauvaise UX)
- **P2** = Nice-to-have (peut etre regle post-launch)

---

## 1. RESERVATION EN LIGNE (Client)

### 1.1 Reservation single service [P0]
- [ ] Selectionner 1 service sans variante > choisir praticien > choisir creneau > remplir formulaire > confirmer
- [ ] Verifier email de confirmation recu (ou email de demande de confirmation si mode manuel)
- [ ] Verifier que le RDV apparait dans le calendrier staff
- [ ] Verifier les horaires affiches (timezone Europe/Brussels)

### 1.2 Reservation single service avec variante [P0]
- [ ] Selectionner 1 service avec variantes > choisir une variante > verifier que duree et prix changent
- [ ] Completer la reservation > verifier que la variante est bien enregistree en DB
- [ ] Verifier que l'email mentionne le bon nom (Service — Variante)

### 1.3 Reservation multi-services [P0]
- [ ] Selectionner 2-3 services > verifier le panier (cart bar)
- [ ] Supprimer un service du panier > verifier la mise a jour
- [ ] Completer la reservation > verifier que les services sont chaines correctement (group_id, group_order)
- [ ] Verifier l'email avec la liste des prestations + total

### 1.4 Reservation multi-services avec variantes [P1]
- [ ] Selectionner 2 services dont un avec variante > completer reservation
- [ ] Verifier que la variante est bien appliquee (duree, prix) dans le recapitulatif et en DB

### 1.5 Reservation multi-services split mode [P1]
- [ ] Selectionner 2+ services assignes a des praticiens differents
- [ ] Verifier que le slot engine propose des creneaux split (praticiens differents)
- [ ] Completer > verifier que chaque booking a le bon practitioner_id

### 1.6 Selection du praticien [P0]
- [ ] "Sans preference" > verifier que le systeme assigne un praticien automatiquement
- [ ] Choisir un praticien specifique > verifier que seuls ses creneaux sont affiches
- [ ] Verifier que les praticiens avec booking_enabled=false sont masques

### 1.7 Modes de rendez-vous [P1]
- [ ] Si service supporte plusieurs modes (cabinet/domicile/visio) > verifier le selecteur
- [ ] Reserver en mode domicile > verifier que appointment_mode='domicile' en DB

---

## 2. MOTEUR DE CRENEAUX (Slot Engine)

### 2.1 Disponibilites de base [P0]
- [ ] Les creneaux respectent les horaires du praticien (availabilities)
- [ ] Pas de creneaux en dehors des heures d'ouverture du salon (business_schedule)
- [ ] Pas de creneaux sur les jours feries (business_holidays)
- [ ] Pas de creneaux pendant les fermetures exceptionnelles (business_closures)

### 2.2 Conflits et buffers [P0]
- [ ] Reserver un creneau > verifier qu'il n'apparait plus comme disponible
- [ ] Service avec buffer_before/buffer_after > verifier que le buffer bloque les creneaux adjacents
- [ ] Service avec processing_time > verifier que le temps de pose est pris en compte

### 2.3 Absences et conges [P0]
- [ ] Ajouter une absence (conge) pour un praticien > verifier qu'aucun creneau n'est propose ce jour
- [ ] Absence demi-journee (matin) > verifier que seuls les creneaux apres-midi sont proposes

### 2.4 Delai minimum de reservation [P1]
- [ ] Service avec min_booking_notice_hours=24 > verifier qu'on ne peut pas reserver pour aujourd'hui
- [ ] Service sans delai > verifier qu'on peut reserver le jour meme

### 2.5 Horaires restreints [P1]
- [ ] Service avec available_schedule restreint (ex: lundi-mercredi seulement) > verifier les creneaux

### 2.6 Capacite concurrente [P1]
- [ ] Praticien avec max_concurrent=2 > reserver 2 creneaux a la meme heure > verifier que le 3e est bloque

### 2.7 Creneaux vedette / semaines verrouillees [P2]
- [ ] Verrouiller une semaine > verifier que seuls les creneaux vedette sont proposes
- [ ] Tenter de reserver un creneau normal sur semaine verrouillee > verifier le refus

---

## 3. LAST MINUTE / PROMOTIONS

### 3.1 Detection last-minute [P1]
- [ ] Configurer une promo last-minute (deadline j-1, -20%) > verifier que les creneaux de demain affichent le prix barre
- [ ] Verifier que le prix reduit est correct (original - discount%)
- [ ] Completer la reservation > verifier que is_last_minute=true en DB

### 3.2 Exclusion promo [P2]
- [ ] Service avec promo_eligible=false > verifier qu'il n'a pas de prix barre meme en last-minute

---

## 4. ACOMPTES ET PAIEMENTS

### 4.1 Declenchement acompte [P0]
- [ ] Service dont le prix depasse deposit_price_threshold > verifier que l'acompte est demande
- [ ] Service dont la duree depasse deposit_duration_threshold > verifier l'acompte
- [ ] Client VIP > verifier qu'il est exempte de l'acompte
- [ ] Client bloque > verifier qu'il ne peut pas reserver (403)

### 4.2 Paiement Stripe [P0]
- [ ] Reserver avec acompte > verifier la redirection Stripe > payer > verifier deposit_status=paid
- [ ] Verifier l'email "Acompte paye" recu
- [ ] Verifier que le RDV passe en status confirmed apres paiement

### 4.3 Paiement carte cadeau [P0]
- [ ] Reserver avec acompte + code carte cadeau > verifier que la carte est debitee
- [ ] Carte cadeau couvre 100% de l'acompte > verifier pas de redirection Stripe
- [ ] Carte cadeau couvre partiellement > verifier que le reste va sur Stripe
- [ ] Code invalide ou expire > verifier le message d'erreur

### 4.4 Expiration acompte [P1]
- [ ] Reserver sans payer l'acompte > attendre le deadline > verifier auto-annulation
- [ ] Verifier l'email d'annulation recu
- [ ] Verifier que le creneau est libere (slot a nouveau disponible)

### 4.5 Remboursement acompte [P0]
- [ ] Annuler un RDV avec acompte paye > verifier que Stripe rembourse
- [ ] Annuler un RDV avec acompte paye par carte cadeau > verifier que la carte est re-creditee
- [ ] Annuler un RDV avec paiement mixte (Stripe + GC) > verifier les deux remboursements

### 4.6 Acompte recidive no-show [P1]
- [ ] Client avec 2+ no-shows > verifier que l'acompte est automatiquement demande meme si le prix est bas

---

## 5. CONFIRMATION DE RENDEZ-VOUS

### 5.1 Auto-confirmation [P0]
- [ ] Desactiver le mode confirmation manuelle > reserver > verifier status=confirmed directement
- [ ] Verifier l'email de confirmation (pas de demande de confirmation)

### 5.2 Confirmation manuelle [P0]
- [ ] Activer le mode confirmation manuelle > reserver > verifier status=pending
- [ ] Verifier l'email de demande de confirmation avec le bouton "Confirmer"
- [ ] Cliquer sur "Confirmer" > verifier status=confirmed
- [ ] Cliquer sur "Refuser" > verifier status=cancelled

### 5.3 Expiration confirmation [P1]
- [ ] Reserver en mode manuel > ne pas confirmer > attendre le timeout (ex: 30 min)
- [ ] Verifier que le RDV est auto-annule par le cron
- [ ] Verifier que expired_pending_count du client est incremente

### 5.4 Confirmation groupe [P1]
- [ ] Reservation multi-services en mode manuel > confirmer un seul > verifier que tous les siblings sont confirmes

---

## 6. GESTION DU RDV (Client - Page manage-booking)

### 6.1 Acces page de gestion [P0]
- [ ] Acceder via `/booking/{public_token}` > verifier l'affichage des details du RDV
- [ ] Verifier les differents status affiches (pending, confirmed, cancelled, completed, no_show)

### 6.2 Annulation par le client [P0]
- [ ] Annuler un RDV dans le delai > verifier status=cancelled
- [ ] Verifier l'email d'annulation recu
- [ ] Verifier le remboursement de l'acompte (Stripe et/ou carte cadeau)
- [ ] Tenter d'annuler hors delai > verifier le message "Impossible d'annuler"

### 6.3 Replanification par le client [P1]
- [ ] Replanifier un RDV > choisir nouveau creneau > verifier la mise a jour
- [ ] Verifier l'email de modification recu
- [ ] Tenter de replanifier au-dela du max (reschedule_max_count) > verifier le refus
- [ ] Replanification multi-service > verifier que tous les siblings sont replanifies

---

## 7. CALENDRIER STAFF

### 7.1 Affichage [P0]
- [ ] Vue semaine > verifier que les RDV apparaissent correctement
- [ ] Filtrer par praticien > verifier le filtrage
- [ ] Verifier les couleurs des praticiens/services

### 7.2 Drag & drop / resize [P0]
- [ ] Deplacer un RDV vers un autre creneau > verifier la mise a jour en DB
- [ ] Redimensionner un RDV > verifier la duree mise a jour
- [ ] Deplacer vers un creneau en conflit > verifier le refus

### 7.3 Creation manuelle [P0]
- [ ] Creer un RDV depuis le calendrier staff > remplir les champs > confirmer
- [ ] Verifier l'email envoye au client
- [ ] Creer un RDV multi-services depuis le staff

### 7.4 Changements de statut [P0]
- [ ] Pending > Confirm > verifier
- [ ] Confirmed > Complete > verifier
- [ ] Confirmed > No-show > verifier que no_show_count du client augmente
- [ ] Confirmed > Cancel > verifier le remboursement + email
- [ ] Completed > Reopen > verifier

### 7.5 Taches internes [P2]
- [ ] Creer une tache interne (non-RDV) > verifier l'affichage au calendrier
- [ ] Verifier qu'elle bloque les creneaux pour le praticien

---

## 8. EMAILS

### 8.1 Emails critiques [P0]
- [ ] Confirmation de RDV > verifier contenu + bouton "Gerer mon rendez-vous"
- [ ] Demande de confirmation > verifier contenu + boutons Confirmer/Refuser + deadline
- [ ] Annulation > verifier contenu
- [ ] Demande d'acompte > verifier contenu + lien Stripe + deadline
- [ ] Acompte paye > verifier contenu

### 8.2 Bouton "Gerer mon rendez-vous" [P0]
- [ ] Present dans TOUS les emails client (confirmation, demande confirmation, acompte, rappels)
- [ ] Le lien `/booking/{public_token}` fonctionne et ouvre la bonne page

### 8.3 Emails multi-services [P1]
- [ ] Verifier que l'email liste toutes les prestations avec duree/prix individuels
- [ ] Verifier le total (duree + prix)
- [ ] En split mode, verifier que chaque prestation affiche son praticien

### 8.4 Rappels [P1]
- [ ] Rappel 24h avant > verifier l'envoi
- [ ] Rappel 2h avant > verifier l'envoi
- [ ] Verifier que les rappels ne sont pas envoyes pour les RDV annules

---

## 9. CARTES CADEAU

### 9.1 Achat en ligne [P1]
- [ ] Acheter une carte cadeau via la page publique > payer via Stripe
- [ ] Verifier l'email envoye au destinataire avec le code GC-XXXX-XXXX
- [ ] Verifier que la carte apparait dans le dashboard staff

### 9.2 Utilisation [P0]
- [ ] Utiliser le code lors d'une reservation > verifier le debit
- [ ] Utiliser un code avec solde insuffisant > verifier le message d'erreur / paiement partiel
- [ ] Utiliser un code expire > verifier le refus

### 9.3 Remboursement sur carte [P0]
- [ ] Annuler un RDV paye avec carte cadeau > verifier que le solde est re-credite
- [ ] Verifier que la carte repasse en status 'active' si elle etait 'used'

---

## 10. LISTE D'ATTENTE

### 10.1 Inscription [P2]
- [ ] S'inscrire a la liste d'attente depuis la page de reservation
- [ ] Verifier les preferences (jours, heure, praticien)

### 10.2 Declenchement [P2]
- [ ] Annuler un RDV > verifier que la liste d'attente est traitee
- [ ] En mode auto > verifier l'email d'offre envoye au premier inscrit
- [ ] Accepter l'offre > verifier la reservation creee
- [ ] Refuser l'offre > verifier que le suivant est notifie

---

## 11. MINISITE

### 11.1 Affichage public [P1]
- [ ] Acceder au minisite via le slug > verifier le chargement
- [ ] Verifier le theme (couleurs, polices, famille)
- [ ] Verifier les sections (hero, services, equipe, avis, contact, galerie)
- [ ] Verifier le bouton de reservation

### 11.2 Mode sombre [P2]
- [ ] Activer le mode sombre > verifier le contraste et la lisibilite
- [ ] Verifier que le hero ne pose pas de probleme de contraste (bug connu bold themes)

---

## 12. GESTION DES CLIENTS (Staff)

### 12.1 Fiche client [P1]
- [ ] Voir la fiche client > historique des RDV, no-shows, notes
- [ ] Bloquer un client > verifier qu'il ne peut plus reserver
- [ ] Debloquer > verifier qu'il peut reserver a nouveau

### 12.2 Client VIP [P1]
- [ ] Marquer un client VIP > verifier l'exemption d'acompte

---

## 13. INTEGRATIONS

### 13.1 Google Calendar sync [P2]
- [ ] Connecter un calendrier Google > verifier la synchro
- [ ] Creer un RDV > verifier qu'il apparait dans Google Calendar
- [ ] Ajouter un evenement dans Google > verifier qu'il bloque les creneaux

### 13.2 OAuth login (client) [P2]
- [ ] Se connecter via Google sur la page de reservation
- [ ] Verifier que nom/email sont pre-remplis
- [ ] Annuler l'OAuth > verifier le message d'erreur et le formulaire manuel

---

## 14. EDGE CASES CRITIQUES [P0]

- [ ] Double-clic rapide sur "Confirmer le rendez-vous" > verifier qu'un seul RDV est cree
- [ ] Reservation sur un creneau qui vient d'etre pris > verifier le message de conflit
- [ ] Reservation avec services dupliques (meme service 2x) > verifier la deduplication
- [ ] Annulation d'un groupe multi-services > verifier que TOUS les siblings sont annules
- [ ] Annulation avec paiement mixte (Stripe + GC) > verifier les deux remboursements
- [ ] Rappels pour RDV deja annule > verifier qu'ils ne sont PAS envoyes
- [ ] Client bloque tente de reserver > verifier le refus
- [ ] Creneau dans le passe (manipulation URL) > verifier le refus
