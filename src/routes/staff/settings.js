const router = require('express').Router();
const { query, queryWithRLS } = require('../../services/db');
const { requireAuth, requireOwner, blockIfImpersonated } = require('../../middleware/auth');
const { sanitizeRichText } = require('../../services/email-utils');
const { invalidateMinisiteCache } = require('../public/helpers');

// V11-025: Strip HTML tags from text fields to prevent injection
function stripHtml(str) {
  if (!str || typeof str !== 'string') return str;
  return str.replace(/<[^>]*>/g, '').trim();
}

router.use(requireAuth);
// H7 fix: drop minisite cache after any successful mutation here (description rich-text,
// theme, hours, logo, social links, page_sections, etc. sont tous rendus sur le minisite public).
// Pattern identique à staff/services.js:8-13.
router.use((req, res, next) => {
  if (['POST', 'PATCH', 'PUT', 'DELETE'].includes(req.method)) {
    res.on('finish', () => { if (res.statusCode < 400 && req.businessId) invalidateMinisiteCache(req.businessId); });
  }
  next();
});

// GET /api/business — full business details
// UI: Settings page (all cards)
router.get('/', async (req, res, next) => {
  try {
    const result = await queryWithRLS(req.businessId,
      `SELECT * FROM businesses WHERE id = $1`,
      [req.businessId]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Salon introuvable' });

    const business = result.rows[0];

    // V11-016: Filter sensitive settings for non-owner roles
    if (req.user.role !== 'owner' && business.settings) {
      const filtered = { ...business.settings };
      delete filtered.iban;
      delete filtered.bic;
      delete filtered.invoice_footer;
      business.settings = filtered;
    }

    res.json({ business });
  } catch (err) {
    next(err);
  }
});

// PATCH /api/business — update business info
// UI: Settings > Salon form + Onboarding bio step
router.patch('/', requireOwner, async (req, res, next) => {
  try {
    const bid = req.businessId;
    const {
      name, slug, phone, email, address, street, street_number, postal_code, city,
      language_default, settings,
      // V2 fields
      tagline, description, logo_url, cover_image_url,
      founded_year, accreditation, bce_number, parking_info,
      languages_spoken, social_links, page_sections, seo_title, seo_description, theme,
      // V3 invoice settings (merged into settings JSONB)
      settings_iban, settings_bic, settings_invoice_footer,
      // V7.1 no-show settings
      settings_noshow_threshold, settings_noshow_action,
      // V12 overlap policy
      settings_allow_overlap,
      // V20 reminder settings
      settings_reminder_email_24h, settings_reminder_sms_24h,
      settings_reminder_sms_2h, settings_reminder_email_2h,
      // V23 deposit settings
      settings_deposit_enabled, settings_deposit_noshow_threshold,
      settings_deposit_type, settings_deposit_percent,
      settings_deposit_fixed_cents, settings_deposit_deadline_hours,
      settings_deposit_message, settings_deposit_deduct,
      settings_deposit_price_threshold_cents, settings_deposit_duration_threshold_min, settings_deposit_threshold_mode,
      // V23b cancellation policy
      settings_cancel_deadline_hours, settings_cancel_grace_minutes, settings_cancel_policy_text,
      // Refund & abuse protection
      settings_refund_policy, settings_cancel_abuse_enabled, settings_cancel_abuse_max,
      // Multi-service booking
      settings_multi_service_enabled,
      // Calendar settings (business-level)
      settings_slot_increment_min, settings_waitlist_mode, settings_calendar_color_mode, settings_slot_auto_optimize,
      // Booking page settings
      settings_practitioner_choice_enabled,
      // Booking confirmation
      settings_booking_confirmation_required, settings_booking_confirmation_timeout, settings_booking_confirmation_channel,
      // Pro notifications
      settings_notify_new_booking_pro,
      // Gap analyzer
      settings_gap_analyzer_enabled,
      // Featured slots (mode vedette)
      settings_featured_slots_enabled,
      // Last-minute promotions
      settings_last_minute_enabled, settings_last_minute_deadline,
      settings_last_minute_discount_pct, settings_last_minute_min_price_cents,
      // Default calendar view
      settings_default_calendar_view,
      // Payment methods accepted on-site
      settings_payment_methods,
      // Reviews settings
      settings_reviews_enabled, settings_review_delay_hours, settings_review_auto_publish,
      // Minisite template
      settings_minisite_template,
      // Minisite test mode
      settings_minisite_test_mode, settings_minisite_test_password,
      // Client reschedule
      settings_reschedule_enabled, settings_reschedule_deadline_hours,
      settings_reschedule_max_count, settings_reschedule_window_days,
      // Gift cards
      settings_giftcard_enabled, settings_giftcard_amounts, settings_giftcard_custom_amount,
      settings_giftcard_min_amount_cents, settings_giftcard_max_amount_cents, settings_giftcard_expiry_days,
      // Passes
      settings_passes_enabled, settings_pass_validity_days,
      // Sector
      sector
    } = req.body;

    // Plan guards: block Pro-only settings on free plan
    if (req.businessPlan === 'free' && settings_last_minute_enabled === true) {
      return res.status(403).json({ error: 'upgrade_required', message: 'Les promotions last-minute sont disponibles avec le plan Pro.' });
    }
    if (req.businessPlan === 'free' && settings_deposit_enabled === true) {
      return res.status(403).json({ error: 'upgrade_required', message: 'Les acomptes sont disponibles avec le plan Pro.' });
    }
    if (req.businessPlan === 'free' && req.body.settings_giftcard_enabled === true) {
      return res.status(403).json({ error: 'upgrade_required', message: 'Les cartes cadeau sont disponibles avec le plan Pro.' });
    }
    if (req.businessPlan === 'free' && req.body.settings_passes_enabled === true) {
      return res.status(403).json({ error: 'upgrade_required', message: 'Les abonnements sont disponibles avec le plan Pro.' });
    }
    if (req.businessPlan === 'free' && req.body.settings_gap_analyzer_enabled === true) {
      return res.status(403).json({ error: 'upgrade_required', message: 'Le gap analyzer est disponible avec le plan Pro.' });
    }

    // Merge individual settings fields into settings JSONB
    let mergedSettings = settings || null;
    if (settings_iban !== undefined || settings_bic !== undefined || settings_invoice_footer !== undefined
        || settings_noshow_threshold !== undefined || settings_noshow_action !== undefined
        || settings_allow_overlap !== undefined
        || settings_reminder_email_24h !== undefined || settings_reminder_sms_24h !== undefined
        || settings_reminder_sms_2h !== undefined || settings_reminder_email_2h !== undefined
        || settings_deposit_enabled !== undefined || settings_deposit_noshow_threshold !== undefined
        || settings_deposit_type !== undefined || settings_deposit_percent !== undefined
        || settings_deposit_fixed_cents !== undefined || settings_deposit_deadline_hours !== undefined
        || settings_deposit_message !== undefined || settings_deposit_deduct !== undefined
        || settings_cancel_deadline_hours !== undefined || settings_cancel_grace_minutes !== undefined
        || settings_cancel_policy_text !== undefined
        || settings_refund_policy !== undefined || settings_cancel_abuse_enabled !== undefined || settings_cancel_abuse_max !== undefined
        || settings_multi_service_enabled !== undefined
        || settings_slot_increment_min !== undefined || settings_waitlist_mode !== undefined || settings_calendar_color_mode !== undefined || settings_slot_auto_optimize !== undefined
        || settings_practitioner_choice_enabled !== undefined
        || settings_booking_confirmation_required !== undefined || settings_booking_confirmation_timeout !== undefined
        || settings_booking_confirmation_channel !== undefined
        || settings_notify_new_booking_pro !== undefined
        || settings_gap_analyzer_enabled !== undefined
        || settings_featured_slots_enabled !== undefined
        || settings_last_minute_enabled !== undefined || settings_last_minute_deadline !== undefined
        || settings_last_minute_discount_pct !== undefined || settings_last_minute_min_price_cents !== undefined
        || settings_default_calendar_view !== undefined
        || settings_payment_methods !== undefined
        || settings_reviews_enabled !== undefined || settings_review_delay_hours !== undefined || settings_review_auto_publish !== undefined
        || settings_minisite_template !== undefined
        || settings_minisite_test_mode !== undefined || settings_minisite_test_password !== undefined
        || settings_reschedule_enabled !== undefined || settings_reschedule_deadline_hours !== undefined
        || settings_reschedule_max_count !== undefined || settings_reschedule_window_days !== undefined
        || settings_giftcard_enabled !== undefined || settings_giftcard_amounts !== undefined
        || settings_giftcard_custom_amount !== undefined || settings_giftcard_min_amount_cents !== undefined
        || settings_giftcard_max_amount_cents !== undefined || settings_giftcard_expiry_days !== undefined
        || settings_passes_enabled !== undefined || settings_pass_validity_days !== undefined) {
      // Fetch current settings first
      const current = await queryWithRLS(bid, `SELECT settings FROM businesses WHERE id = $1`, [bid]);
      const cur = current.rows[0]?.settings || {};
      if (settings_iban !== undefined) cur.iban = settings_iban;
      if (settings_bic !== undefined) cur.bic = settings_bic;
      if (settings_invoice_footer !== undefined) cur.invoice_footer = settings_invoice_footer;
      if (settings_noshow_threshold !== undefined) cur.noshow_block_threshold = parseInt(settings_noshow_threshold);
      if (settings_noshow_action !== undefined) cur.noshow_block_action = settings_noshow_action;
      if (settings_allow_overlap !== undefined) cur.allow_overlap = !!settings_allow_overlap;
      if (settings_reminder_email_24h !== undefined) cur.reminder_email_24h = !!settings_reminder_email_24h;
      if (settings_reminder_sms_24h !== undefined) cur.reminder_sms_24h = !!settings_reminder_sms_24h;
      if (settings_reminder_sms_2h !== undefined) cur.reminder_sms_2h = !!settings_reminder_sms_2h;
      if (settings_reminder_email_2h !== undefined) cur.reminder_email_2h = !!settings_reminder_email_2h;
      // V23 deposit
      if (settings_deposit_enabled !== undefined) cur.deposit_enabled = !!settings_deposit_enabled;
      if (settings_deposit_noshow_threshold !== undefined) { const _v = parseInt(settings_deposit_noshow_threshold); cur.deposit_noshow_threshold = isNaN(_v) ? 2 : _v; }
      if (settings_deposit_type !== undefined) cur.deposit_type = settings_deposit_type;
      if (settings_deposit_percent !== undefined) { const _v = parseInt(settings_deposit_percent); cur.deposit_percent = isNaN(_v) ? 50 : Math.max(1, Math.min(100, _v)); }
      if (settings_deposit_fixed_cents !== undefined) { const _v = parseInt(settings_deposit_fixed_cents); cur.deposit_fixed_cents = isNaN(_v) ? 2500 : Math.max(50, _v); }
      if (settings_deposit_deadline_hours !== undefined) { const _v = parseInt(settings_deposit_deadline_hours); cur.deposit_deadline_hours = isNaN(_v) ? 48 : _v; }
      if (settings_deposit_message !== undefined) cur.deposit_message = stripHtml(settings_deposit_message);
      if (settings_deposit_deduct !== undefined) cur.deposit_deduct = !!settings_deposit_deduct;
      if (settings_deposit_price_threshold_cents !== undefined) { const _v = parseInt(settings_deposit_price_threshold_cents); cur.deposit_price_threshold_cents = isNaN(_v) ? 0 : _v; }
      if (settings_deposit_duration_threshold_min !== undefined) { const _v = parseInt(settings_deposit_duration_threshold_min); cur.deposit_duration_threshold_min = isNaN(_v) ? 0 : _v; }
      if (settings_deposit_threshold_mode !== undefined) cur.deposit_threshold_mode = ['any', 'both'].includes(settings_deposit_threshold_mode) ? settings_deposit_threshold_mode : 'any';
      // V23b cancellation policy
      if (settings_cancel_deadline_hours !== undefined) { const _v = parseInt(settings_cancel_deadline_hours); cur.cancel_deadline_hours = isNaN(_v) ? 24 : Math.max(0, _v); }
      if (settings_cancel_grace_minutes !== undefined) { const _v = parseInt(settings_cancel_grace_minutes); cur.cancel_grace_minutes = isNaN(_v) ? 240 : _v; }
      if (settings_cancel_policy_text !== undefined) cur.cancel_policy_text = stripHtml(settings_cancel_policy_text);
      if (settings_refund_policy !== undefined) cur.refund_policy = ['full', 'net'].includes(settings_refund_policy) ? settings_refund_policy : 'full';
      if (settings_cancel_abuse_enabled !== undefined) cur.cancel_abuse_enabled = !!settings_cancel_abuse_enabled;
      if (settings_cancel_abuse_max !== undefined) { const _v = parseInt(settings_cancel_abuse_max); cur.cancel_abuse_max = isNaN(_v) ? 5 : Math.max(2, _v); }
      // Multi-service booking
      if (settings_multi_service_enabled !== undefined) cur.multi_service_enabled = !!settings_multi_service_enabled;
      // Calendar settings
      if (settings_slot_increment_min !== undefined) { const _v = parseInt(settings_slot_increment_min); cur.slot_increment_min = [5,10,15,20,30,45,60].includes(_v) ? _v : 15; }
      if (settings_waitlist_mode !== undefined) {
        cur.waitlist_mode = ['off','manual','auto'].includes(settings_waitlist_mode) ? settings_waitlist_mode : 'off';
        // Propagate to all practitioners so the backend waitlist service picks it up
        await queryWithRLS(bid, `UPDATE practitioners SET waitlist_mode = $1 WHERE business_id = $2`, [cur.waitlist_mode, bid]).catch(() => {});
      }
      if (settings_calendar_color_mode !== undefined) { cur.calendar_color_mode = ['category','practitioner'].includes(settings_calendar_color_mode) ? settings_calendar_color_mode : 'category'; }
      if (settings_slot_auto_optimize !== undefined) { cur.slot_auto_optimize = !!settings_slot_auto_optimize; if (!settings_slot_auto_optimize) delete cur.optimized_granularity; }
      if (settings_gap_analyzer_enabled !== undefined) cur.gap_analyzer_enabled = !!settings_gap_analyzer_enabled;
      if (settings_featured_slots_enabled !== undefined) cur.featured_slots_enabled = !!settings_featured_slots_enabled;
      // Last-minute promotions
      if (settings_last_minute_enabled !== undefined) cur.last_minute_enabled = !!settings_last_minute_enabled;
      if (settings_last_minute_deadline !== undefined) { cur.last_minute_deadline = ['j-2','j-1','same_day'].includes(settings_last_minute_deadline) ? settings_last_minute_deadline : 'j-1'; }
      if (settings_last_minute_discount_pct !== undefined) { const _v = parseInt(settings_last_minute_discount_pct); cur.last_minute_discount_pct = [5,10,15,20,25].includes(_v) ? _v : 10; }
      if (settings_last_minute_min_price_cents !== undefined) { const _v = parseInt(settings_last_minute_min_price_cents); cur.last_minute_min_price_cents = (_v >= 0 && _v <= 100000) ? _v : 0; }
      // Booking page
      if (settings_practitioner_choice_enabled !== undefined) cur.practitioner_choice_enabled = !!settings_practitioner_choice_enabled;
      // Booking confirmation
      if (settings_notify_new_booking_pro !== undefined) cur.notify_new_booking_pro = !!settings_notify_new_booking_pro;
      if (settings_booking_confirmation_required !== undefined) cur.booking_confirmation_required = !!settings_booking_confirmation_required;
      if (settings_booking_confirmation_timeout !== undefined) { const _v = parseInt(settings_booking_confirmation_timeout); cur.booking_confirmation_timeout_min = (_v >= 5 && _v <= 1440) ? _v : 30; }
      if (settings_booking_confirmation_channel !== undefined) { cur.booking_confirmation_channel = ['email','sms','both'].includes(settings_booking_confirmation_channel) ? settings_booking_confirmation_channel : 'email'; }
      // Default calendar view
      if (settings_default_calendar_view !== undefined) {
        const allowed = ['day', 'week', 'month'];
        if (allowed.includes(settings_default_calendar_view)) cur.default_calendar_view = settings_default_calendar_view;
      }
      // Payment methods accepted on-site
      if (settings_payment_methods !== undefined) {
        const validMethods = ['cash', 'card', 'bancontact', 'apple_pay', 'google_pay', 'payconiq', 'instant_transfer', 'bank_transfer'];
        cur.payment_methods = Array.isArray(settings_payment_methods) ? settings_payment_methods.filter(m => validMethods.includes(m)) : [];
      }
      // Reviews
      if (settings_reviews_enabled !== undefined) cur.reviews_enabled = !!settings_reviews_enabled;
      if (settings_review_delay_hours !== undefined) { const _v = parseInt(settings_review_delay_hours); cur.review_delay_hours = (_v >= 1 && _v <= 168) ? _v : 24; }
      if (settings_review_auto_publish !== undefined) cur.review_auto_publish = !!settings_review_auto_publish;
      // Minisite template
      if (settings_minisite_template !== undefined) {
        const validTemplates = ['funky', 'epure', 'bold'];
        cur.minisite_template = validTemplates.includes(settings_minisite_template) ? settings_minisite_template : 'funky';
      }
      // Minisite test mode
      if (settings_minisite_test_mode !== undefined) {
        cur.minisite_test_mode = !!settings_minisite_test_mode;
      }
      if (settings_minisite_test_password !== undefined) {
        cur.minisite_test_password = settings_minisite_test_password || '';
      }
      // Client reschedule
      if (settings_reschedule_enabled !== undefined) cur.reschedule_enabled = !!settings_reschedule_enabled;
      if (settings_reschedule_deadline_hours !== undefined) { const _v = parseInt(settings_reschedule_deadline_hours); cur.reschedule_deadline_hours = (_v >= 1 && _v <= 720) ? _v : 24; }
      if (settings_reschedule_max_count !== undefined) { const _v = parseInt(settings_reschedule_max_count); cur.reschedule_max_count = (_v >= 1 && _v <= 10) ? _v : 1; }
      if (settings_reschedule_window_days !== undefined) { const _v = parseInt(settings_reschedule_window_days); cur.reschedule_window_days = (_v >= 7 && _v <= 90) ? _v : 30; }
      // Gift cards
      if (settings_giftcard_enabled !== undefined) cur.giftcard_enabled = !!settings_giftcard_enabled;
      if (settings_giftcard_amounts !== undefined) cur.giftcard_amounts = Array.isArray(settings_giftcard_amounts) ? settings_giftcard_amounts.filter(a => Number.isInteger(a) && a > 0) : [2500, 5000, 7500, 10000];
      if (settings_giftcard_custom_amount !== undefined) cur.giftcard_custom_amount = settings_giftcard_custom_amount !== false;
      if (settings_giftcard_min_amount_cents !== undefined) { const _v = parseInt(settings_giftcard_min_amount_cents); cur.giftcard_min_amount_cents = (_v >= 500 && _v <= 100000) ? _v : 1000; }
      if (settings_giftcard_max_amount_cents !== undefined) { const _v = parseInt(settings_giftcard_max_amount_cents); cur.giftcard_max_amount_cents = (_v >= 1000 && _v <= 100000) ? _v : 50000; }
      if (settings_giftcard_expiry_days !== undefined) { const _v = parseInt(settings_giftcard_expiry_days); cur.giftcard_expiry_days = (_v >= 30 && _v <= 730) ? _v : 365; }
      // Passes
      if (settings_passes_enabled !== undefined) cur.passes_enabled = !!settings_passes_enabled;
      if (settings_pass_validity_days !== undefined) { const _v = parseInt(settings_pass_validity_days); cur.pass_validity_days = (_v >= 30 && _v <= 730) ? _v : 365; }
      mergedSettings = cur;
    }

    // Sector validation & category derivation
    const SECTOR_TO_CAT = {
      medecin:'sante', dentiste:'sante', kine:'sante', osteopathe:'sante', bien_etre:'sante',
      massage:'sante', bienetre:'sante',
      coiffeur:'beaute', esthetique:'beaute', barbier:'beaute', onglerie:'beaute', tatouage:'beaute',
      comptable:'juridique_finance', avocat:'juridique_finance',
      photographe:'creatif', coaching:'sante',
      veterinaire:'autre', garage:'autre', autre:'autre'
    };
    let derivedCategory = null;
    if (sector !== undefined) {
      if (!SECTOR_TO_CAT[sector]) {
        return res.status(400).json({ error: 'Secteur invalide. Valeurs: ' + Object.keys(SECTOR_TO_CAT).join(', ') });
      }
      derivedCategory = SECTOR_TO_CAT[sector];
    }

    // If slug is changing, sanitise then verify uniqueness (global check, no RLS)
    if (slug) {
      const sanitizedSlug = slug.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/(^-|-$)/g, '').slice(0, 60);
      if (!sanitizedSlug || sanitizedSlug.length < 3) {
        return res.status(400).json({ error: 'Slug invalide (min 3 caractères)' });
      }
      const existing = await query(
        `SELECT id FROM businesses WHERE slug = $1 AND id != $2`,
        [sanitizedSlug, bid]
      );
      if (existing.rows.length > 0) {
        return res.status(409).json({ error: 'Ce slug est déjà pris' });
      }
      // Use sanitized slug for the update (override local ref below)
      req.body.slug = sanitizedSlug;
    }
    // Re-read slug after potential sanitization
    const finalSlug = req.body.slug;

    // Pass languages_spoken as a proper array for PG
    let langArray = null;
    if (languages_spoken) {
      if (Array.isArray(languages_spoken)) {
        langArray = languages_spoken;
      } else if (typeof languages_spoken === 'string') {
        langArray = languages_spoken.replace(/[{}]/g, '').split(',').map(s => s.trim()).filter(Boolean);
      }
    }

    // Recompose address from structured fields if provided
    const composedAddr = (street || street_number || postal_code || city)
      ? ([street, street_number].filter(Boolean).join(' ')
        + ([street, street_number].some(Boolean) && [postal_code, city].some(Boolean) ? ', ' : '')
        + [postal_code, city].filter(Boolean).join(' ')).trim() || null
      : null;
    const finalAddress = composedAddr || address || null;

    const result = await queryWithRLS(bid,
      `UPDATE businesses SET
        name = COALESCE($1, name),
        slug = COALESCE($2, slug),
        phone = COALESCE($3, phone),
        email = COALESCE($4, email),
        address = COALESCE($5, address),
        street = COALESCE($6, street),
        street_number = COALESCE($7, street_number),
        postal_code = COALESCE($8, postal_code),
        city = COALESCE($9, city),
        language_default = COALESCE($10, language_default),
        settings = COALESCE($11::jsonb, settings),
        tagline = COALESCE($12, tagline),
        description = COALESCE($13, description),
        logo_url = COALESCE($14, logo_url),
        cover_image_url = COALESCE($15, cover_image_url),
        founded_year = COALESCE($16, founded_year),
        accreditation = COALESCE($17, accreditation),
        bce_number = COALESCE($18, bce_number),
        parking_info = COALESCE($19, parking_info),
        languages_spoken = COALESCE($20::text[], languages_spoken),
        social_links = COALESCE($21::jsonb, social_links),
        page_sections = COALESCE($22::jsonb, page_sections),
        seo_title = COALESCE($23, seo_title),
        seo_description = COALESCE($24, seo_description),
        theme = COALESCE($25::jsonb, theme),
        sector = COALESCE($26, sector),
        category = COALESCE($27, category),
        updated_at = NOW()
       WHERE id = $28
       RETURNING *`,
      [
        name, finalSlug || slug, phone, email, finalAddress,
        street || null, street_number || null, postal_code || null, city || null,
        language_default,
        mergedSettings ? JSON.stringify(mergedSettings) : null,
        tagline, description ? sanitizeRichText(description) : null, logo_url, cover_image_url,
        founded_year ? parseInt(founded_year) : null,
        accreditation, bce_number, parking_info,
        langArray,
        social_links ? JSON.stringify(social_links) : null,
        page_sections ? JSON.stringify(page_sections) : null,
        stripHtml(seo_title), stripHtml(seo_description),
        theme ? JSON.stringify(theme) : null,
        sector || null, derivedCategory,
        bid
      ]
    );

    res.json({ business: result.rows[0] });
  } catch (err) {
    next(err);
  }
});

