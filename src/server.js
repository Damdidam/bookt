require('dotenv').config();

// Sentry — must init before everything else
const Sentry = require('@sentry/node');
if (process.env.SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.NODE_ENV || 'development',
    tracesSampleRate: 0.1
  });
}

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const path = require('path');

const { pool } = require('./services/db');
const { addClient } = require('./services/sse');
const { requireAuth } = require('./middleware/auth');
const errorHandler = require('./middleware/error-handler');

// Routes
const publicRoutes = require('./routes/public');
const authRoutes = require('./routes/staff/auth');
const dashboardRoutes = require('./routes/staff/dashboard');
const bookingsRoutes = require('./routes/staff/bookings');
const servicesRoutes = require('./routes/staff/services');
const clientsRoutes = require('./routes/staff/clients');
const availabilityRoutes = require('./routes/staff/availability');
const settingsRoutes = require('./routes/staff/settings');
const siteRoutes = require('./routes/staff/site');
const signupRoutes = require('./routes/staff/signup');
const practitionerRoutes = require('./routes/staff/practitioners');
const invoiceRoutes = require('./routes/staff/invoices');
const depositRoutes = require('./routes/staff/deposits');
const calendarRoutes = require('./routes/staff/calendar');
const waitlistRoutes = require('./routes/staff/waitlist');
const galleryRoutes = require('./routes/staff/gallery');
const realisationsRoutes = require('./routes/staff/realisations');
const newsRoutes = require('./routes/staff/news');
const featuredSlotsRoutes = require('./routes/staff/featured-slots');
const planningRoutes = require('./routes/staff/planning');
const taskRoutes = require('./routes/staff/tasks');
const giftCardRoutes = require('./routes/staff/gift-cards');
const passRoutes = require('./routes/staff/passes');
const businessHoursRoutes = require('./routes/staff/business-hours');
const reviewRoutes = require('./routes/staff/reviews');
const promotionRoutes = require('./routes/staff/promotions');
const adminRoutes = require('./routes/admin');
const twilioWebhooks = require('./routes/webhooks/twilio');
const brevoWebhooks = require('./routes/webhooks/brevo');
const stripeRoutes = require('./routes/staff/stripe');
const { handleStripeWebhook } = require('./routes/staff/stripe');

const app = express();
const PORT = process.env.PORT || 3000;

// ===== MIDDLEWARE =====
// Trust proxy (Render, Railway, etc.)
app.set('trust proxy', 1);

// H1: CSP enabled — restrict script/style sources
// H#19 fix: reportUri pour monitorer les violations (injections JS tierces,
// inline styles non-whitelisted, etc.). Les violations POSTent vers /api/csp-report
// et sont loguées server-side (visible dans Render logs / Sentry).
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", "https://js.stripe.com"],
      scriptSrcAttr: ["'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      imgSrc: ["'self'", "data:", "https:", "blob:"],
      connectSrc: ["'self'", "https://api.stripe.com", "https://fonts.googleapis.com", "https://fonts.gstatic.com"],
      fontSrc: ["'self'", "data:", "https://fonts.gstatic.com"],
      frameSrc: ["https://js.stripe.com", "https://maps.google.com", "https://www.google.com"],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      frameAncestors: ["'self'"],
      reportUri: ['/api/csp-report']
    }
  },
  crossOriginEmbedderPolicy: false
}));
app.use(cors({
  origin: process.env.NODE_ENV === 'production'
    ? ['https://genda.be', 'https://www.genda.be', process.env.APP_BASE_URL].filter(Boolean)
    : '*',
  credentials: true
}));

// Twilio webhooks need raw body for signature validation
// so we parse them differently
app.use('/webhooks/twilio', express.urlencoded({ extended: false }));

// Stripe webhooks need raw body for signature verification
app.post('/webhooks/stripe', express.raw({ type: 'application/json' }), handleStripeWebhook);

// Quote-request needs larger body limit for base64 images (3 × 5MB × 1.33 = ~22MB)
app.use('/api/public', (req, res, next) => {
  if (req.path.endsWith('/quote-request')) {
    return express.json({ limit: '22mb' })(req, res, next);
  }
  next();
});
app.use(express.json({ limit: '5mb' }));
app.use(express.urlencoded({ extended: false }));

// Health check for Render zero-downtime deploys
app.get('/api/health', (req, res) => res.json({ status: 'ok' }));

// H#19 fix: CSP violation reports (helmet reportUri points here). Browsers POST
// JSON describing any CSP violation (blocked inline script, style, frame, etc).
// We log (throttled by IP via Sentry/console) — in dev/ops helps catch XSS early.
// Body parser accepts application/csp-report + application/json (some browsers use either).
const { slotsLimiter: _cspLimiter } = require('./middleware/rate-limiter');
app.post('/api/csp-report', _cspLimiter, express.json({ type: ['application/csp-report', 'application/json'], limit: '64kb' }), (req, res) => {
  try {
    const report = req.body['csp-report'] || req.body || {};
    // Compact log: directive + blocked-uri + source-file + line
    console.warn('[CSP]', JSON.stringify({
      directive: report['violated-directive'] || report.effectiveDirective,
      blocked: report['blocked-uri'] || report.blockedURL,
      source: report['source-file'] || report.sourceFile,
      line: report['line-number'] || report.lineNumber,
      doc: report['document-uri'] || report.documentURL
    }));
    if (typeof Sentry !== 'undefined' && Sentry.captureMessage) {
      Sentry.captureMessage('CSP violation', { level: 'warning', extra: report });
    }
  } catch (_) { /* report body malformed — ignore */ }
  res.status(204).end();
});

