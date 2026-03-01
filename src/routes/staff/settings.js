const router = require('express').Router();
const { queryWithRLS } = require('../../services/db');
const { requireAuth, requireOwner } = require('../../middleware/auth');

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

    res.json({ business: result.rows[0] });
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
      // V23b cancellation policy
      settings_cancel_deadline_hours, settings_cancel_grace_minutes, settings_cancel_policy_text
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
        || settings_cancel_policy_text !== undefined) {
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
      if (settings_deposit_noshow_threshold !== undefined) cur.deposit_noshow_threshold = parseInt(settings_deposit_noshow_threshold) || 2;
      if (settings_deposit_type !== undefined) cur.deposit_type = settings_deposit_type;
      if (settings_deposit_percent !== undefined) cur.deposit_percent = parseInt(settings_deposit_percent) || 50;
      if (settings_deposit_fixed_cents !== undefined) cur.deposit_fixed_cents = parseInt(settings_deposit_fixed_cents) || 2500;
      if (settings_deposit_deadline_hours !== undefined) cur.deposit_deadline_hours = parseInt(settings_deposit_deadline_hours) || 48;
      if (settings_deposit_message !== undefined) cur.deposit_message = settings_deposit_message;
      if (settings_deposit_deduct !== undefined) cur.deposit_deduct = !!settings_deposit_deduct;
      // V23b cancellation policy
      if (settings_cancel_deadline_hours !== undefined) cur.cancel_deadline_hours = parseInt(settings_cancel_deadline_hours) || 48;
      if (settings_cancel_grace_minutes !== undefined) cur.cancel_grace_minutes = parseInt(settings_cancel_grace_minutes) || 240;
      if (settings_cancel_policy_text !== undefined) cur.cancel_policy_text = settings_cancel_policy_text;
      mergedSettings = cur;
    }

    // If slug is changing, verify uniqueness
    if (slug) {
      const existing = await queryWithRLS(bid,
        `SELECT id FROM businesses WHERE slug = $1 AND id != $2`,
        [slug, bid]
      );
      if (existing.rows.length > 0) {
        return res.status(409).json({ error: 'Ce slug est déjà pris' });
      }
    }

    // Ensure languages_spoken is a proper PG array literal
    let langArray = null;
    if (languages_spoken) {
      if (Array.isArray(languages_spoken)) {
        langArray = `{${languages_spoken.join(',')}}`;
      } else if (typeof languages_spoken === 'string') {
        langArray = languages_spoken.startsWith('{') ? languages_spoken : `{${languages_spoken}}`;
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
        languages_spoken = COALESCE($16, languages_spoken),
        social_links = COALESCE($17::jsonb, social_links),
        page_sections = COALESCE($18::jsonb, page_sections),
        seo_title = COALESCE($19, seo_title),
        seo_description = COALESCE($20, seo_description),
        theme = COALESCE($21::jsonb, theme),
        updated_at = NOW()
       WHERE id = $22
       RETURNING *`,
      [
        name, slug, phone, email, address, language_default,
        mergedSettings ? JSON.stringify(mergedSettings) : null,
        tagline, description, logo_url, cover_image_url,
        founded_year ? parseInt(founded_year) : null,
        accreditation, bce_number, parking_info,
        langArray,
        social_links ? JSON.stringify(social_links) : null,
        page_sections ? JSON.stringify(page_sections) : null,
        seo_title, seo_description,
        theme ? JSON.stringify(theme) : null,
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
// PATCH /api/business/dev/plan — DEV ONLY: change plan for testing
// ============================================================
router.patch('/dev/plan', requireOwner, async (req, res, next) => {
  try {
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

module.exports = router;
