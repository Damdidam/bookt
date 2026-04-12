# Mode "Sur devis" pour les prestations

**Date:** 2026-04-12
**Statut:** Approuvé

## Contexte

Le modèle de prestations actuel (prix fixe + durée fixe) ne convient pas aux métiers où le tarif dépend du projet client : tatoueurs, photographes événementiels, maquillage mariage, coloration fantaisie, etc. Ces professionnels ont besoin que le client décrive son projet avant de fixer un prix.

## Principe

Un flag `quote_only` par prestation. Quand activé, le client ne peut pas booker directement — il soumet une **demande de devis** avec ses infos et images de référence. Le pro reçoit tout par email et gère la négociation en dehors de Genda. Une fois d'accord, le pro crée le RDV manuellement dans son calendrier.

## Ce qui ne change PAS

- Le booking direct reste identique pour les prestations sans le flag.
- Pas de nouveau workflow/section dans le dashboard — la négo se fait par email/WhatsApp.
- Pas de nouveau statut de booking — la demande de devis n'est pas un RDV.
- Les prestations en booking direct ne sont pas modifiées.

---

## 1. Base de données

### 1.1 Nouveau champ sur `services`

```sql
ALTER TABLE services ADD COLUMN IF NOT EXISTS quote_only BOOLEAN DEFAULT false;
```

### 1.2 Nouvelle table `quote_requests`

```sql
CREATE TABLE quote_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  service_id UUID REFERENCES services(id) ON DELETE SET NULL,
  service_name VARCHAR(200),
  client_name VARCHAR(200) NOT NULL,
  client_email VARCHAR(200) NOT NULL,
  client_phone VARCHAR(30),
  description TEXT NOT NULL,
  body_zone VARCHAR(100),
  approx_size VARCHAR(100),
  status VARCHAR(20) DEFAULT 'new' CHECK (status IN ('new', 'treated')),
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_quote_requests_business ON quote_requests(business_id, created_at DESC);
```

- `service_name` dénormalisé pour garder le nom même si la prestation est supprimée.
- `body_zone` et `approx_size` : remplis uniquement quand le secteur du business est `tatouage`.
- `status` : `new` par défaut, `treated` marqué implicitement (pas de UI pour ça dans le dashboard — le pro gère par email).

### 1.3 Nouvelle table `quote_request_images`

```sql
CREATE TABLE quote_request_images (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  quote_request_id UUID NOT NULL REFERENCES quote_requests(id) ON DELETE CASCADE,
  image_url TEXT NOT NULL,
  original_filename VARCHAR(255),
  size_bytes INTEGER,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_quote_images_request ON quote_request_images(quote_request_id);
```

- Max 3 images par demande, 5 MB chacune.
- Stockage : même bucket/mécanisme que les images de galerie existantes.

---

## 2. Backend

### 2.1 Endpoint demande de devis

**`POST /api/public/:slug/quote-request`**

- Rate-limited (même limiter que les bookings publics).
- Accepte `multipart/form-data` (pour les images).
- Champs body : `service_id`, `client_name`, `client_email`, `client_phone`, `description`, `body_zone` (optionnel), `approx_size` (optionnel).
- Fichiers : `images[]` (max 3, max 5MB chacune, JPEG/PNG/WebP).
- Validation :
  - Le service doit exister, être actif, et avoir `quote_only = true`.
  - `client_name`, `client_email`, `description` requis.
  - `description` max 2000 caractères.
  - Images : vérifier MIME type, taille, nombre.
- Actions :
  1. Upload images vers le stockage (même service que galerie).
  2. Insérer `quote_requests` + `quote_request_images`.
  3. Envoyer email au pro (voir section 4).
  4. Envoyer email de confirmation au client.
- Réponse : `{ success: true }`.

### 2.2 Modification des endpoints existants

**`PATCH /api/business` (settings.js)** — Aucune modification nécessaire.

**Service CRUD (services.js)** :
- `POST /api/services` et `PATCH /api/services/:id` : accepter le champ `quote_only` (boolean).
- `GET /api/services` : retourner `quote_only` dans la réponse.