// Serve api-client ES module (single source of truth for all pages)
app.get('/js/api-client.js', (req, res) => {
  res.type('application/javascript');
  res.sendFile(path.join(__dirname, 'frontend/api-client.js'));
});


// Redirect .html to clean URLs (must be BEFORE static middleware)
app.get('/dashboard.html', (req, res) => {
  const qs = req._parsedUrl.search || '';
  res.redirect(301, '/dashboard' + qs);
});
app.get('/login.html', (req, res) => res.redirect(301, '/login'));
app.get('/signup.html', (req, res) => res.redirect(301, '/signup'));

// Static files — serve Vite build first (production), then public/ fallback
const fs = require('fs');
const distDir = path.join(__dirname, '../dist');
if (fs.existsSync(distDir)) {
  // Hashed assets (immutable) — cache 1 year
  app.use('/assets', express.static(path.join(distDir, 'assets'), { maxAge: '1y', immutable: true }));
  app.use(express.static(distDir, { maxAge: '1h' }));
}
// Uploads (logos, covers, practitioner photos, realisations, gallery, quote attachments).
// Served from UPLOADS_BASE — configurable via UPLOADS_DIR env (default: public/uploads).
// On Render prod, set UPLOADS_DIR to a mounted persistent disk so files survive deploys.
const { UPLOADS_BASE } = require('./services/uploads');
app.use('/uploads', express.static(UPLOADS_BASE, { maxAge: '30d' }));

app.use(express.static(path.join(__dirname, '../public'), { maxAge: '1h' }));

// ===== CUSTOM DOMAIN RESOLVER =====
// Premium businesses can connect salon-x.be to their minisite via custom_domains.
// When a request arrives on a verified custom domain and the path is a minisite entry
// (/, /book, /gift-card, /pass, /guide), rewrite it to /{slug}/... so the existing
// /:slug[/page] handlers render normally. Without this, salon-x.be/ returns the
// Genda landing page instead of the pro's minisite.
// /manage-booking is NOT a /:slug sub-route — bookings are reached via /booking/:token,
// so there's no need to rewrite it for custom domains.
const MINISITE_ENTRY_PATHS = new Set(['/', '/book', '/gift-card', '/pass', '/guide']);
app.use(async (req, res, next) => {
  if (req.method !== 'GET') return next();
  if (!MINISITE_ENTRY_PATHS.has(req.path)) return next();
  const host = (req.hostname || '').toLowerCase();
  if (!host || /^(www\.)?genda\.be$/i.test(host) || host === 'localhost' ||
      host.startsWith('127.0.0.1') || host.endsWith('.onrender.com')) {
    return next();
  }
  try {
    const r = await pool.query(
      `SELECT b.slug FROM custom_domains cd
       JOIN businesses b ON b.id = cd.business_id
       WHERE cd.domain = $1
         AND cd.verification_status IN ('dns_verified','ssl_active')
         AND b.is_active = true
       LIMIT 1`,
      [host]
    );
    if (r.rows.length > 0) {
      const slug = r.rows[0].slug;
      const newPath = req.path === '/' ? `/${slug}` : `/${slug}${req.path}`;
      req.url = newPath + (req._parsedUrl?.search || '');
    }
  } catch (e) {
    console.error('[custom-domain] resolver error for host %s: %s', host, e.message);
  }
  next();
});

// ===== FRONTEND PAGE ROUTES =====
// Serve HTML pages for direct URL access
app.get('/', (req, res) => res.sendFile(path.join(__dirname, '../public/index.html')));
app.get('/login', (req, res) => res.sendFile(path.join(__dirname, '../public/login.html')));
app.get('/signup', (req, res) => res.sendFile(path.join(__dirname, '../public/signup.html')));
app.get('/dashboard', (req, res) => {
  const built = path.join(__dirname, '../dist/public/dashboard.html');
  if (fs.existsSync(built)) return res.sendFile(built);
  res.sendFile(path.join(__dirname, '../public/dashboard.html'));
});

app.get('/auto-login', (req, res) => res.sendFile(path.join(__dirname, '../public/auto-login.html')));
app.get('/cgv', (req, res) => res.sendFile(path.join(__dirname, '../public/legal.html')));
app.get('/confidentialite', (req, res) => res.sendFile(path.join(__dirname, '../public/legal.html')));
app.get('/legal', (req, res) => res.sendFile(path.join(__dirname, '../public/legal.html')));

// Public mini-site: /:slug (must be AFTER all other routes)
// This is handled by the catch-all at the bottom

// ===== HEALTH CHECK =====
app.get('/health', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ status: 'ok', db: 'connected', timestamp: new Date().toISOString() });
  } catch (err) {
    res.status(500).json({ status: 'error', db: 'disconnected' });
  }
});

// ===== SSE — Real-time calendar updates =====
app.get('/api/events/stream', requireAuth, (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no' // Nginx/Cloudflare: don't buffer SSE
  });
  res.write(':\n\n'); // Initial ping

  const accepted = addClient(req.businessId, res);
  if (!accepted) {
    res.write('event: error\ndata: {"error":"too_many_connections"}\n\n');
    return res.end();
  }

  // Heartbeat every 30s to keep connection alive through proxies
  const hb = setInterval(() => { try { res.write(':\n\n'); } catch(e) { clearInterval(hb); } }, 30000);
  res.on('close', () => clearInterval(hb));
});

