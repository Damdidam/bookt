/**
 * Misc public routes — reviews, guide, public reviews list.
 * Extracted from index.js (Phase 4 refactoring).
 */
const router = require('express').Router();
const { query } = require('../../services/db');
const { bookingActionLimiter } = require('../../middleware/rate-limiter');

// ─── Review submission page ─────────────────────────────────────────
// P1 rate limiter : endpoint public avec token → protège contre scrape/DoS aveugle.
router.get('/review/:token', bookingActionLimiter, async (req, res, next) => {
  try {
    const { token } = req.params;
    const existing = await query(
      `SELECT r.id, r.rating, r.comment, r.created_at, r.updated_at,
              b.business_id, biz.name as business_name, biz.settings,
              s.name as service_name, sv.name as variant_name,
              p.display_name as practitioner_name
       FROM reviews r
       JOIN bookings b ON b.id = r.booking_id
       JOIN businesses biz ON biz.id = r.business_id
       LEFT JOIN services s ON s.id = b.service_id
       LEFT JOIN service_variants sv ON sv.id = b.service_variant_id
       LEFT JOIN practitioners p ON p.id = b.practitioner_id
       WHERE r.token = $1`,
      [token]
    );
    if (existing.rows.length > 0) {
      const row = existing.rows[0];
      return res.json({
        already_submitted: true,
        review: { rating: row.rating, comment: row.comment, created_at: row.created_at, updated_at: row.updated_at },
        business_name: row.business_name,
        service_name: row.variant_name ? `${row.service_name} — ${row.variant_name}` : row.service_name,
        practitioner_name: row.practitioner_name,
        primary_color: row.settings?.theme?.primary_color || '#6B5E54'
      });
    }
    const bk = await query(
      `SELECT b.id, b.business_id, b.service_id, b.service_variant_id, b.practitioner_id, b.client_id,
              b.start_at, b.review_token,
              biz.name as business_name, biz.settings,
              s.name as service_name, sv.name as variant_name,
              p.display_name as practitioner_name,
              SPLIT_PART(c.full_name, ' ', 1) as client_first_name
       FROM bookings b
       JOIN businesses biz ON biz.id = b.business_id
       LEFT JOIN services s ON s.id = b.service_id
       LEFT JOIN service_variants sv ON sv.id = b.service_variant_id
       LEFT JOIN practitioners p ON p.id = b.practitioner_id
       LEFT JOIN clients c ON c.id = b.client_id
       WHERE b.review_token = $1 AND b.status = 'completed'`,
      [token]
    );
    if (bk.rows.length === 0) return res.status(404).json({ error: 'Lien invalide ou expiré' });
    const b = bk.rows[0];
    res.json({
      already_submitted: false,
      business_name: b.business_name,
      service_name: b.variant_name ? `${b.service_name} — ${b.variant_name}` : b.service_name,
      practitioner_name: b.practitioner_name,
      client_first_name: b.client_first_name,
      appointment_date: b.start_at,
      primary_color: b.settings?.theme?.primary_color || '#6B5E54'
    });
  } catch (err) { next(err); }
});

