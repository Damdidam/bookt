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
const documentRoutes = require('./routes/staff/documents');
const calendarRoutes = require('./routes/staff/calendar');
const waitlistRoutes = require('./routes/staff/waitlist');
const whiteboardRoutes = require('./routes/staff/whiteboards');
const galleryRoutes = require('./routes/staff/gallery');
const newsRoutes = require('./routes/staff/news');
const preRdvCron = require('./routes/cron/pre-rdv');
const twilioWebhooks = require('./routes/webhooks/twilio');
const stripeRoutes = require('./routes/staff/stripe');
const { handleStripeWebhook } = require('./routes/staff/stripe');

const app = express();
const PORT = process.env.PORT || 3000;

// ===== MIDDLEWARE =====
// Trust proxy (Render, Railway, etc.)
app.set('trust proxy', 1);

app.use(helmet({
  contentSecurityPolicy: false,
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

// Serve api-client ES module (single source of truth for all pages)
app.get('/js/api-client.js', (req, res) => {
  res.type('application/javascript');
  res.sendFile(path.join(__dirname, 'frontend/api-client.js'));
});


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
    res.status(500).json({ status: 'error', db: 'disconnected', error: err.message });
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

  addClient(req.businessId, res);

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
app.use('/api/documents', documentRoutes);
app.use('/api/calendar', calendarRoutes);
app.use('/api/waitlist', waitlistRoutes);
app.use('/api/whiteboards', whiteboardRoutes);
app.use('/api/gallery', galleryRoutes);
app.use('/api/news', newsRoutes);
app.use('/api/stripe', stripeRoutes);
app.use('/api/cron', preRdvCron);

// Webhooks (Twilio)
app.use('/webhooks/twilio', twilioWebhooks);

// ===== PUBLIC MINI-SITE =====
// Catch-all for /:slug → serve site.html (the dynamic mini-site page)
// Must be AFTER all API and static routes
app.get('/:slug', (req, res, next) => {
  // Skip if it looks like a file request
  if (req.params.slug.includes('.')) return next();
  // Skip known paths
  const reserved = ['api', 'webhooks', 'health', 'login', 'signup', 'dashboard'];
  if (reserved.includes(req.params.slug)) return next();
  // Serve the dynamic mini-site page
  res.sendFile(path.join(__dirname, '../public/site.html'));
});

// /:slug/book → booking flow
app.get('/:slug/book', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/book.html'));
});

// /booking/:token → manage booking (cancel/reschedule)
app.get('/booking/:token', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/manage-booking.html'));
});

// /docs/:token → pre-RDV document / form
app.get('/docs/:token', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/pre-rdv.html'));
});

// /whiteboard/:id → staff whiteboard editor
app.get('/whiteboard/:id', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/whiteboard.html'));
});

// /wb/:token → public shared whiteboard view (read-only)
app.get('/wb/:token', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/wb-view.html'));
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
app.listen(PORT, () => {
  console.log(`\n  Genda server running on port ${PORT}`);
  console.log(`  <svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="20" x2="12" y2="10"/><line x1="18" y1="20" x2="18" y2="4"/><line x1="6" y1="20" x2="6" y2="16"/></svg> Dashboard: http://localhost:${PORT}`);
  console.log(`  Public booking: http://localhost:${PORT}/api/public/:slug\n`);

  // ===== WAITLIST CRON — check expired offers every 5 min =====
  setInterval(async () => {
    try {
      const { processExpiredOffers } = require('./services/waitlist');
      const result = await processExpiredOffers();
      if (result.processed > 0) {
        console.log(`[WAITLIST CRON] ${result.processed} expired offer(s) processed`);
      }
    } catch (e) {
      console.error('[WAITLIST CRON] Error:', e.message);
    }
  }, 5 * 60 * 1000); // 5 minutes

  // ===== REMINDERS CRON — send patient reminders every 10 min =====
  setInterval(async () => {
    try {
      const { processReminders } = require('./services/reminders');
      const stats = await processReminders();
      const total = stats.email_24h + stats.sms_24h + stats.email_2h + stats.sms_2h;
      if (total > 0) {
        console.log(`[REMINDERS CRON] ${stats.email_24h} email 24h, ${stats.sms_24h} SMS 24h, ${stats.sms_2h} SMS 2h, ${stats.errors} errors`);
      }
    } catch (e) {
      console.error('[REMINDERS CRON] Error:', e.message);
    }
  }, 10 * 60 * 1000); // 10 minutes
});

module.exports = app;