// ===== API ROUTES =====

// Public API (no auth — client booking flow)
app.use('/api/public', publicRoutes);

// Auth
app.use('/api/auth', authRoutes);
app.use('/api/auth', signupRoutes);

// Admin API (superadmin only)
app.use('/api/admin', adminRoutes);

// Staff API (auth required — dashboard) — RATE-4: global staff rate limit
const { staffLimiter: _staffLimiter } = require('./middleware/rate-limiter');
app.use('/api/dashboard', _staffLimiter, dashboardRoutes);
app.use('/api/bookings', _staffLimiter, bookingsRoutes);
app.use('/api/services', _staffLimiter, servicesRoutes);
app.use('/api/clients', _staffLimiter, clientsRoutes);
app.use('/api/availabilities', _staffLimiter, availabilityRoutes);
app.use('/api/business', _staffLimiter, settingsRoutes);
app.use('/api/site', _staffLimiter, siteRoutes);
app.use('/api/practitioners', _staffLimiter, practitionerRoutes);
app.use('/api/invoices', _staffLimiter, invoiceRoutes);
app.use('/api/deposits', _staffLimiter, depositRoutes);
app.use('/api/calendar', _staffLimiter, calendarRoutes);
app.use('/api/waitlist', _staffLimiter, waitlistRoutes);
app.use('/api/gallery', _staffLimiter, galleryRoutes);
app.use('/api/realisations', _staffLimiter, realisationsRoutes);
app.use('/api/news', _staffLimiter, newsRoutes);
app.use('/api/reviews', _staffLimiter, reviewRoutes);
app.use('/api/featured-slots', _staffLimiter, featuredSlotsRoutes);
app.use('/api/planning', _staffLimiter, planningRoutes);
app.use('/api/tasks', _staffLimiter, taskRoutes);
app.use('/api/business-hours', requireAuth, _staffLimiter, businessHoursRoutes);
app.use('/api/stripe', _staffLimiter, stripeRoutes);
app.use('/api/gift-cards', _staffLimiter, giftCardRoutes);
app.use('/api/passes', _staffLimiter, passRoutes);
app.use('/api/promotions', _staffLimiter, promotionRoutes);

// Webhooks (Twilio)
app.use('/webhooks/twilio', twilioWebhooks);

// Webhooks (Brevo) — track bounces, delivered, complaints, unsubscribes
app.use('/webhooks/brevo', brevoWebhooks);

// Webhooks (Billit Peppol) — invoice status updates (sent/delivered/failed)
app.use('/webhooks/billit', require('./routes/webhooks/billit'));

// ===== PUBLIC MINI-SITE =====
// Catch-all for /:slug → DB lookup → serve the right template
// Must be AFTER all API and static routes

function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Parse cookies manually from request header (no cookie-parser dependency)
function parseCookies(req) {
  const cookies = {};
  (req.headers.cookie || '').split(';').forEach(c => {
    const [k, v] = c.trim().split('=');
    if (k) cookies[k] = decodeURIComponent(v || '');
  });
  return cookies;
}

// Build "Site en préparation" password prompt page for test mode
function buildTestModePage(bizName, slug, logoUrl, wrongPassword) {
  const safeName = (bizName || '').replace(/&/g,'&amp;').replace(/</g,'&lt;');
  return `<!DOCTYPE html>
<html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${safeName} — Site en préparation</title>
<link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;600;700&display=swap" rel="stylesheet">
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{min-height:100vh;display:flex;align-items:center;justify-content:center;background:#F8F9FA;font-family:'Plus Jakarta Sans',sans-serif;padding:24px}
.card{background:#fff;border-radius:16px;padding:48px 40px;max-width:400px;width:100%;text-align:center;box-shadow:0 2px 8px rgba(0,0,0,.06)}
.logo{width:48px;height:48px;border-radius:10px;background:#0D7377;color:#fff;display:inline-flex;align-items:center;justify-content:center;font-size:1.2rem;font-weight:700;margin-bottom:20px}
h1{font-size:1.3rem;font-weight:700;color:#1A2332;margin-bottom:6px}
p{font-size:.88rem;color:#6B7A8D;margin-bottom:24px;line-height:1.5}
.error{color:#C62828;font-size:.82rem;margin-bottom:12px;display:${wrongPassword ? 'block' : 'none'}}
input{width:100%;padding:12px 16px;border:1.5px solid #E8ECF0;border-radius:10px;font-family:inherit;font-size:.92rem;text-align:center;outline:none;transition:border-color .15s}
input:focus{border-color:#0D7377}
button{width:100%;padding:12px;background:#0D7377;color:#fff;border:none;border-radius:10px;font-family:inherit;font-size:.92rem;font-weight:600;cursor:pointer;margin-top:12px;transition:background .15s}
button:hover{background:#0A5E61}
</style>
</head><body>
<div class="card">
  <div class="logo">${safeName.charAt(0)}</div>
  <h1>${safeName}</h1>
  <p>Ce site est en cours de préparation.<br>Entrez le mot de passe pour y accéder.</p>
  <p class="error">Mot de passe incorrect</p>
  <form method="POST" action="/${slug}/access">
    <input type="password" name="password" placeholder="Mot de passe" required autofocus>
    <button type="submit">Accéder</button>
  </form>
</div>
</body></html>`;
}