// ─── Submit a review ────────────────────────────────────────────────
const { bookingLimiter } = require('../../middleware/rate-limiter');
router.post('/review/:token', bookingLimiter, async (req, res, next) => {
  try {
    const { token } = req.params;
    const { rating, comment } = req.body;
    const r = parseInt(rating);
    if (!r || r < 1 || r > 5) return res.status(400).json({ error: 'Note invalide (1-5)' });
    const safeComment = (comment || '').replace(/<[^>]*>/g, '').trim().substring(0, 1000);
    const bk = await query(
      `SELECT id, business_id, client_id, practitioner_id, review_token
       FROM bookings WHERE review_token = $1 AND status = 'completed'`,
      [token]
    );
    if (bk.rows.length === 0) return res.status(404).json({ error: 'Lien invalide ou expiré' });
    const b = bk.rows[0];
    const dup = await query(`SELECT id FROM reviews WHERE booking_id = $1`, [b.id]);
    if (dup.rows.length > 0) {
      const upd = await query(
        `UPDATE reviews SET rating = $1, comment = $2, updated_at = NOW() WHERE booking_id = $3 RETURNING *`,
        [r, safeComment, b.id]
      );
      return res.json({ review: upd.rows[0], updated: true });
    }
    const result = await query(
      `INSERT INTO reviews (business_id, booking_id, client_id, practitioner_id, rating, comment, token)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [b.business_id, b.id, b.client_id, b.practitioner_id, r, safeComment, token]
    );
    res.json({ review: result.rows[0], created: true });
  } catch (err) { next(err); }
});

// ─── Public guide ───────────────────────────────────────────────────
router.get('/:slug/guide', bookingActionLimiter, async (req, res, next) => {
  try {
    const { slug } = req.params;
    const biz = await query(
      `SELECT id, name, slug, plan, settings, logo_url, sector, category,
              theme->>'primary' AS primary_color
       FROM businesses WHERE slug = $1 AND is_active = true LIMIT 1`,
      [slug]
    );
    if (biz.rows.length === 0) return res.status(404).json({ error: 'Salon introuvable' });
    const b = biz.rows[0];
    const s = b.settings || {};
    res.json({
      business: {
        name: b.name, slug: b.slug, logo_url: b.logo_url,
        primary_color: b.primary_color || '#0D7377', sector: b.sector || 'autre'
      },
      flows: {
        confirmation_required: !!s.booking_confirmation_required,
        confirmation_timeout_min: s.booking_confirmation_timeout_min || 30,
        deposit_enabled: !!s.deposit_enabled,
        deposit_type: s.deposit_type || 'percent',
        deposit_percent: s.deposit_percent || 50,
        deposit_fixed_cents: s.deposit_fixed_cents || 2500,
        deposit_price_threshold_cents: s.deposit_price_threshold_cents || 0,
        deposit_duration_threshold_min: s.deposit_duration_threshold_min || 0,
        deposit_threshold_mode: s.deposit_threshold_mode || 'any',
        deposit_deadline_hours: s.deposit_deadline_hours ?? 48,
        deposit_noshow_threshold: s.deposit_noshow_threshold || 2,
        cancel_deadline_hours: s.cancel_deadline_hours ?? s.cancellation_window_hours ?? 24,
        cancel_policy_text: s.cancel_policy_text || null,
        reschedule_max_count: s.reschedule_max_count ?? 1,
        reschedule_window_days: s.reschedule_window_days ?? 30,
        reminder_email_24h: s.reminder_email_24h !== false,
        reminder_sms_24h: !!s.reminder_sms_24h,
        reminder_sms_2h: !!s.reminder_sms_2h,
        giftcard_enabled: !!s.giftcard_enabled,
        passes_enabled: !!s.passes_enabled,
        multi_service_enabled: !!s.multi_service_enabled,
        waitlist_enabled: !!s.waitlist_enabled,
        last_minute_enabled: (b.plan || 'free') !== 'free' && !!s.last_minute_enabled,
        last_minute_discount_pct: (b.plan || 'free') !== 'free' ? (s.last_minute_discount_pct || 0) : 0,
        last_minute_deadline: s.last_minute_deadline || 'j-1',
        payment_methods: s.payment_methods || []
      }
    });
  } catch (err) { next(err); }
});

// ─── Public reviews for minisite ────────────────────────────────────
router.get('/:slug/reviews', bookingActionLimiter, async (req, res, next) => {
  try {
    const { slug } = req.params;
    const biz = await query(`SELECT id FROM businesses WHERE slug = $1`, [slug]);
    if (biz.rows.length === 0) return res.status(404).json({ error: 'Établissement introuvable' });
    const bid = biz.rows[0].id;
    const reviews = await query(
      `SELECT r.rating, r.comment, r.owner_reply, r.owner_reply_at, r.created_at,
              SPLIT_PART(c.full_name, ' ', 1) as first_name, LEFT(SPLIT_PART(c.full_name, ' ', 2), 1) as last_initial,
              p.display_name as practitioner_name
       FROM reviews r
       LEFT JOIN clients c ON c.id = r.client_id
       LEFT JOIN practitioners p ON p.id = r.practitioner_id
       WHERE r.business_id = $1 AND r.status = 'published'
       ORDER BY r.created_at DESC LIMIT 50`,
      [bid]
    );
    const stats = await query(
      `SELECT COUNT(*)::int as total, ROUND(AVG(rating)::numeric, 1)::float as average
       FROM reviews WHERE business_id = $1 AND status = 'published'`,
      [bid]
    );
    res.json({ reviews: reviews.rows, stats: stats.rows[0] || { total: 0, average: 0 } });
  } catch (err) { next(err); }
});

module.exports = router;
