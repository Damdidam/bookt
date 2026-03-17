const router = require('express').Router();
const { query, queryWithRLS } = require('../../services/db');
const { requireAuth, requireOwner, requireRole } = require('../../middleware/auth');

// V11-025: Strip HTML tags from text fields to prevent injection
function stripHtml(str) {
  if (!str || typeof str !== 'string') return str;
  return str.replace(/<[^>]*>/g, '').trim();
}

router.use(requireAuth);

// GET /api/business — full business details
// UI: Settings page (all cards)
router.get('/', async (req, res, next) => {
  try {
    const result = await queryWithRLS(req.businessId,
      `SELECT * FROM businesses WHERE id = $1`,
      [req.businessId]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Cabinet introuvable' });

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
// UI: Settings > Cabinet form + Onboarding bio step
router.patch('/', requireOwner, async (req, res, next) => {
  try {
    const bid = req.businessId;
    const {
      name, slug, phone, email, address, language_default, settings,
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
      // Multi-service booking
      settings_multi_service_enabled,
      // Calendar settings (business-level)
      settings_slot_increment_min, settings_waitlist_mode, settings_calendar_color_mode, settings_slot_auto_optimize,
      // Booking page settings
      settings_practitioner_choice_enabled,
      // Booking confirmation
      settings_booking_confirmation_required, settings_booking_confirmation_timeout, settings_booking_confirmation_channel,
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
      // Move restriction settings
      settings_move_restriction_enabled, settings_move_deadline_hours, settings_move_grace_hours,
      // Reviews settings
      settings_reviews_enabled, settings_review_delay_hours, settings_review_auto_publish,
      // Minisite template
      settings_minisite_template,
      // Client reschedule
      settings_reschedule_enabled, settings_reschedule_deadline_hours,
      settings_reschedule_max_count, settings_reschedule_window_days,
      // Sector
      sector
    } = req.body;

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
        || settings_multi_service_enabled !== undefined
        || settings_slot_increment_min !== undefined || settings_waitlist_mode !== undefined || settings_calendar_color_mode !== undefined || settings_slot_auto_optimize !== undefined
        || settings_practitioner_choice_enabled !== undefined
        || settings_booking_confirmation_required !== undefined || settings_booking_confirmation_timeout !== undefined
        || settings_booking_confirmation_channel !== undefined
        || settings_gap_analyzer_enabled !== undefined
        || settings_featured_slots_enabled !== undefined
        || settings_last_minute_enabled !== undefined || settings_last_minute_deadline !== undefined
        || settings_last_minute_discount_pct !== undefined || settings_last_minute_min_price_cents !== undefined
        || settings_default_calendar_view !== undefined
        || settings_payment_methods !== undefined
        || settings_reviews_enabled !== undefined || settings_review_delay_hours !== undefined || settings_review_auto_publish !== undefined
        || settings_minisite_template !== undefined
        || settings_reschedule_enabled !== undefined || settings_reschedule_deadline_hours !== undefined
        || settings_reschedule_max_count !== undefined || settings_reschedule_window_days !== undefined) {
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
      if (settings_deposit_percent !== undefined) { const _v = parseInt(settings_deposit_percent); cur.deposit_percent = isNaN(_v) ? 50 : _v; }
      if (settings_deposit_fixed_cents !== undefined) { const _v = parseInt(settings_deposit_fixed_cents); cur.deposit_fixed_cents = isNaN(_v) ? 2500 : _v; }
      if (settings_deposit_deadline_hours !== undefined) { const _v = parseInt(settings_deposit_deadline_hours); cur.deposit_deadline_hours = isNaN(_v) ? 48 : _v; }
      if (settings_deposit_message !== undefined) cur.deposit_message = settings_deposit_message;
      if (settings_deposit_deduct !== undefined) cur.deposit_deduct = !!settings_deposit_deduct;
      if (settings_deposit_price_threshold_cents !== undefined) { const _v = parseInt(settings_deposit_price_threshold_cents); cur.deposit_price_threshold_cents = isNaN(_v) ? 0 : _v; }
      if (settings_deposit_duration_threshold_min !== undefined) { const _v = parseInt(settings_deposit_duration_threshold_min); cur.deposit_duration_threshold_min = isNaN(_v) ? 0 : _v; }
      if (settings_deposit_threshold_mode !== undefined) cur.deposit_threshold_mode = ['any', 'both'].includes(settings_deposit_threshold_mode) ? settings_deposit_threshold_mode : 'any';
      // V23b cancellation policy
      if (settings_cancel_deadline_hours !== undefined) { const _v = parseInt(settings_cancel_deadline_hours); cur.cancel_deadline_hours = isNaN(_v) ? 48 : _v; }
      if (settings_cancel_grace_minutes !== undefined) { const _v = parseInt(settings_cancel_grace_minutes); cur.cancel_grace_minutes = isNaN(_v) ? 240 : _v; }
      if (settings_cancel_policy_text !== undefined) cur.cancel_policy_text = settings_cancel_policy_text;
      // Multi-service booking
      if (settings_multi_service_enabled !== undefined) cur.multi_service_enabled = !!settings_multi_service_enabled;
      // Calendar settings
      if (settings_slot_increment_min !== undefined) { const _v = parseInt(settings_slot_increment_min); cur.slot_increment_min = [5,10,15,20,30,45,60].includes(_v) ? _v : 15; }
      if (settings_waitlist_mode !== undefined) { cur.waitlist_mode = ['off','manual','auto'].includes(settings_waitlist_mode) ? settings_waitlist_mode : 'off'; }
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
      if (settings_booking_confirmation_required !== undefined) cur.booking_confirmation_required = !!settings_booking_confirmation_required;
      if (settings_booking_confirmation_timeout !== undefined) { const _v = parseInt(settings_booking_confirmation_timeout); cur.booking_confirmation_timeout_min = (_v >= 5 && _v <= 1440) ? _v : 30; }
      if (settings_booking_confirmation_channel !== undefined) { cur.booking_confirmation_channel = ['email','sms','both'].includes(settings_booking_confirmation_channel) ? settings_booking_confirmation_channel : 'email'; }
      // Default calendar view
      if (settings_default_calendar_view !== undefined) {
        const allowed = ['day', 'week', 'month'];
        if (allowed.includes(settings_default_calendar_view)) cur.default_calendar_view = settings_default_calendar_view;
      }
      // Move restriction settings
      if (settings_move_restriction_enabled !== undefined) cur.move_restriction_enabled = !!settings_move_restriction_enabled;
      if (settings_move_deadline_hours !== undefined) { const _v = parseInt(settings_move_deadline_hours); cur.move_deadline_hours = (_v >= 1 && _v <= 720) ? _v : 48; }
      if (settings_move_grace_hours !== undefined) { const _v = parseInt(settings_move_grace_hours); cur.move_grace_hours = (_v >= 0 && _v <= 168) ? _v : 0; }
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
      // Client reschedule
      if (settings_reschedule_enabled !== undefined) cur.reschedule_enabled = !!settings_reschedule_enabled;
      if (settings_reschedule_deadline_hours !== undefined) { const _v = parseInt(settings_reschedule_deadline_hours); cur.reschedule_deadline_hours = (_v >= 1 && _v <= 720) ? _v : 24; }
      if (settings_reschedule_max_count !== undefined) { const _v = parseInt(settings_reschedule_max_count); cur.reschedule_max_count = (_v >= 1 && _v <= 10) ? _v : 1; }
      if (settings_reschedule_window_days !== undefined) { const _v = parseInt(settings_reschedule_window_days); cur.reschedule_window_days = (_v >= 7 && _v <= 90) ? _v : 30; }
      mergedSettings = cur;
    }

    // Sector validation & category derivation
    const SECTOR_TO_CAT = {
      medecin:'sante', dentiste:'sante', kine:'sante', osteopathe:'sante', bien_etre:'sante',
      coiffeur:'beaute', esthetique:'beaute', barbier:'beaute',
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

    const result = await queryWithRLS(bid,
      `UPDATE businesses SET
        name = COALESCE($1, name),
        slug = COALESCE($2, slug),
        phone = COALESCE($3, phone),
        email = COALESCE($4, email),
        address = COALESCE($5, address),
        language_default = COALESCE($6, language_default),
        settings = COALESCE($7::jsonb, settings),
        tagline = COALESCE($8, tagline),
        description = COALESCE($9, description),
        logo_url = COALESCE($10, logo_url),
        cover_image_url = COALESCE($11, cover_image_url),
        founded_year = COALESCE($12, founded_year),
        accreditation = COALESCE($13, accreditation),
        bce_number = COALESCE($14, bce_number),
        parking_info = COALESCE($15, parking_info),
        languages_spoken = COALESCE($16::text[], languages_spoken),
        social_links = COALESCE($17::jsonb, social_links),
        page_sections = COALESCE($18::jsonb, page_sections),
        seo_title = COALESCE($19, seo_title),
        seo_description = COALESCE($20, seo_description),
        theme = COALESCE($21::jsonb, theme),
        sector = COALESCE($22, sector),
        category = COALESCE($23, category),
        updated_at = NOW()
       WHERE id = $24
       RETURNING *`,
      [
        name, finalSlug || slug, phone, email, address, language_default,
        mergedSettings ? JSON.stringify(mergedSettings) : null,
        tagline, description, logo_url, cover_image_url,
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
    if (result.rows.length === 0) return res.status(404).json({ error: 'Cabinet introuvable' });

    const baseUrl = process.env.BOOKING_BASE_URL || 'https://genda.be';
    const slug = result.rows[0].slug;

    res.json({
      booking_url: `${baseUrl}/${slug}`,
      widget_code: `<script src="${baseUrl}/widget.js"></script>\n<div data-genda="${slug}"></div>`,
      qr_data: `${baseUrl}/${slug}`
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

    const match = photo.match(/^data:image\/(jpeg|jpg|png|webp|svg\+xml);base64,(.+)$/);
    if (!match) return res.status(400).json({ error: 'Format invalide (JPEG, PNG, WebP ou SVG)' });

    const ext = match[1] === 'jpg' ? 'jpeg' : match[1] === 'svg+xml' ? 'svg' : match[1];
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

    // Delete old file if local
    const field = type === 'about' ? null : (type === 'logo' ? 'logo_url' : 'cover_image_url');
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
router.patch('/dev/plan', requireOwner, async (req, res, next) => {
  try {
    if (process.env.NODE_ENV === 'production') return res.status(403).json({ error: 'Non disponible en production' });
    const { plan } = req.body;
    const allowed = ['free', 'pro', 'premium'];
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
router.post('/categories', requireRole('owner', 'manager'), async (req, res, next) => {
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
router.patch('/categories/reorder', requireRole('owner', 'manager'), async (req, res, next) => {
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
router.patch('/categories/:id', requireRole('owner', 'manager'), async (req, res, next) => {
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
router.delete('/categories/:id', requireRole('owner', 'manager'), async (req, res, next) => {
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

module.exports = router;