**API publique minisite (`GET /api/public/:slug`)** :
- Inclure `quote_only` dans chaque service retourné.

---

## 3. Dashboard — Gestion des prestations

### 3.1 Formulaire de création/édition de prestation

Ajouter un toggle "Sur devis" dans le formulaire service (`src/frontend/views/services.js`) :

- Position : sous le champ "Nom" ou dans la zone prix, visible sans scroll.
- Toggle avec label : "Sur devis — le client envoie une demande au lieu de réserver directement".
- Quand activé :
  - Le champ prix affiche placeholder "À définir après devis" et devient optionnel (déjà le cas quand vide).
  - Le champ durée reste visible avec label "Durée estimée (indicative)" — le pro doit quand même donner une estimation.
  - Le champ `price_label` est auto-rempli avec "Sur devis" si vide.

### 3.2 Liste des prestations

- Badge visuel "Sur devis" à côté du nom de la prestation (petit tag coloré, même style que les badges existants).

---

## 4. Minisite public — Page booking

### 4.1 Affichage dans la liste des services

- Les prestations `quote_only` apparaissent normalement dans la liste.
- Au lieu du prix : afficher "Sur devis" (ou le `price_label` custom du pro).
- La durée estimée est toujours affichée.

### 4.2 Clic sur une prestation "Sur devis"

Au lieu du flow classique (choisir créneau → confirmer), le client voit un **formulaire de demande de devis** :

**Champs communs (tous secteurs) :**
- Nom * (input text)
- Email * (input email)
- Téléphone (input tel, optionnel)
- Description du projet * (textarea, max 2000 caractères, placeholder adapté au secteur)
- Images de référence (upload, max 3, max 5MB chacune, JPEG/PNG/WebP)

**Champs supplémentaires si `business.sector === 'tatouage'` :**
- Zone du corps (select : bras, avant-bras, épaule, dos, torse, jambe, cheville, poignet, cou, main, autre)
- Taille approximative (select : < 5cm, 5-10cm, 10-20cm, 20-30cm, 30cm+, manchette, dos complet)

**Bouton :** "Envoyer ma demande"

**Après soumission :** message de confirmation "Votre demande a été envoyée ! [Nom du business] vous recontactera pour discuter de votre projet et vous proposer un devis."

### 4.3 Placeholder description par secteur

- `tatouage` : "Décrivez votre projet : style souhaité, éléments, signification..."
- `photographe` : "Décrivez votre projet : type d'événement, lieu, nombre de personnes..."
- `esthetique` : "Décrivez ce que vous recherchez : occasion, style souhaité..."
- Défaut : "Décrivez votre projet en détail..."

---

## 5. Email au professionnel

**Sujet :** "Nouvelle demande de devis — [Nom prestation]"

**Contenu :**
- Nom du client, email, téléphone (si fourni)
- Prestation demandée
- Description du projet (texte complet)
- Zone du corps + taille (si tatouage)
- Images de référence en pièces jointes ou liens cliquables
- Bouton "Répondre par email" (mailto: vers le client)

Utiliser le template email existant du système.

---

## 6. Email de confirmation au client

**Sujet :** "Votre demande de devis a été envoyée — [Nom du business]"

**Contenu :**
- Récapitulatif de la demande (prestation, description)
- Message : "[Nom du business] a bien reçu votre demande et vous recontactera pour discuter de votre projet."
- Coordonnées du business (téléphone, email) si disponibles

---

## 7. Périmètre explicitement exclu

- **Pas de vue "Demandes" dans le dashboard** — le pro gère par email.
- **Pas de chat/messagerie intégrée** — la négo se fait en dehors de Genda.
- **Pas de modification du booking direct** — les prestations sans `quote_only` ne changent pas.
- **Pas de workflow d'approbation dans Genda** — le pro crée le RDV manuellement une fois d'accord.
- **Pas de devis PDF généré** — hors scope.