// GET /api/business/public-link — booking link + QR code data
// UI: Settings > Widget & Lien public
router.get('/public-link', async (req, res, next) => {
  try {
    const result = await queryWithRLS(req.businessId,
      `SELECT slug FROM businesses WHERE id = $1`,
      [req.businessId]
    );

    // V13-024: Guard against no rows
    if (result.rows.length === 0) return res.status(404).json({ error: 'Salon introuvable' });

    const baseUrl = process.env.APP_BASE_URL || process.env.BOOKING_BASE_URL || 'https://genda.be';
    const slug = result.rows[0].slug;

    const bookingUrl = `${baseUrl}/${slug}`;
    let qr_image = null;
    try {
      const QRCode = require('qrcode');
      qr_image = await QRCode.toDataURL(bookingUrl, { width: 300, margin: 2, color: { dark: '#1A2332', light: '#FFFFFF' } });
    } catch (_) {}

    res.json({
      booking_url: bookingUrl,
      widget_code: `<script src="${baseUrl}/widget.js"></script>\n<div data-genda="${slug}"></div>`,
      qr_data: bookingUrl,
      qr_image
    });
  } catch (err) {
    next(err);
  }
});

// ============================================================
// POST /api/business/upload-image — Upload logo or cover image
// ============================================================
router.post('/upload-image', requireOwner, async (req, res, next) => {
  try {
    const { photo, type } = req.body; // type: 'logo' | 'cover'
    if (!photo) return res.status(400).json({ error: 'Photo requise' });
    if (!['logo', 'cover', 'about'].includes(type)) return res.status(400).json({ error: 'Type invalide (logo, cover ou about)' });

    const match = photo.match(/^data:image\/(jpeg|jpg|png|webp);base64,(.+)$/);
    if (!match) return res.status(400).json({ error: 'Format invalide (JPEG, PNG ou WebP)' });

    const ext = match[1] === 'jpg' ? 'jpeg' : match[1];
    const buffer = Buffer.from(match[2], 'base64');
    const maxSize = type === 'logo' ? 1 * 1024 * 1024 : 2 * 1024 * 1024;
    if (buffer.length > maxSize) return res.status(400).json({ error: `Image trop lourde (max ${type === 'logo' ? '1' : '2'} Mo)` });

    // Check quota
    const { checkQuota } = require('../../services/storage-quota');
    const quota = await checkQuota(req.businessId, buffer.length, queryWithRLS);
    if (!quota.allowed) return res.status(413).json({ error: quota.message });

    const fs = require('fs');
    const path = require('path');
    const uploadDir = path.join(__dirname, '../../../public/uploads/branding');
    fs.mkdirSync(uploadDir, { recursive: true });

    // Delete old file if local — static map prevents any SQL interpolation risk
    const FIELD_MAP = { logo: 'logo_url', cover: 'cover_image_url', about: null };
    const field = FIELD_MAP[type] || null;
    if (field) {
      const existing = await queryWithRLS(req.businessId, `SELECT ${field} FROM businesses WHERE id = $1`, [req.businessId]);
      if (existing.rows[0]?.[field]?.startsWith('/uploads/branding/')) {
        const oldPath = path.resolve(__dirname, '../../../public', existing.rows[0][field].split('?')[0]);
        const uploadBase = path.resolve(__dirname, '../../../public/uploads');
        if (oldPath.startsWith(uploadBase)) try { fs.unlinkSync(oldPath); } catch (e) { /* ignore */ }
      }
    } else {
      // about image — stored in settings JSONB
      const existing = await queryWithRLS(req.businessId, `SELECT settings FROM businesses WHERE id = $1`, [req.businessId]);
      const oldUrl = existing.rows[0]?.settings?.about_image_url;
      if (oldUrl?.startsWith('/uploads/branding/')) {
        const oldPath = path.resolve(__dirname, '../../../public', oldUrl.split('?')[0]);
        const uploadBase = path.resolve(__dirname, '../../../public/uploads');
        if (oldPath.startsWith(uploadBase)) try { fs.unlinkSync(oldPath); } catch (e) { /* ignore */ }
      }
    }

    const filename = `${req.businessId}_${type}.${ext}`;
    fs.writeFileSync(path.join(uploadDir, filename), buffer);
    const imageUrl = `/uploads/branding/${filename}?t=${Date.now()}`;

    if (field) {
      await queryWithRLS(req.businessId, `UPDATE businesses SET ${field} = $2 WHERE id = $1`, [req.businessId, imageUrl]);
    } else {
      await queryWithRLS(req.businessId, `UPDATE businesses SET settings = jsonb_set(COALESCE(settings, '{}'), '{about_image_url}', to_jsonb($2::text)) WHERE id = $1`, [req.businessId, imageUrl]);
    }

    res.json({ url: imageUrl });
  } catch (err) { next(err); }
});

