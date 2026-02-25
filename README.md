# 📅 Genda — Votre cabinet en ligne en 10 minutes

SaaS multi-tenant de prise de rendez-vous pour professionnels libéraux en Belgique (salons de beauté, coiffeurs, praticiens santé, etc.).

## Stack

- **Backend** : Node.js + Express
- **Base de données** : PostgreSQL (Neon) — 29 tables, RLS multi-tenant
- **Frontend** : HTML/CSS/JS vanilla (dashboard monolithique)
- **PDF** : PDFKit (factures belges)
- **Email** : Brevo (transactionnel)
- **Calendrier** : Google Calendar + Outlook (OAuth2)
- **SMS/Appels** : Twilio
- **Hébergement** : Render

## Fonctionnalités (v0.6)

### Core
- 🏢 Multi-tenant avec Row Level Security
- 📅 Slot engine (créneaux dispo, granularité configurable, buffers)
- 📋 Booking flow client (mini-site → choix prestation → créneau → confirmation)
- 👥 Gestion praticiens, services, disponibilités, exceptions
- 🔐 Auth JWT + magic links
- 📱 Page annulation/report client avec deadline

### Mini-site public (v2)
- 🎨 6 thèmes (1 gratuit, 5 premium Pro)
- 🏷️ SEO (title, description, slug personnalisé)
- 🌐 Domaines personnalisés (CNAME + SSL)
- 📊 Sections configurables (hero, équipe, témoignages, spécialisations)

### Facturation (v3)
- 🧾 PDF belge conforme (TVA 21/6/0%, BCE, communication structurée +++XXX/XXXX/XXXXX+++)
- 💳 IBAN/BIC, échéance J+30
- 📄 Factures, devis, notes de crédit
- 🔄 Création depuis un RDV terminé

### Documents pré-RDV (v4)
- 📋 Templates : fiches d'info, formulaires, consentements
- ✉️ Envoi automatique J-2 par email (Brevo)
- 🔗 Lien sécurisé avec token pour le client
- 📝 Réponses JSONB + consentement tracé

### Calendrier (v5-v6)
- 📅 Sync bidirectionnelle Google Calendar + Outlook
- 🔄 Push RDV Genda → agenda externe
- ⬅️ Pull créneaux occupés → bloque slots dans le booking flow
- 🔑 OAuth2 avec refresh automatique

### Dashboard pro
- 📊 Analytics (6 graphes Canvas)
- 👥 Gestion équipe (invitation staff)
- ⚙️ Settings (infos cabinet, SEO, widget/QR, sécurité, plans)
- 📞 Filtre d'appels (Twilio)

## Structure

```
genda/
├── public/                    # Frontend
│   ├── dashboard.html         # Dashboard pro (1900+ lignes)
│   ├── book.html              # Booking flow client
│   ├── site.html              # Mini-site public dynamique
│   ├── manage-booking.html    # Page annulation client
│   ├── pre-rdv.html           # Documents pré-RDV client
│   ├── login.html / signup.html
│   └── js/api-client.js
├── src/
│   ├── server.js              # Express app + routes
│   ├── services/
│   │   ├── db.js              # Pool PG + RLS helpers
│   │   ├── slot-engine.js     # Calcul créneaux + busy blocks
│   │   ├── invoice-pdf.js     # Génération PDF (PDFKit)
│   │   ├── email.js           # Envoi email (Brevo API)
│   │   └── calendar-sync.js   # Google + Outlook OAuth2 sync
│   ├── routes/
│   │   ├── public/index.js    # API publique (mini-site, slots, booking)
│   │   ├── staff/             # API dashboard (auth required)
│   │   │   ├── auth.js, bookings.js, clients.js, services.js
│   │   │   ├── availability.js, settings.js, practitioners.js
│   │   │   ├── invoices.js, documents.js, calendar.js
│   │   │   ├── dashboard.js, site.js, calls.js, signup.js
│   │   ├── cron/pre-rdv.js    # Cron envoi docs J-2
│   │   └── webhooks/twilio.js
│   ├── middleware/
│   │   ├── auth.js, error-handler.js, rate-limiter.js
│   └── utils/db-init.js
├── schema.sql                 # Schema v1 (22 tables core)
├── schema-v2-migration.sql    # Colonnes mini-site
├── schema-v3-invoices.sql     # Tables invoices + invoice_items
├── schema-v4-documents.sql    # Tables document_templates + pre_rdv_sends
├── schema-v5-calendar.sql     # Tables calendar_connections + calendar_events
├── .env.example
├── .gitignore
└── package.json
```

## Setup local

```bash
git clone https://github.com/YOUR_USER/Genda.git
cd Genda
npm install
cp .env.example .env
# Remplir les variables dans .env
npm run dev
```

## Variables d'environnement

Voir `.env.example` pour la liste complète. Variables critiques :

| Variable | Description |
|---|---|
| `DATABASE_URL` | Connection string PostgreSQL (Neon) |
| `JWT_SECRET` | Secret pour tokens d'authentification |
| `BREVO_API_KEY` | Clé API Brevo pour emails transactionnels |
| `GOOGLE_CLIENT_ID` / `SECRET` | OAuth2 Google Calendar |
| `OUTLOOK_CLIENT_ID` / `SECRET` | OAuth2 Microsoft 365 |
| `CRON_SECRET` | Clé pour endpoints cron sécurisés |

## Migrations DB

Exécuter dans l'ordre sur Neon SQL Editor :
1. `schema.sql` — tables core (22)
2. `schema-v2-migration.sql` — colonnes mini-site sur businesses/practitioners
3. `schema-v3-invoices.sql` — invoices + invoice_items
4. `schema-v4-documents.sql` — document_templates + pre_rdv_sends
5. `schema-v5-calendar.sql` — calendar_connections + calendar_events

## API Endpoints

### Public (no auth)
- `GET /api/public/:slug` — données mini-site
- `GET /api/public/:slug/slots` — créneaux disponibles
- `POST /api/public/:slug/bookings` — créer un RDV
- `GET /api/public/docs/:token` — document pré-RDV
- `POST /api/public/docs/:token/submit` — soumettre formulaire

### Staff (JWT required)
- `/api/bookings` — CRUD RDV + statuts
- `/api/clients` — CRUD clients
- `/api/services` — CRUD prestations
- `/api/availabilities` — horaires + exceptions
- `/api/invoices` — factures PDF belges
- `/api/documents` — templates pré-RDV
- `/api/calendar` — sync Google/Outlook
- `/api/practitioners` — gestion équipe
- `/api/business` — settings cabinet
- `/api/dashboard` — KPIs + analytics

### Cron
- `GET /api/cron/pre-rdv-docs?key=CRON_SECRET` — envoi docs J-2

## Déploiement (Render)

1. Connecter repo GitHub
2. Build command : `npm install`
3. Start command : `npm start`
4. Ajouter toutes les env vars de `.env.example`
5. Health check : `/health`

## Licence

Propriétaire — © Genda 2026