// Minisite test mode — password verification (RATE-1: add auth limiter to prevent brute force)
const { authLimiter: _accessLimiter } = require('./middleware/rate-limiter');
app.post('/:slug/access', _accessLimiter, async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT settings FROM businesses WHERE slug = $1 AND is_active = true LIMIT 1',
      [req.params.slug]
    );
    if (!rows.length) return res.redirect('/' + req.params.slug);
    const settings = rows[0].settings || {};
    if (settings.minisite_test_mode && settings.minisite_test_password) {
      if (req.body?.password === settings.minisite_test_password) {
        // H#5 fix: store an HMAC token, never the raw password (logs, Referer, DOM).
        const { minisiteAccessToken, minisiteAccessCookieOptions } = require('./services/minisite-access');
        res.cookie(
          'minisite_access_' + req.params.slug,
          minisiteAccessToken(req.params.slug, settings.minisite_test_password),
          minisiteAccessCookieOptions()
        );
        return res.redirect('/' + req.params.slug);
      }
      return res.redirect('/' + req.params.slug + '?wrong=1');
    }
    res.redirect('/' + req.params.slug);
  } catch (e) {
    res.redirect('/' + req.params.slug);
  }
});

app.get('/:slug', async (req, res, next) => {
  // Skip if it looks like a file request
  if (req.params.slug.includes('.')) return next();
  // Skip known paths
  const reserved = ['api', 'webhooks', 'health', 'login', 'signup', 'dashboard'];
  if (reserved.includes(req.params.slug)) return next();

  try {
    const slug = req.params.slug;
    const { rows } = await pool.query(
      `SELECT name, tagline, description, logo_url, cover_image_url, seo_title, seo_description, theme->>'preset' as preset, settings FROM businesses WHERE slug = $1 AND is_active = true LIMIT 1`,
      [slug]
    );

    let biz = rows.length > 0 ? rows[0] : null;

    // Test mode protection
    if (biz) {
      const bizSettings = biz.settings || {};
      if (bizSettings.minisite_test_mode && bizSettings.minisite_test_password) {
        const cookies = parseCookies(req);
        const { minisiteAccessToken: _miniTok } = require('./services/minisite-access');
        const _miniExpected = _miniTok(slug, bizSettings.minisite_test_password);
        if (cookies['minisite_access_' + slug] !== _miniExpected) {
          return res.send(buildTestModePage(biz.name, slug, biz.logo_url, req.query.wrong === '1'));
        }
      }
    }

    const filePath = path.join(__dirname, '../public/site.html');
    let html = fs.readFileSync(filePath, 'utf8');

    if (biz) {
      const title = biz.seo_title || biz.name + ' — ' + (biz.tagline || 'Prenez rendez-vous en ligne');
      const desc = biz.seo_description || biz.description || biz.tagline || '';
      const image = biz.cover_image_url || biz.logo_url || '';
      const url = req.protocol + '://' + req.get('host') + '/' + req.params.slug;

      // Replace meta tags
      html = html.replace('<title id="pageTitle">Chargement...</title>', '<title id="pageTitle">' + escapeHtml(title) + '</title>');
      html = html.replace('id="pageMeta" content=""', 'id="pageMeta" content="' + escapeHtml(desc) + '"');
      html = html.replace('id="ogTitle" content=""', 'id="ogTitle" content="' + escapeHtml(title) + '"');
      html = html.replace('id="ogDesc" content=""', 'id="ogDesc" content="' + escapeHtml(desc) + '"');
      html = html.replace('id="ogImage" content=""', 'id="ogImage" content="' + escapeHtml(image) + '"');
      html = html.replace('id="ogUrl" content=""', 'id="ogUrl" content="' + escapeHtml(url) + '"');
    }

    res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.set('Content-Type', 'text/html');
    res.send(html);
  } catch (err) {
    console.error('Slug route error:', err);
    res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.sendFile(path.join(__dirname, '../public/site.html'));
  }
});

// /:slug/book → booking flow (protected by test mode)
app.get('/:slug/book', async (req, res) => {
  try {
    const slug = req.params.slug;
    const { rows } = await pool.query(
      'SELECT settings FROM businesses WHERE slug = $1 AND is_active = true LIMIT 1',
      [slug]
    );
    if (rows.length) {
      const bizSettings = rows[0].settings || {};
      if (bizSettings.minisite_test_mode && bizSettings.minisite_test_password) {
        const cookies = parseCookies(req);
        const { minisiteAccessToken: _miniTok } = require('./services/minisite-access');
        const _miniExpected = _miniTok(slug, bizSettings.minisite_test_password);
        if (cookies['minisite_access_' + slug] !== _miniExpected) {
          return res.redirect('/' + slug);
        }
      }
    }
    res.sendFile(path.join(__dirname, '../public/book.html'));
  } catch (e) {
    res.sendFile(path.join(__dirname, '../public/book.html'));
  }
});