// ============================================================
// DELETE /api/business/delete-image — Remove logo or cover image
// ============================================================
router.delete('/delete-image/:type', requireOwner, async (req, res, next) => {
  try {
    const { type } = req.params;
    if (!['logo', 'cover', 'about'].includes(type)) return res.status(400).json({ error: 'Type invalide' });

    const field = type === 'about' ? null : (type === 'logo' ? 'logo_url' : 'cover_image_url');
    const fs = require('fs');
    const path = require('path');

    if (field) {
      const existing = await queryWithRLS(req.businessId, `SELECT ${field} FROM businesses WHERE id = $1`, [req.businessId]);
      if (existing.rows[0]?.[field]?.startsWith('/uploads/branding/')) {
        const filePath = path.resolve(__dirname, '../../../public', existing.rows[0][field].split('?')[0]);
        const uploadBase = path.resolve(__dirname, '../../../public/uploads');
        if (filePath.startsWith(uploadBase)) try { fs.unlinkSync(filePath); } catch (e) { /* ignore */ }
      }
      await queryWithRLS(req.businessId, `UPDATE businesses SET ${field} = NULL WHERE id = $1`, [req.businessId]);
    } else {
      const existing = await queryWithRLS(req.businessId, `SELECT settings FROM businesses WHERE id = $1`, [req.businessId]);
      const oldUrl = existing.rows[0]?.settings?.about_image_url;
      if (oldUrl?.startsWith('/uploads/branding/')) {
        const filePath = path.resolve(__dirname, '../../../public', oldUrl.split('?')[0]);
        const uploadBase = path.resolve(__dirname, '../../../public/uploads');
        if (filePath.startsWith(uploadBase)) try { fs.unlinkSync(filePath); } catch (e) { /* ignore */ }
      }
      await queryWithRLS(req.businessId, `UPDATE businesses SET settings = settings - 'about_image_url' WHERE id = $1`, [req.businessId]);
    }
    res.json({ deleted: true });
  } catch (err) { next(err); }
});

