# Bookt 🇧🇪

**Votre cabinet en ligne en 10 minutes.**

Plateforme SaaS multi-tenant pour professionnels libéraux (comptables, avocats, médecins, dentistes, kinés). Chaque professionnel obtient :

- 🌐 **Mini-site cabinet** — page pro avec bio, équipe, spécialisations, témoignages, SEO
- 📅 **Booking en ligne 24/7** — flow client en 30 sec, rappels SMS/email, anti double-booking
- 📞 **Filtre d'appels intelligent** — numéro belge dédié, SMS auto avec lien booking, whitelist VIP

## Stack technique

| Layer | Tech |
|---|---|
| Backend | Node.js, Express 4 |
| Database | PostgreSQL 15+ (22 tables, RLS) |
| Auth | JWT + Magic links + bcrypt |
| SMS/Appels | Twilio webhooks |
| Email | Brevo (Sendinblue) |
| Frontend | HTML/CSS/JS vanilla (pas de framework) |

## Structure du projet

```
bookt/
├── public/                     # Frontend
│   ├── index.html              # Landing page marketing
│   ├── login.html              # Connexion (email + password)
│   ├── signup.html             # Inscription + onboarding 10 étapes
│   ├── dashboard.html          # Dashboard pro (auth-protected)
│   └── js/
│       └── api-client.js       # Client API partagé (auth, fetch, helpers)
│
├── src/
│   ├── server.js               # Express app, routes, middleware
│   ├── routes/
│   │   ├── public/index.js     # API publique (mini-site, slots, booking)
│   │   ├── staff/auth.js       # Login, magic link, verify, /me
│   │   ├── staff/signup.js     # Signup avec templates secteur
│   │   ├── staff/dashboard.js  # Stats, today's bookings
│   │   ├── staff/bookings.js   # CRUD bookings (staff)
│   │   ├── staff/services.js   # CRUD prestations
│   │   ├── staff/clients.js    # CRUD clients
│   │   ├── staff/availability.js # Horaires + exceptions
│   │   ├── staff/settings.js   # Business settings (v1 + v2 fields)
│   │   ├── staff/site.js       # Mini-site management (testimonials, specs, values, domain, onboarding)
│   │   ├── staff/calls.js      # Call logs, settings, whitelist
│   │   └── webhooks/twilio.js  # Incoming call/SMS webhooks
│   ├── middleware/
│   │   ├── auth.js             # JWT verification + RLS
│   │   ├── error-handler.js    # Global error handler
│   │   └── rate-limiter.js     # Rate limiting (auth, API, webhooks)
│   ├── services/
│   │   ├── db.js               # PostgreSQL pool + queryWithRLS
│   │   └── slot-engine.js      # Calcul des créneaux disponibles
│   └── utils/
│       └── db-init.js          # Schema initialization
│
├── schema.sql                  # 15 tables core (v1)
├── schema-v2-migration.sql     # 7 tables mini-site (v2)
├── docs/
│   └── mockups/                # Maquettes HTML standalone
│
├── .env.example
├── .gitignore
└── package.json
```

## Installation

### Prérequis

- Node.js 18+
- PostgreSQL 15+

### Setup

```bash
# 1. Clone
git clone git@github.com:YOUR_USER/Bookt.git
cd Bookt

# 2. Dépendances
npm install

# 3. Environnement
cp .env.example .env
# Éditer .env : DATABASE_URL, JWT_SECRET (minimum)

# 4. Base de données
createdb bookt
npm run db:init

# 5. Lancer
npm run dev
```

Puis ouvrir `http://localhost:3000`

## Flow utilisateur

```
Landing (bookt.be)
  → "Créer mon cabinet" → Signup + Onboarding 10 étapes
  → Dashboard pro (gérer agenda, clients, prestations, appels)
  → Dashboard "Mon site" (éditer bio, équipe, témoignages, SEO, domaine)
  → bookt.be/cabinet-dewit (page publique mini-site)
  → Client clique "Prendre RDV" → Flow booking 6 écrans
  → Confirmation SMS + email → Rappels automatiques
```

## API endpoints

### Public (no auth)
| Method | Path | Description |
|---|---|---|
| GET | `/api/public/:slug` | Full mini-site data |
| GET | `/api/public/:slug/slots` | Available slots |
| POST | `/api/public/:slug/bookings` | Create booking |

### Auth
| Method | Path | Description |
|---|---|---|
| POST | `/api/auth/signup` | Create account + business |
| POST | `/api/auth/login` | Login (password or magic link) |
| GET | `/api/auth/me` | Current user info |

### Staff (JWT required)
| Method | Path | Description |
|---|---|---|
| GET | `/api/dashboard/summary` | Stats + today's bookings |
| GET/POST/PATCH/DELETE | `/api/bookings` | Manage bookings |
| GET/POST/PATCH/DELETE | `/api/services` | Manage services |
| GET | `/api/clients` | Client list |
| GET/POST | `/api/availabilities` | Weekly schedule |
| PATCH | `/api/business` | Business settings |
| GET/POST/PATCH/DELETE | `/api/site/testimonials` | Testimonials |
| GET/POST/PATCH/DELETE | `/api/site/specializations` | Specializations |
| PATCH | `/api/site/onboarding` | Mark step complete |

## Pricing model

| Plan | Prix | Inclus |
|---|---|---|
| **Gratuit** | 0 € | Page pro, booking 1 praticien, email confirmations |
| **Pro** | 39 €/mois | + Praticiens illimités, filtre appels, rappels SMS, stats |
| **Team** | 59 €/mois | + Domaine personnalisé, multi-users, rôles, export |

## Templates secteur

Le signup génère automatiquement services, spécialisations, et valeurs adaptés au secteur : comptable, avocat, médecin, dentiste, kiné, ou autre.

## Licence

Propriétaire — tous droits réservés.

---

*Une solution belge 🇧🇪 pour les professionnels libéraux.*
