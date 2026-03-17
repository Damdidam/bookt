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
const callRoutes = require('./routes/staff/calls');
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
const businessHoursRoutes = require('./routes/staff/business-hours');
const reviewRoutes = require('./routes/staff/reviews');
const twilioWebhooks = require('./routes/webhooks/twilio');
const stripeRoutes = require('./routes/staff/stripe');
const { handleStripeWebhook } = require('./routes/staff/stripe');

const app = express();
const PORT = process.env.PORT || 3000;

// ===== MIDDLEWARE =====
// Trust proxy (Render, Railway, etc.)
app.set('trust proxy', 1);

// H1: CSP enabled — restrict script/style sources
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", "https://js.stripe.com"],
      scriptSrcAttr: ["'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      imgSrc: ["'self'", "data:", "https:", "blob:"],
      connectSrc: ["'self'", "https://api.stripe.com"],
      fontSrc: ["'self'", "data:", "https://fonts.gstatic.com"],
      frameSrc: ["https://js.stripe.com", "https://maps.google.com", "https://www.google.com"],
      objectSrc: ["'none'"],
      baseUri: ["'self'"]
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

app.use(express.json({ limit: '5mb' }));
app.use(express.urlencoded({ extended: false }));

// Serve api-client ES module (single source of truth for all pages)
app.get('/js/api-client.js', (req, res) => {
  res.type('application/javascript');
  res.sendFile(path.join(__dirname, 'frontend/api-client.js'));
});


// Redirect .html to clean URLs (must be BEFORE static middleware)
app.get('/dashboard.html', (req, res) => res.redirect(301, '/dashboard'));
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
app.use(express.static(path.join(__dirname, '../public'), { maxAge: '1h' }));

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

// Staff API (auth required — dashboard)
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/bookings', bookingsRoutes);
app.use('/api/services', servicesRoutes);
app.use('/api/clients', clientsRoutes);
app.use('/api/availabilities', availabilityRoutes);
app.use('/api/business', settingsRoutes);
app.use('/api/calls', callRoutes);
app.use('/api/site', siteRoutes);
app.use('/api/practitioners', practitionerRoutes);
app.use('/api/invoices', invoiceRoutes);
app.use('/api/deposits', depositRoutes);
app.use('/api/calendar', calendarRoutes);
app.use('/api/waitlist', waitlistRoutes);
app.use('/api/gallery', galleryRoutes);
app.use('/api/realisations', realisationsRoutes);
app.use('/api/news', newsRoutes);
app.use('/api/reviews', reviewRoutes);
app.use('/api/featured-slots', featuredSlotsRoutes);
app.use('/api/planning', planningRoutes);
app.use('/api/tasks', taskRoutes);
app.use('/api/business-hours', requireAuth, businessHoursRoutes);
app.use('/api/stripe', stripeRoutes);

// Webhooks (Twilio)
app.use('/webhooks/twilio', twilioWebhooks);

// ===== PUBLIC MINI-SITE =====
// Catch-all for /:slug → DB lookup → serve the right template
// Must be AFTER all API and static routes

function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

app.get('/:slug', async (req, res, next) => {
  // Skip if it looks like a file request
  if (req.params.slug.includes('.')) return next();
  // Skip known paths
  const reserved = ['api', 'webhooks', 'health', 'login', 'signup', 'dashboard'];
  if (reserved.includes(req.params.slug)) return next();

  try {
    const { rows } = await pool.query(
      `SELECT name, tagline, description, logo_url, cover_image_url, seo_title, seo_description, theme->>'preset' as preset FROM businesses WHERE slug = $1 AND is_active = true LIMIT 1`,
      [req.params.slug]
    );

    let biz = rows.length > 0 ? rows[0] : null;

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

// /:slug/book → booking flow
app.get('/:slug/book', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/book.html'));
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
  console.log(`  <svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="20" x2="12" y2="10"/><line x1="18" y1="20" x2="18" y2="4"/><line x1="6" y1="20" x2="6" y2="16"/></svg> Dashboard: http://localhost:${PORT}`);
  console.log(`  Public booking: http://localhost:${PORT}/api/public/:slug\n`);

  // ===== WAITLIST CRON — check expired offers every 5 min =====
  // SVC-V11-11: Interval could be made configurable via WAITLIST_CRON_INTERVAL_MS env var
  const waitlistInterval = parseInt(process.env.WAITLIST_CRON_INTERVAL_MS, 10) || 5 * 60 * 1000;
  let waitlistRunning = false;
  setInterval(async () => {
    if (waitlistRunning) return;
    waitlistRunning = true;
    try {
      const { processExpiredOffers } = require('./services/waitlist');
      const result = await processExpiredOffers();
      if (result.processed > 0) {
        console.log(`[WAITLIST CRON] ${result.processed} expired offer(s) processed`);
      }
    } catch (e) {
      console.error('[WAITLIST CRON] Error:', e.message);
    } finally {
      waitlistRunning = false;
    }
  }, waitlistInterval);

  // ===== REMINDERS CRON — send patient reminders every 10 min =====
  // SVC-V11-11: Interval could be made configurable via REMINDER_CRON_INTERVAL_MS env var
  const reminderInterval = parseInt(process.env.REMINDER_CRON_INTERVAL_MS, 10) || 10 * 60 * 1000;
  let reminderRunning = false;
  setInterval(async () => {
    if (reminderRunning) return;
    reminderRunning = true;
    try {
      const { processReminders } = require('./services/reminders');
      const stats = await processReminders();
      const total = stats.email_24h + stats.sms_24h + stats.email_2h + stats.sms_2h;
      if (total > 0) {
        console.log(`[REMINDERS CRON] ${stats.email_24h} email 24h, ${stats.sms_24h} SMS 24h, ${stats.email_2h} email 2h, ${stats.sms_2h} SMS 2h, ${stats.errors} errors`);
      }
    } catch (e) {
      console.error('[REMINDERS CRON] Error:', e.message);
    } finally {
      reminderRunning = false;
    }
  }, reminderInterval);

  // ===== BOOKING CONFIRMATION CRON — auto-cancel unconfirmed bookings every 2 min =====
  const confirmInterval = parseInt(process.env.BOOKING_CONFIRM_CRON_INTERVAL_MS, 10) || 2 * 60 * 1000;
  let confirmRunning = false;
  setInterval(async () => {
    if (confirmRunning) return;
    confirmRunning = true;
    try {
      const { processExpiredPendingBookings } = require('./services/booking-confirmation');
      const result = await processExpiredPendingBookings();
      if (result.processed > 0) {
        console.log(`[CONFIRM CRON] ${result.processed} unconfirmed booking(s) auto-cancelled`);
      }
    } catch (e) {
      console.error('[CONFIRM CRON] Error:', e.message);
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
      const { processExpiredDeposits } = require('./services/deposit-expiry');
      const result = await processExpiredDeposits();
      if (result.processed > 0) {
        console.log(`[DEPOSIT CRON] ${result.processed} expired deposit booking(s) auto-cancelled`);
      }
    } catch (e) {
      console.error('[DEPOSIT CRON] Error:', e.message);
    } finally {
      depositRunning = false;
    }
  }, depositInterval);

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
      console.error('[SLOT CALIBRATION] Error:', e.message);
    } finally {
      calibrationRunning = false;
    }
  }, calibrationInterval);
});

module.exports = app;