// ============================================================
// PATCH /api/business/dev/plan — DEV ONLY: change plan for testing
// ============================================================
router.patch('/dev/plan', requireOwner, blockIfImpersonated, async (req, res, next) => {
  try {
    if (process.env.NODE_ENV === 'production') return res.status(403).json({ error: 'Non disponible en production' });
    const { plan } = req.body;
    const allowed = ['free', 'pro'];
    if (!allowed.includes(plan)) {
      return res.status(400).json({ error: 'Plan invalide. Valeurs: ' + allowed.join(', ') });
    }
    const result = await queryWithRLS(req.businessId,
      `UPDATE businesses SET plan = $1, updated_at = NOW() WHERE id = $2 RETURNING plan`,
      [plan, req.businessId]
    );
    res.json({ plan: result.rows[0].plan });
  } catch (err) { next(err); }
});


// GET /api/business/service-templates — templates for quick start wizard
router.get('/service-templates', requireAuth, async (req, res) => {
  try {
    const businessId = req.businessId;
    const bizResult = await queryWithRLS(businessId,
      `SELECT sector FROM businesses WHERE id = $1`, [businessId]);
    if (!bizResult.rows[0]) return res.status(404).json({ error: 'Business introuvable' });
    const sector = bizResult.rows[0].sector || 'autre';

    const tplResult = await query(
      `SELECT id, category, name, suggested_duration_min, suggested_price_cents, sort_order
       FROM sector_service_templates
       WHERE sector = $1 AND is_active = true
       ORDER BY category, sort_order`,
      [sector]
    );

    const catResult = await query(
      `SELECT label, icon_svg, sort_order FROM sector_categories
       WHERE sector = $1 AND is_active = true ORDER BY sort_order`,
      [sector]
    );
    const iconMap = {};
    catResult.rows.forEach(r => { iconMap[r.label] = { icon_svg: r.icon_svg, sort_order: r.sort_order }; });

    const groupMap = {};
    tplResult.rows.forEach(t => {
      if (!groupMap[t.category]) groupMap[t.category] = [];
      groupMap[t.category].push(t);
    });

    const groups = Object.keys(groupMap)
      .sort((a, b) => (iconMap[a]?.sort_order || 999) - (iconMap[b]?.sort_order || 999))
      .map(cat => ({
        category: cat,
        icon_svg: iconMap[cat]?.icon_svg || null,
        templates: groupMap[cat]
      }));

    res.json({ sector, groups });
  } catch (err) {
    console.error('[SETTINGS] service-templates error:', err.message);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// GET /api/business/sector-categories — catalog + custom categories for this business
router.get('/sector-categories', requireAuth, async (req, res) => {
  try {
    const businessId = req.businessId;
    // Get business sector
    const bizResult = await queryWithRLS(businessId,
      `SELECT sector FROM businesses WHERE id = $1`, [businessId]);
    if (!bizResult.rows[0]) return res.status(404).json({ error: 'Business introuvable' });
    const sector = bizResult.rows[0].sector || 'autre';

    // Get catalog categories for this sector
    const catalogResult = await query(
      `SELECT label, icon_svg, sort_order, 'catalog' AS source FROM sector_categories
       WHERE sector = $1 AND is_active = true ORDER BY sort_order`,
      [sector]
    );

    const catalogLabels = catalogResult.rows.map(r => r.label);

    // Get custom categories from business_categories table
    let bizCatRows = [];
    try {
      const bizCatResult = await queryWithRLS(businessId,
        `SELECT id, label, icon_svg, sort_order, description, color, 'custom' AS source FROM business_categories
         WHERE business_id = $1 ORDER BY sort_order, label`,
        [businessId]
      );
      bizCatRows = bizCatResult.rows;
    } catch (e) {
      if (e.code !== '42P01') throw e; // table doesn't exist yet
    }

    // Merge catalog categories with business_categories overrides (for descriptions/icons)
    const bizCatMap = {};
    for (const r of bizCatRows) bizCatMap[r.label] = r;

    const mergedCatalog = catalogResult.rows.map(cat => {
      const biz = bizCatMap[cat.label];
      if (biz) {
        return { ...cat, id: biz.id, description: biz.description || null, icon_svg: biz.icon_svg || cat.icon_svg, color: biz.color || null, sort_order: biz.sort_order != null ? biz.sort_order : cat.sort_order };
      }
      return cat;
    });

    // Custom-only categories (in business_categories but NOT in catalog)
    const customOnly = bizCatRows.filter(r => !catalogLabels.includes(r.label));

    // Get custom categories already used in services (not in catalog or business_categories)
    const allKnownLabels = [...catalogLabels, ...customOnly.map(r => r.label)];
    const svcCustomResult = await queryWithRLS(businessId,
      `SELECT DISTINCT category AS label FROM services
       WHERE business_id = $1 AND category IS NOT NULL AND category != ''
       AND category != ALL($2)
       ORDER BY category`,
      [businessId, allKnownLabels]
    );
    const svcCustomRows = svcCustomResult.rows.map(r => ({ ...r, icon_svg: null, sort_order: 999, source: 'custom' }));

    const allCats = [...mergedCatalog, ...customOnly, ...svcCustomRows];
    allCats.sort((a, b) => (a.sort_order ?? 999) - (b.sort_order ?? 999));
    res.json({ sector, categories: allCats });
  } catch (err) {
    console.error('[SETTINGS] sector-categories error:', err.message);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// POST /api/business/categories — create a custom category
router.post('/categories', requireOwner, async (req, res, next) => {
  try {
    const bid = req.businessId;
    const { label, description, icon_svg, color } = req.body;
    if (!label || !label.trim()) return res.status(400).json({ error: 'Label requis' });

    // Upsert: if category already exists, update it instead of returning 409
    try {
      const existing = await queryWithRLS(bid,
        `SELECT id FROM business_categories WHERE business_id = $1 AND LOWER(label) = LOWER($2)`,
        [bid, label.trim()]
      );
      if (existing.rows.length > 0) {
        const result = await queryWithRLS(bid,
          `UPDATE business_categories SET label = $1, description = $2, icon_svg = COALESCE($3, icon_svg), color = COALESCE($4, color)
           WHERE id = $5 AND business_id = $6 RETURNING *`,
          [label.trim(), description?.trim() || null, icon_svg || null, color || null, existing.rows[0].id, bid]
        );
        return res.json({ category: result.rows[0] });
      }
    } catch (e) {
      if (e.code !== '42P01') throw e;
    }

    const result = await queryWithRLS(bid,
      `INSERT INTO business_categories (business_id, label, description, icon_svg, color)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [bid, label.trim(), description?.trim() || null, icon_svg || null, color || null]
    );
    res.status(201).json({ category: result.rows[0] });
  } catch (err) { next(err); }
});

// PATCH /api/business/categories/reorder — batch update sort_order (MUST be before /:id)
router.patch('/categories/reorder', requireOwner, async (req, res, next) => {
  try {
    const bid = req.businessId;
    const { order } = req.body;
    if (!Array.isArray(order)) return res.status(400).json({ error: 'order array requis' });
    for (const item of order) {
      await queryWithRLS(bid,
        `UPDATE business_categories SET sort_order = $1 WHERE id = $2 AND business_id = $3`,
        [item.sort_order, item.id, bid]
      );
    }
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// PATCH /api/business/categories/:id — update a custom category
router.patch('/categories/:id', requireOwner, async (req, res, next) => {
  try {
    const bid = req.businessId;
    const allowed = ['label', 'description', 'icon_svg', 'sort_order', 'color'];
    const sets = []; const vals = [req.params.id, bid]; let idx = 3;
    for (const key of allowed) {
      if (req.body[key] !== undefined) {
        sets.push(`${key} = $${idx++}`);
        vals.push(key === 'label' ? req.body[key].trim() : (key === 'description' ? (req.body[key]?.trim() || null) : req.body[key]));
      }
    }
    if (sets.length === 0) return res.status(400).json({ error: 'Aucun champ à mettre à jour' });

    const result = await queryWithRLS(bid,
      `UPDATE business_categories SET ${sets.join(', ')} WHERE id = $1 AND business_id = $2 RETURNING *`,
      vals
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Catégorie introuvable' });
    res.json({ category: result.rows[0] });
  } catch (err) { next(err); }
});

// DELETE /api/business/categories/:id — delete a custom category
router.delete('/categories/:id', requireOwner, async (req, res, next) => {
  try {
    const bid = req.businessId;
    const result = await queryWithRLS(bid,
      `DELETE FROM business_categories WHERE id = $1 AND business_id = $2 RETURNING id`,
      [req.params.id, bid]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Catégorie introuvable' });
    res.json({ deleted: true });
  } catch (err) { next(err); }
});

// ============================================================
// POST /api/business/close — Soft-delete business account
// Deactivates account, cancels Stripe subscription, notifies affected clients
// ============================================================
router.post('/close', requireOwner, blockIfImpersonated, async (req, res, next) => {
  try {
    const bid = req.businessId;
    const { confirm_name } = req.body;
    const { escHtml, sendEmail, buildEmailHTML } = require('../../services/email-utils');
    const { transactionWithRLS } = require('../../services/db');

    // 1. Verify business name matches
    const bizRes = await queryWithRLS(bid,
      `SELECT name, email, phone, stripe_customer_id, stripe_subscription_id FROM businesses WHERE id = $1`, [bid]
    );
    const biz = bizRes.rows[0];
    if (!biz) return res.status(404).json({ error: 'Salon introuvable' });
    if (!confirm_name || confirm_name.trim().toLowerCase() !== biz.name.trim().toLowerCase()) {
      return res.status(400).json({ error: 'Le nom du salon ne correspond pas' });
    }

    // 2. All DB operations in a single transaction
    const txResult = await transactionWithRLS(bid, async (client) => {
      // 2a. Soft-delete: deactivate business
      await client.query(
        `UPDATE businesses SET is_active = false, updated_at = NOW() WHERE id = $1`, [bid]
      );

      // 2b. Cancel all future bookings + mark deposit as 'cancelled' (retained by merchant)
      const futureRes = await client.query(
        `UPDATE bookings SET status = 'cancelled',
          cancel_reason = 'Fermeture du salon',
          deposit_status = CASE WHEN deposit_status = 'pending' THEN 'cancelled' ELSE deposit_status END,
          updated_at = NOW()
         WHERE business_id = $1 AND status IN ('confirmed', 'pending', 'modified_pending', 'pending_deposit')
           AND start_at > NOW()
         RETURNING id, client_id`, [bid]
      );

      // B-06 fix: collect all items needing Stripe/GC/pass refund (exec hors TX après COMMIT).
      // Légal BE: fermer salon en gardant l'argent client = rétention indue (art. 1184 Code civil).
      // Le client a droit à son acompte, solde GC et sessions pass non consommées.

      // 2b-refund-1: bookings deposits paid via Stripe (exclut gc_/pass_/gc_absorbed)
      const depositsToRefundRes = await client.query(
        `SELECT id, deposit_amount_cents, deposit_payment_intent_id
         FROM bookings
         WHERE business_id = $1 AND cancel_reason = 'Fermeture du salon'
           AND deposit_status = 'paid'
           AND deposit_payment_intent_id IS NOT NULL
           AND (deposit_payment_intent_id LIKE 'pi_%' OR deposit_payment_intent_id LIKE 'cs_%')`,
        [bid]
      );

      // 2b-refund-2: gift cards avec balance restante + Stripe PI
      const gcToRefundRes = await client.query(
        `SELECT id, code, balance_cents, stripe_payment_intent_id
         FROM gift_cards
         WHERE business_id = $1 AND status = 'active' AND balance_cents > 0
           AND stripe_payment_intent_id IS NOT NULL`,
        [bid]
      );

      // 2b-refund-3: passes avec sessions restantes + Stripe PI
      const passToRefundRes = await client.query(
        `SELECT id, code, price_cents, sessions_total, sessions_remaining, stripe_payment_intent_id
         FROM passes
         WHERE business_id = $1 AND status = 'active' AND sessions_remaining > 0
           AND stripe_payment_intent_id IS NOT NULL`,
        [bid]
      );

      // 2b2. Void all draft/sent invoices
      await client.query(
        `UPDATE invoices SET status = 'cancelled', updated_at = NOW()
         WHERE business_id = $1 AND status IN ('draft', 'sent')`, [bid]
      );

      // 2b3. Clean up waitlist entries
      await client.query(
        `UPDATE waitlist_entries SET status = 'expired', updated_at = NOW()
         WHERE business_id = $1 AND status IN ('waiting', 'offered')`, [bid]
      );

      // 2c. Collect ALL affected emails: clients with bookings + GC buyers + GC recipients + pass buyers
      // GC/passes don't have client_id — they have buyer_email/recipient_email
      const affectedRes = await client.query(
        `SELECT DISTINCT email, name FROM (
           -- Clients with future bookings (just cancelled)
           SELECT c.email, c.full_name AS name
           FROM clients c
           WHERE c.business_id = $1 AND c.email IS NOT NULL AND c.email != ''
             AND c.id IN (SELECT DISTINCT client_id FROM bookings WHERE business_id = $1 AND cancel_reason = 'Fermeture du salon' AND client_id IS NOT NULL)
           UNION
           -- Clients with paid deposits on future bookings
           SELECT c.email, c.full_name AS name
           FROM clients c
           WHERE c.business_id = $1 AND c.email IS NOT NULL AND c.email != ''
             AND c.id IN (SELECT DISTINCT client_id FROM bookings WHERE business_id = $1 AND deposit_status = 'paid' AND start_at > NOW() AND client_id IS NOT NULL)
           UNION
           -- Gift card buyers with active balance
           SELECT buyer_email AS email, buyer_name AS name
           FROM gift_cards WHERE business_id = $1 AND status = 'active' AND balance_cents > 0 AND buyer_email IS NOT NULL AND buyer_email != ''
           UNION
           -- Gift card recipients with active balance
           SELECT recipient_email AS email, recipient_name AS name
           FROM gift_cards WHERE business_id = $1 AND status = 'active' AND balance_cents > 0 AND recipient_email IS NOT NULL AND recipient_email != ''
           UNION
           -- Pass buyers with remaining sessions
           SELECT buyer_email AS email, buyer_name AS name
           FROM passes WHERE business_id = $1 AND status = 'active' AND sessions_remaining > 0 AND buyer_email IS NOT NULL AND buyer_email != ''
         ) AS affected
         WHERE email IS NOT NULL AND email != ''`, [bid]
      );

      // 2d. Audit log
      await client.query(
        `INSERT INTO audit_logs (business_id, actor_user_id, entity_type, entity_id, action, old_data, new_data)
         VALUES ($1, $2, 'business', $1, 'close_account', $3, $4)`,
        [bid, req.user.id,
         JSON.stringify({ is_active: true, name: biz.name }),
         JSON.stringify({ is_active: false, bookings_cancelled: futureRes.rows.length, affected_emails: affectedRes.rows.length })]
      );

      return {
        futureCount: futureRes.rows.length,
        affected: affectedRes.rows,
        depositsToRefund: depositsToRefundRes.rows,
        gcToRefund: gcToRefundRes.rows,
        passToRefund: passToRefundRes.rows
      };
    });

    // B-06 post-TX: exécuter les refunds Stripe hors transaction (API externe, volume possible).
    // Si Stripe fail sur un item: log + notif support (manuelle requise). DB non mise à jour pour cet item.
    const _refundStripe = async (stripe, piRaw, amount, label) => {
      try {
        let piId = piRaw;
        if (piId.startsWith('cs_')) {
          const sess = await stripe.checkout.sessions.retrieve(piId);
          piId = sess.payment_intent;
        }
        if (!piId || !piId.startsWith('pi_')) return { ok: false, reason: 'invalid_pi' };
        if (amount < 50) return { ok: false, reason: 'below_stripe_min' };
        await stripe.refunds.create({ payment_intent: piId, amount });
        console.log(`[CLOSE REFUND ${label}] ${amount}c OK pour PI ${piId}`);
        return { ok: true };
      } catch (e) {
        if (e.code === 'charge_already_refunded') return { ok: true, note: 'already_refunded' };
        console.error(`[CLOSE REFUND ${label}] FAILED for ${piRaw}:`, e.message);
        return { ok: false, reason: e.message };
      }
    };

    let refundStats = { deposits_refunded: 0, deposits_failed: 0, gc_refunded: 0, gc_failed: 0, pass_refunded: 0, pass_failed: 0 };
    const stripeKeyClose = process.env.STRIPE_SECRET_KEY;
    if (stripeKeyClose) {
      const stripeClose = require('stripe')(stripeKeyClose);

      // Deposits Stripe refund (policy=full systematic — fermeture de salon, pas de retention possible)
      for (const dep of txResult.depositsToRefund) {
        const amt = dep.deposit_amount_cents || 0;
        if (amt <= 0) continue;
        const res = await _refundStripe(stripeClose, dep.deposit_payment_intent_id, amt, 'deposit');
        if (res.ok) {
          refundStats.deposits_refunded++;
          await queryWithRLS(bid,
            `UPDATE bookings SET deposit_status = 'refunded', updated_at = NOW() WHERE id = $1`,
            [dep.id]
          ).catch(() => {});
        } else {
          refundStats.deposits_failed++;
        }
      }

      // Gift cards refund Stripe (balance_cents) + mark status='refunded'
      for (const gc of txResult.gcToRefund) {
        const amt = gc.balance_cents || 0;
        if (amt <= 0) continue;
        const res = await _refundStripe(stripeClose, gc.stripe_payment_intent_id, amt, 'gift_card');
        if (res.ok) {
          refundStats.gc_refunded++;
          await queryWithRLS(bid,
            `UPDATE gift_cards SET status = 'refunded', balance_cents = 0, updated_at = NOW() WHERE id = $1`,
            [gc.id]
          ).catch(() => {});
        } else {
          refundStats.gc_failed++;
        }
      }

      // Passes refund Stripe pro-rata (sessions_remaining * round(price/total)) + mark 'cancelled'
      for (const p of txResult.passToRefund) {
        if (!p.sessions_total || p.sessions_total <= 0) continue;
        const unusedCents = p.sessions_remaining === p.sessions_total
          ? p.price_cents  // full unused = full price (no rounding drift)
          : p.sessions_remaining * Math.round(p.price_cents / p.sessions_total);
        if (unusedCents <= 0) continue;
        const res = await _refundStripe(stripeClose, p.stripe_payment_intent_id, unusedCents, 'pass');
        if (res.ok) {
          refundStats.pass_refunded++;
          await queryWithRLS(bid,
            `UPDATE passes SET status = 'cancelled', sessions_remaining = 0, updated_at = NOW() WHERE id = $1`,
            [p.id]
          ).catch(() => {});
        } else {
          refundStats.pass_failed++;
        }
      }
      console.log('[CLOSE] Refund summary:', refundStats);
    } else {
      console.warn('[CLOSE] STRIPE_SECRET_KEY absent — aucun refund auto. Pro devra traiter manuellement.');
      refundStats.deposits_failed = txResult.depositsToRefund.length;
      refundStats.gc_failed = txResult.gcToRefund.length;
      refundStats.pass_failed = txResult.passToRefund.length;
    }

    // 3. Cancel Stripe subscription AFTER commit (external API call outside tx)
    if (biz.stripe_subscription_id) {
      try {
        const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
        await stripe.subscriptions.cancel(biz.stripe_subscription_id);
        await queryWithRLS(bid,
          `UPDATE businesses SET subscription_status = 'canceled', updated_at = NOW() WHERE id = $1`, [bid]
        );
      } catch (stripeErr) {
        console.warn('[CLOSE] Stripe subscription cancel failed:', stripeErr.message);
      }
    }

    // 4. Send notification emails (post-commit, non-blocking)
    let emailsSent = 0;
    const safeBizName = escHtml(biz.name);
    const bizContact = [biz.phone, biz.email].filter(Boolean).join(' / ');

    for (const person of txResult.affected) {
      try {
        const safeName = escHtml(person.name || '');
        const html = buildEmailHTML({
          title: `${safeBizName} ferme ses portes`,
          preheader: `Information importante concernant vos prestations`,
          bodyHTML: `
            <p>Bonjour${safeName ? ' <strong>' + safeName + '</strong>' : ''},</p>
            <p>Nous vous informons que <strong>${safeBizName}</strong> a décidé de fermer son compte sur notre plateforme.</p>
            <div style="background:#FEF3E2;border-radius:8px;padding:14px 16px;margin:16px 0;border-left:3px solid #E6A817">
              <div style="font-size:14px;color:#92700C;font-weight:600">Ce que cela signifie pour vous :</div>
              <ul style="font-size:13px;color:#92700C;margin:8px 0;padding-left:20px">
                <li>Vos rendez-vous futurs ont \u00e9t\u00e9 annul\u00e9s</li>
                <li>Si vous aviez un acompte pay\u00e9, une carte cadeau ou un abonnement en cours, veuillez contacter directement le salon pour obtenir un remboursement</li>
              </ul>
              ${bizContact ? `<div style="font-size:13px;color:#92700C;margin-top:8px;font-weight:500">Contact du salon : ${escHtml(bizContact)}</div>` : ''}
            </div>
            <p style="font-size:13px;color:#6B6560">Si vous avez des questions, vous pouvez \u00e9galement contacter notre support \u00e0 <a href="mailto:support@genda.be" style="color:#0D7377">support@genda.be</a>.</p>`,
          businessName: biz.name,
          footerText: 'Cet email a \u00e9t\u00e9 envoy\u00e9 automatiquement via Genda.be'
        });
        await sendEmail({
          to: person.email,
          toName: person.name || '',
          subject: `${biz.name} \u2014 Fermeture`,
          html
        });
        emailsSent++;
      } catch (emailErr) {
        console.warn(`[CLOSE] Email to ${person.email} failed:`, emailErr.message);
      }
    }

    // 5. Auto-export data and send to owner (post-close, they lose dashboard access)
    try {
      const ownerRes = await query(`SELECT email FROM users WHERE business_id = $1 AND role = 'owner' LIMIT 1`, [bid]);
      const ownerEmail = ownerRes.rows[0]?.email;
      if (ownerEmail) {
        // Build clients CSV
        const clientsRes = await query(
          `SELECT c.full_name, c.email, c.phone, c.notes, c.consent_sms, c.consent_email, c.consent_marketing, c.created_at,
                  (SELECT COUNT(*) FROM bookings b WHERE b.client_id = c.id AND b.status IN ('confirmed', 'completed')) AS total_bookings
           FROM clients c WHERE c.business_id = $1 ORDER BY c.full_name`, [bid]
        );
        const fmtD = (d) => d ? new Date(d).toLocaleDateString('fr-BE', { timeZone: 'Europe/Brussels' }) : '';
        const escC = (s) => `"${(s || '').replace(/"/g, '""')}"`;
        const clientsCsv = '\uFEFF' + 'Nom;Email;Téléphone;Notes;SMS;Email;Marketing;Créé le;RDV total\n' +
          clientsRes.rows.map(r => [escC(r.full_name), r.email||'', r.phone||'', escC(r.notes),
            r.consent_sms?'Oui':'Non', r.consent_email!==false?'Oui':'Non', r.consent_marketing?'Oui':'Non',
            fmtD(r.created_at), r.total_bookings||0].join(';')).join('\n');

        // Build invoices CSV
        const invRes = await query(
          `SELECT invoice_number, type, status, issue_date, client_name, client_email, total_cents, vat_amount_cents
           FROM invoices WHERE business_id = $1 ORDER BY issue_date DESC`, [bid]
        );
        const fmtE = (c) => ((c||0)/100).toFixed(2).replace('.',',');
        const invoicesCsv = '\uFEFF' + 'Numéro;Type;Statut;Date;Client;Email;Total (€);TVA (€)\n' +
          invRes.rows.map(r => [r.invoice_number||'', r.type||'', r.status||'', fmtD(r.issue_date),
            escC(r.client_name), r.client_email||'', fmtE(r.total_cents), fmtE(r.vat_amount_cents)].join(';')).join('\n');

        const exportHtml = buildEmailHTML({
          title: 'Vos données — ' + escHtml(biz.name),
          preheader: 'Export de vos données clients et factures',
          bodyHTML: `
            <p>Bonjour,</p>
            <p>Suite à la fermeture de votre compte <strong>${escHtml(biz.name)}</strong>, voici l'export de vos données en pièces jointes.</p>
            <p style="font-size:13px;color:#6B6560">Ces fichiers CSV sont compatibles avec Excel et Google Sheets. Conservez-les précieusement.</p>`,
          businessName: biz.name,
          footerText: 'Genda.be — Export de données'
        });

        // Send with Brevo attachments — timeout 15s pour éviter de bloquer le POST /close
        // si Brevo est lent/indisponible (UX: "Fermeture en cours" bloqué jusqu'à timeout HTTP).
        const BREVO_API = 'https://api.brevo.com/v3/smtp/email';
        await fetch(BREVO_API, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'api-key': process.env.BREVO_API_KEY },
          body: JSON.stringify({
            sender: { name: 'Genda', email: 'no-reply@genda.be' },
            to: [{ email: ownerEmail }],
            subject: `${biz.name} — Export de vos données`,
            htmlContent: exportHtml,
            attachment: [
              { name: 'clients.csv', content: Buffer.from(clientsCsv).toString('base64') },
              { name: 'factures.csv', content: Buffer.from(invoicesCsv).toString('base64') }
            ]
          }),
          signal: AbortSignal.timeout(15000)
        });
        console.log(`[CLOSE] Data export sent to ${ownerEmail}`);
      }
    } catch (exportErr) {
      console.warn('[CLOSE] Data export email failed:', exportErr.message);
    }

    console.log(`[CLOSE] Business ${bid} (${biz.name}) closed. ${txResult.futureCount} bookings cancelled, ${emailsSent}/${txResult.affected.length} clients notified.`);

    res.json({
      closed: true,
      bookings_cancelled: txResult.futureCount,
      clients_notified: emailsSent
    });
  } catch (err) { next(err); }
});

module.exports = router;
