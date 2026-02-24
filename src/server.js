require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const path = require('path');

const { pool } = require('./services/db');
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
const twilioWebhooks = require('./routes/webhooks/twilio');

const app = express();
const PORT = process.env.PORT || 3000;

// ===== MIDDLEWARE =====
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors({
  origin: process.env.NODE_ENV === 'production'
    ? ['https://bookt.be', 'https://www.bookt.be']
    : '*',
  credentials: true
}));

// Twilio webhooks need raw body for signature validation
// so we parse them differently
app.use('/webhooks/twilio', express.urlencoded({ extended: false }));
app.use(express.json({ limit: '1mb' }));

// Static files (frontend dashboard + client booking pages)
app.use(express.static(path.join(__dirname, '../public')));

// ===== FRONTEND PAGE ROUTES =====
// Serve HTML pages for direct URL access
app.get('/', (req, res) => res.sendFile(path.join(__dirname, '../public/index.html')));
app.get('/login', (req, res) => res.sendFile(path.join(__dirname, '../public/login.html')));
app.get('/signup', (req, res) => res.sendFile(path.join(__dirname, '../public/signup.html')));
app.get('/dashboard', (req, res) => res.sendFile(path.join(__dirname, '../public/dashboard.html')));

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

// Webhooks (Twilio)
app.use('/webhooks/twilio', twilioWebhooks);

// ===== ERROR HANDLER =====
app.use(errorHandler);

// ===== START =====
app.listen(PORT, () => {
  console.log(`\n  🟢 Bookt server running on port ${PORT}`);
  console.log(`  📊 Dashboard: http://localhost:${PORT}`);
  console.log(`  📅 Public booking: http://localhost:${PORT}/api/public/:slug\n`);
});

module.exports = app;