// /:slug/gift-card → gift card purchase page (protected by test mode)
app.get('/:slug/gift-card', async (req, res) => {
  try {
    const slug = req.params.slug;
    const { rows } = await pool.query(
      'SELECT settings FROM businesses WHERE slug = $1 AND is_active = true LIMIT 1',
      [slug]
    );
    if (rows.length) {
      const bizSettings = rows[0].settings || {};
      if (bizSettings.minisite_test_mode && bizSettings.minisite_test_password) {
        const cookies = parseCookies(req);
        const { minisiteAccessToken: _miniTok } = require('./services/minisite-access');
        const _miniExpected = _miniTok(slug, bizSettings.minisite_test_password);
        if (cookies['minisite_access_' + slug] !== _miniExpected) {
          return res.redirect('/' + slug);
        }
      }
    }
    res.sendFile(path.join(__dirname, '../public/gift-card.html'));
  } catch (e) {
    res.sendFile(path.join(__dirname, '../public/gift-card.html'));
  }
});

// /:slug/pass → pass/subscription purchase page (protected by test mode)
app.get('/:slug/pass', async (req, res) => {
  try {
    const slug = req.params.slug;
    const { rows } = await pool.query(
      'SELECT settings FROM businesses WHERE slug = $1 AND is_active = true LIMIT 1',
      [slug]
    );
    if (rows.length) {
      const bizSettings = rows[0].settings || {};
      if (bizSettings.minisite_test_mode && bizSettings.minisite_test_password) {
        const cookies = parseCookies(req);
        const { minisiteAccessToken: _miniTok } = require('./services/minisite-access');
        const _miniExpected = _miniTok(slug, bizSettings.minisite_test_password);
        if (cookies['minisite_access_' + slug] !== _miniExpected) {
          return res.redirect('/' + slug);
        }
      }
    }
    res.sendFile(path.join(__dirname, '../public/pass.html'));
  } catch (e) {
    res.sendFile(path.join(__dirname, '../public/pass.html'));
  }
});

// /:slug/guide → client-facing flow documentation (protected by test mode)
app.get('/:slug/guide', async (req, res) => {
  try {
    const slug = req.params.slug;
    const { rows } = await pool.query(
      'SELECT settings FROM businesses WHERE slug = $1 AND is_active = true LIMIT 1',
      [slug]
    );
    if (rows.length) {
      const bizSettings = rows[0].settings || {};
      if (bizSettings.minisite_test_mode && bizSettings.minisite_test_password) {
        const cookies = parseCookies(req);
        const { minisiteAccessToken: _miniTok } = require('./services/minisite-access');
        const _miniExpected = _miniTok(slug, bizSettings.minisite_test_password);
        if (cookies['minisite_access_' + slug] !== _miniExpected) {
          return res.redirect('/' + slug);
        }
      }
    }
    res.sendFile(path.join(__dirname, '../public/guide.html'));
  } catch (e) {
    res.sendFile(path.join(__dirname, '../public/guide.html'));
  }
});

// /booking/:token → manage booking (cancel/reschedule)
app.get('/booking/:token', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/manage-booking.html'));
});

// /deposit/:token → public deposit details page
app.get('/deposit/:token', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/deposit.html'));
});

// /review/:token → public review submission page
app.get('/review/:token', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/review.html'));
});

// /waitlist/:token → waitlist offer page
app.get('/waitlist/:token', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/waitlist-offer.html'));
});

// ===== 404 CATCH-ALL =====
app.use((req, res) => {
  const wantsHtml = (req.headers.accept || '').includes('text/html') && !req.path.startsWith('/api/');
  if (wantsHtml) {
    return res.status(404).sendFile(path.join(__dirname, '../public/502.html'));
  }
  res.status(404).json({ error: 'Route introuvable' });
});

// ===== ERROR HANDLER =====
if (process.env.SENTRY_DSN) {
  Sentry.setupExpressErrorHandler(app);
}
app.use(errorHandler);

// ===== START =====
if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) {
  console.error('FATAL: JWT_SECRET must be set and at least 32 characters');
  process.exit(1);
}

// Production hardening warnings — surface bad-config early instead of silently degrading.
if (process.env.NODE_ENV === 'production') {
  if (!process.env.APP_BASE_URL) {
    console.warn('[CONFIG] APP_BASE_URL not set in production — CORS whitelist will only contain genda.be');
  }
  if (!process.env.CALENDAR_TOKEN_KEY) {
    console.warn('[CONFIG] CALENDAR_TOKEN_KEY not set — OAuth refresh tokens will be stored in plaintext');
  }
  if (!process.env.STRIPE_WEBHOOK_SECRET) {
    console.warn('[CONFIG] STRIPE_WEBHOOK_SECRET not set — Stripe webhooks will be rejected');
  }
  if (!process.env.TWILIO_AUTH_TOKEN) {
    console.warn('[CONFIG] TWILIO_AUTH_TOKEN not set — Twilio webhooks will be rejected');
  }
}

app.listen(PORT, async () => {
  console.log(`\n  Genda server running on port ${PORT}`);

  // Auto-migrate: ensure new tables exist
  try {
    const { query: dbQuery } = require('./services/db');
    await dbQuery(`CREATE TABLE IF NOT EXISTS realisations (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
      title TEXT, description TEXT, category TEXT,
      image_url TEXT, before_url TEXT, after_url TEXT,
      sort_order INT DEFAULT 0, is_active BOOLEAN DEFAULT true,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`);
    await dbQuery(`CREATE INDEX IF NOT EXISTS idx_realisations_biz ON realisations (business_id, sort_order)`);
    console.log('  ✓ Auto-migrate: realisations table ready');
  } catch (e) {
    console.warn('  ⚠ Auto-migrate warning:', e.message);
  }
  try {
    await pool.query(`ALTER TABLE invoice_items ADD COLUMN IF NOT EXISTS booking_id UUID REFERENCES bookings(id)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_invoice_items_booking ON invoice_items(booking_id) WHERE booking_id IS NOT NULL`);
  } catch (e) {}
  try {
    await pool.query(`ALTER TABLE clients ADD COLUMN IF NOT EXISTS cancel_count SMALLINT DEFAULT 0`);
  } catch (e) {}
  try {
    await pool.query(`ALTER TABLE bookings ADD COLUMN IF NOT EXISTS booked_price_cents INTEGER`);
  } catch (e) {}
  // schema-v69: J-7 expiry warning columns + notification types
  // schema-v70 (H4): cancellation_email_sent_at flag on bookings — idempotence post-commit emails
  try {
    await pool.query(`ALTER TABLE gift_cards ADD COLUMN IF NOT EXISTS expiry_warning_sent_at TIMESTAMPTZ`);
    await pool.query(`ALTER TABLE passes      ADD COLUMN IF NOT EXISTS expiry_warning_sent_at TIMESTAMPTZ`);
    await pool.query(`ALTER TABLE bookings    ADD COLUMN IF NOT EXISTS cancellation_email_sent_at TIMESTAMPTZ`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_bookings_cron_cancel_email
      ON bookings (status, cancellation_email_sent_at)
      WHERE status = 'cancelled' AND cancellation_email_sent_at IS NULL`);
    // schema-v71 (H3): retry + backoff on notification queue
    await pool.query(`ALTER TABLE notifications ADD COLUMN IF NOT EXISTS attempt_count INT DEFAULT 0`);
    await pool.query(`ALTER TABLE notifications ADD COLUMN IF NOT EXISTS next_retry_at TIMESTAMPTZ`);
    // schema-v72 (BE legal compliance): credit notes link back to original invoice
    await pool.query(`ALTER TABLE invoices ADD COLUMN IF NOT EXISTS related_invoice_id UUID REFERENCES invoices(id)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_invoices_related ON invoices(related_invoice_id) WHERE related_invoice_id IS NOT NULL`);
    // v72b fix: invoices.type was varchar(10) but 'credit_note' is 11 chars → INSERT would fail.
    // Widen to 20 to match the CHECK constraint values.
    await pool.query(`ALTER TABLE invoices ALTER COLUMN type TYPE VARCHAR(20)`);
    await pool.query(`ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_type_check`);
    await pool.query(`ALTER TABLE notifications ADD CONSTRAINT notifications_type_check CHECK (type IN (
      'email_confirmation','sms_confirmation',
      'email_reminder_24h','sms_reminder_24h',
      'email_reminder_2h','sms_reminder_2h',
      'email_cancellation','sms_cancellation',
      'email_cancellation_pro',
      'email_reschedule_pro',
      'email_modification_confirmed','email_modification_rejected',
      'call_filter_sms','email_post_rdv','email_new_booking_pro',
      'email_deposit_request','sms_deposit_request',
      'email_deposit_confirmed','email_deposit_cancelled',
      'deposit_paid_webhook',
      'email_waitlist_offer','waitlist_match',
      'email_confirmation_request','sms_confirmation_reply',
      'email_deposit_orphan','email_dispute_alert','manual_reminder',
      'email_giftcard_expiry_warning','email_pass_expiry_warning',
      'email_deposit_reminder'
    ))`);
  } catch (e) { console.warn('  ⚠ schema-v69 auto-migrate:', e.message); }
  // schema-v73 (E2E tests infra): is_test_account flag + seed_tracking + test_mock_log
  try {
    await pool.query(`ALTER TABLE businesses ADD COLUMN IF NOT EXISTS is_test_account BOOLEAN NOT NULL DEFAULT false`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_businesses_test ON businesses(is_test_account) WHERE is_test_account = true`);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS seed_tracking (
        entity_type TEXT NOT NULL,
        entity_id UUID NOT NULL,
        seeded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (entity_type, entity_id)
      )
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS test_mock_log (
        id SERIAL PRIMARY KEY,
        type TEXT NOT NULL,
        kind TEXT,
        recipient TEXT,
        payload JSONB NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_test_mock_log_lookup ON test_mock_log (type, created_at DESC)`);
  } catch (e) { console.warn('  ⚠ schema-v73 auto-migrate:', e.message); }
  console.log(`  Dashboard: http://localhost:${PORT}`);
  console.log(`  Public booking: http://localhost:${PORT}/api/public/:slug\n`);

  // ===== WAITLIST CRON — check expired offers every 5 min =====
  // P1-02: withCronLock empêche double-exécution sur Render horizontal scaling
  // (2 workers qui firent le cron simultanément → doubles SMS/emails).
  const { withCronLock } = require('./services/cron-lock');
  const waitlistInterval = parseInt(process.env.WAITLIST_CRON_INTERVAL_MS, 10) || 5 * 60 * 1000;
  let waitlistRunning = false;
  setInterval(async () => {
    if (waitlistRunning) return;
    waitlistRunning = true;
    try {
      await withCronLock('waitlist_cron', async () => {
        const { processExpiredOffers } = require('./services/waitlist');
        const result = await processExpiredOffers();
        if (result.processed > 0) {
          console.log(`[WAITLIST CRON] ${result.processed} expired offer(s) processed`);
        }
      });
    } catch (e) {
      console.error('[WAITLIST CRON] Error:', e.message); Sentry.captureException(e);
    } finally {
      waitlistRunning = false;
    }
  }, waitlistInterval);

  // ===== REMINDERS CRON — send patient reminders every 10 min =====
  // P1-02: withCronLock — reminders.js a déjà son lock interne (reminder_cron)
  // mais ajouter withCronLock ici pour cohérence avec les autres crons +
  // protection supplémentaire contre les race multi-worker.
  const reminderInterval = parseInt(process.env.REMINDER_CRON_INTERVAL_MS, 10) || 10 * 60 * 1000;
  let reminderRunning = false;
  setInterval(async () => {
    if (reminderRunning) return;
    reminderRunning = true;
    try {
      await withCronLock('reminders_cron_outer', async () => {
        const { processReminders } = require('./services/reminders');
        const stats = await processReminders();
        const total = stats.email_24h + stats.sms_24h + stats.email_2h + stats.sms_2h;
        if (total > 0) {
          console.log(`[REMINDERS CRON] ${stats.email_24h} email 24h, ${stats.sms_24h} SMS 24h, ${stats.email_2h} email 2h, ${stats.sms_2h} SMS 2h, ${stats.errors} errors`);
        }
      });
    } catch (e) {
      console.error('[REMINDERS CRON] Error:', e.message); Sentry.captureException(e);
    } finally {
      reminderRunning = false;
    }
  }, reminderInterval);

  // D#1 fix: cross-worker advisory lock (pg_try_advisory_lock) wraps each cron.
  // Previously only a `let xRunning = false` in-process flag protected these, which
  // means scaling to 2+ Node workers (cluster, replicas, deploy overlap) fired them
  // in parallel → double Stripe refunds, double emails, double SMS.
  // Note: withCronLock importé plus haut (ligne ~690) pour les crons waitlist + reminders.

  // ===== BOOKING CONFIRMATION CRON — auto-cancel unconfirmed bookings every 2 min =====
  const confirmInterval = parseInt(process.env.BOOKING_CONFIRM_CRON_INTERVAL_MS, 10) || 2 * 60 * 1000;
  let confirmRunning = false;
  setInterval(async () => {
    if (confirmRunning) return;
    confirmRunning = true;
    try {
      await withCronLock('confirm_cron', async () => {
        const { processExpiredPendingBookings, processAutoConfirmModifiedPending } = require('./services/booking-confirmation');
        const result = await processExpiredPendingBookings();
        if (result.processed > 0) {
          console.log(`[CONFIRM CRON] ${result.processed} unconfirmed booking(s) auto-cancelled`);
        }
        // BUG-D fix: auto-confirm modified_pending bookings ≤ 2h before start_at.
        // Staff /modify email promises "sera automatiquement confirmé" — without this,
        // modified_pending bookings stay zombie forever (reminders filter confirmed only).
        const autoConfRes = await processAutoConfirmModifiedPending();
        if (autoConfRes.confirmed > 0) {
          console.log(`[CONFIRM CRON] ${autoConfRes.confirmed} modified_pending booking(s) auto-confirmed`);
        }
      });
    } catch (e) {
      console.error('[CONFIRM CRON] Error:', e.message); Sentry.captureException(e);
    } finally {
      confirmRunning = false;
    }
  }, confirmInterval);

  // ===== DEPOSIT EXPIRY CRON — auto-cancel pending_deposit bookings past deadline every 2 min =====
  const depositInterval = parseInt(process.env.DEPOSIT_EXPIRY_CRON_INTERVAL_MS, 10) || 2 * 60 * 1000;
  let depositRunning = false;
  setInterval(async () => {
    if (depositRunning) return;
    depositRunning = true;
    try {
      await withCronLock('deposit_expiry_cron', async () => {
        const { processExpiredDeposits } = require('./services/deposit-expiry');
        const result = await processExpiredDeposits();
        if (result.processed > 0) {
          console.log(`[DEPOSIT CRON] ${result.processed} expired deposit booking(s) auto-cancelled`);
        }
      });
    } catch (e) {
      console.error('[DEPOSIT CRON] Error:', e.message); Sentry.captureException(e);
    } finally {
      depositRunning = false;
    }
  }, depositInterval);

  // ===== DEPOSIT REMINDER CRON — 48h-before-deadline email, every 10 min =====
  // C#2 fix: sendDepositReminderEmail was exported but never scheduled. Without this
  // cron, clients never received the urgent reminder and bookings auto-cancelled silently.
  const depositReminderInterval = parseInt(process.env.DEPOSIT_REMINDER_CRON_INTERVAL_MS, 10) || 10 * 60 * 1000;
  let depositReminderRunning = false;
  setInterval(async () => {
    if (depositReminderRunning) return;
    depositReminderRunning = true;
    try {
      await withCronLock('deposit_reminder_cron', async () => {
        const { processDepositReminders } = require('./services/deposit-expiry');
        const result = await processDepositReminders();
        if (result.sent > 0) {
          console.log(`[DEPOSIT REMINDER CRON] ${result.sent} reminder(s) sent`);
        }
      });
    } catch (e) {
      console.error('[DEPOSIT REMINDER CRON] Error:', e.message); Sentry.captureException(e);
    } finally {
      depositReminderRunning = false;
    }
  }, depositReminderInterval);

  // ===== GIFT CARD EXPIRY CRON — expire old gift cards every hour =====
  let gcRunning = false;
  setInterval(async () => {
    if (gcRunning) return;
    gcRunning = true;
    try {
      await withCronLock('giftcard_expiry_cron', async () => {
        const { processExpiredGiftCards, processGiftCardExpiryWarnings } = require('./services/giftcard-expiry');
        const result = await processExpiredGiftCards();
        if (result.processed > 0) {
          console.log(`[GC CRON] ${result.processed} gift card(s) expired`);
        }
        const warnResult = await processGiftCardExpiryWarnings();
        if (warnResult.processed > 0) {
          console.log(`[GC CRON] ${warnResult.processed} J-7 expiry warning(s) sent`);
        }
      });
    } catch (e) {
      console.error('[GC CRON] Error:', e.message); Sentry.captureException(e);
    } finally {
      gcRunning = false;
    }
  }, 60 * 60 * 1000); // Every hour

  // ===== PASS EXPIRY CRON — expire active passes past expires_at every hour =====
  let passExpiryRunning = false;
  setInterval(async () => {
    if (passExpiryRunning) return;
    passExpiryRunning = true;
    try {
      await withCronLock('pass_expiry_cron', async () => {
        const { processExpiredPasses, processPassExpiryWarnings } = require('./services/pass-expiry');
        const result = await processExpiredPasses();
        if (result.processed > 0) console.log(`[PASS CRON] ${result.processed} pass(es) expired`);
        const warnResult = await processPassExpiryWarnings();
        if (warnResult.processed > 0) console.log(`[PASS CRON] ${warnResult.processed} J-7 expiry warning(s) sent`);
      });
    } catch (e) { console.error('[PASS CRON] Error:', e.message); Sentry.captureException(e); }
    finally { passExpiryRunning = false; }
  }, 60 * 60 * 1000);

  // ===== NOTIFICATION PROCESSOR CRON — send queued pro notifications every 30s =====
  const notifInterval = parseInt(process.env.NOTIF_CRON_INTERVAL_MS, 10) || 30 * 1000;
  let notifRunning = false;
  setInterval(async () => {
    if (notifRunning) return;
    notifRunning = true;
    try {
      await withCronLock('notif_processor_cron', async () => {
        const { processNotifications } = require('./services/notification-processor');
        const stats = await processNotifications();
        if (stats.processed > 0) {
          console.log(`[NOTIF CRON] ${stats.sent} sent, ${stats.failed} failed, ${stats.errors} errors (${stats.processed} processed)`);
        }
      });
    } catch (e) {
      console.error('[NOTIF CRON] Error:', e.message); Sentry.captureException(e);
    } finally {
      notifRunning = false;
    }
  }, notifInterval);

  // ===== FEATURED SLOTS CLEANUP — purge old featured slots daily =====
  setInterval(async () => {
    try {
      const result = await pool.query(
        `DELETE FROM featured_slots WHERE date < CURRENT_DATE - INTERVAL '7 days' RETURNING id`
      );
      if (result.rows.length > 0) {
        console.log(`[FEATURED CLEANUP] Purged ${result.rows.length} old featured slots`);
      }
    } catch (e) {
      console.error('[FEATURED CLEANUP] Error:', e.message); Sentry.captureException(e);
    }
  }, 24 * 60 * 60 * 1000); // 24h

  // ===== SLOT CALIBRATION CRON — nightly recalibration of slot granularity from booking data =====
  const calibrationInterval = 24 * 60 * 60 * 1000; // 24h
  let calibrationRunning = false;
  setInterval(async () => {
    if (calibrationRunning) return;
    calibrationRunning = true;
    try {
      const { calibrateAllBusinesses } = require('./services/slot-optimizer');
      await calibrateAllBusinesses((sql, params) => pool.query(sql, params));
    } catch (e) {
      console.error('[SLOT CALIBRATION] Error:', e.message); Sentry.captureException(e);
    } finally {
      calibrationRunning = false;
    }
  }, calibrationInterval);

  // ===== STRIPE WEBHOOK EVENTS CLEANUP — delete rows older than 30 days daily =====
  // BUG-STRIPE-SWE-CLEANUP fix: Stripe retry window is max 3 days, donc 30j couvre largement.
  // Sans cleanup, la table croît indéfiniment (10-50k rows/an sur prod moyenne).
  const stripeWebhookCleanupInterval = 24 * 60 * 60 * 1000; // 24h
  let stripeWebhookCleanupRunning = false;
  setInterval(async () => {
    if (stripeWebhookCleanupRunning) return;
    stripeWebhookCleanupRunning = true;
    try {
      const r = await pool.query(`DELETE FROM stripe_webhook_events WHERE processed_at < NOW() - INTERVAL '30 days'`);
      if (r.rowCount > 0) console.log(`[SWE CLEANUP] Deleted ${r.rowCount} old webhook event(s)`);
    } catch (e) {
      console.error('[SWE CLEANUP] Error:', e.message); Sentry.captureException(e);
    } finally {
      stripeWebhookCleanupRunning = false;
    }
  }, stripeWebhookCleanupInterval);
});

module.exports = app;
