const router = require('express').Router();
const { query } = require('../../services/db');
const { getCategoryLabels } = require('../../services/email');
const { SECTOR_PRACTITIONER } = require('./helpers');

// ============================================================
// GET /api/public/booking/:token
// Read-only booking view (for booking confirmation pages)
// ============================================================
router.get('/booking/:token', async (req, res, next) => {
  try {
    const { token } = req.params;
    const result = await query(
      `SELECT b.id, b.start_at, b.end_at, b.status, b.appointment_mode,
              b.comment_client, b.public_token, b.created_at, b.group_id,
              b.deposit_required, b.deposit_amount_cents, b.deposit_status, b.deposit_deadline, b.deposit_payment_url,
              CASE WHEN sv.name IS NOT NULL THEN s.name || ' — ' || sv.name ELSE s.name END AS service_name,
                  s.category AS service_category,
              COALESCE(sv.duration_min, s.duration_min) AS duration_min,
              COALESCE(sv.price_cents, s.price_cents) AS price_cents,
              s.color AS service_color,
              p.display_name AS practitioner_name, p.title AS practitioner_title,
              c.full_name AS client_name, c.phone AS client_phone, c.email AS client_email,
              biz.name AS business_name, biz.slug AS business_slug, biz.phone AS business_phone,
              biz.email AS business_email, biz.address AS business_address,
              biz.settings AS business_settings, biz.theme AS business_theme,
              biz.category AS business_category, biz.sector AS business_sector
       FROM bookings b
       LEFT JOIN services s ON s.id = b.service_id
       LEFT JOIN service_variants sv ON sv.id = b.service_variant_id
       JOIN practitioners p ON p.id = b.practitioner_id
       LEFT JOIN clients c ON c.id = b.client_id
       JOIN businesses biz ON biz.id = b.business_id
       WHERE b.public_token = $1`,
      [token]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Rendez-vous introuvable' });

    const bk = result.rows[0];

    // Fetch group members if this is a grouped booking
    let groupServices = null;
    let groupEndAt = null;
    if (bk.group_id) {
      const grp = await query(
        `SELECT CASE WHEN sv.name IS NOT NULL THEN COALESCE(s.category || ' - ', '') || s.name || ' \u2014 ' || sv.name ELSE COALESCE(s.category || ' - ', '') || s.name END AS name,
                COALESCE(sv.duration_min, s.duration_min) AS duration_min,
                COALESCE(sv.price_cents, s.price_cents) AS price_cents, s.color, b.end_at,
                b.practitioner_id, p.display_name AS practitioner_name, b.start_at AS svc_start_at
         FROM bookings b
         LEFT JOIN services s ON s.id = b.service_id
         LEFT JOIN service_variants sv ON sv.id = b.service_variant_id
         LEFT JOIN practitioners p ON p.id = b.practitioner_id
         WHERE b.group_id = $1 AND b.business_id = (SELECT business_id FROM bookings WHERE public_token = $2)
         ORDER BY b.group_order, b.start_at`,
        [bk.group_id, token]
      );
      if (grp.rows.length > 1) {
        const pracIds = new Set(grp.rows.map(r => r.practitioner_id));
        const isSplit = pracIds.size > 1;
        groupServices = grp.rows.map(r => ({
          name: r.name, duration_min: r.duration_min, price_cents: r.price_cents, color: r.color,
          practitioner_name: isSplit ? r.practitioner_name : null,
          start_at: r.svc_start_at, end_at: r.end_at
        }));
        groupEndAt = grp.rows[grp.rows.length - 1].end_at;
      }
    }

    const cancelWindowHours = bk.business_settings?.cancel_deadline_hours ?? bk.business_settings?.cancellation_window_hours ?? 24;
    const deadline = new Date(new Date(bk.start_at).getTime() - cancelWindowHours * 3600000);
    const canCancel = bk.status === 'pending' || ((['confirmed', 'pending_deposit'].includes(bk.status)) && new Date() < deadline);

    // Build service info: use group members if available, otherwise single service
    const serviceInfo = groupServices
      ? { name: groupServices.map(s => s.name).join(' + '), duration_min: groupServices.reduce((sum, s) => sum + (s.duration_min || 0), 0), price_cents: groupServices.reduce((sum, s) => sum + (s.price_cents || 0), 0), color: bk.service_color, members: groupServices }
      : { name: (bk.service_category ? bk.service_category + ' - ' : '') + (bk.service_name || ''), duration_min: bk.duration_min, price_cents: bk.price_cents, color: bk.service_color };

    res.json({
      booking: {
        id: bk.id, token: bk.public_token,
        start_at: bk.start_at, end_at: groupEndAt || bk.end_at, status: bk.status,
        appointment_mode: bk.appointment_mode, comment: bk.comment_client,
        created_at: bk.created_at,
        deposit_required: bk.deposit_required, deposit_amount_cents: bk.deposit_amount_cents,
        deposit_status: bk.deposit_status, deposit_deadline: bk.deposit_deadline, deposit_payment_url: bk.deposit_payment_url,
        service: serviceInfo,
        practitioner: { name: bk.practitioner_name, title: bk.practitioner_title },
        client: { name: bk.client_name, phone: bk.client_phone, email: bk.client_email }
      },
      business: {
        name: bk.business_name, slug: bk.business_slug,
        phone: bk.business_phone, email: bk.business_email,
        address: bk.business_address, theme: bk.business_theme,
        category_labels: getCategoryLabels(bk.business_category),
        practitioner_label: SECTOR_PRACTITIONER[bk.business_sector] || 'Praticien·ne'
      },
      cancellation: {
        allowed: canCancel,
        deadline: deadline.toISOString(),
        window_hours: cancelWindowHours,
        policy_text: bk.business_settings?.cancel_policy_text || null,
        reason: !canCancel && (bk.status === 'confirmed' || bk.status === 'pending_deposit') ? 'Délai d\'annulation dépassé' : null
      }
    });
  } catch (err) { next(err); }
});

// ============================================================
// GET /api/public/manage/:token
// Booking details + reschedule eligibility
// ============================================================
router.get('/manage/:token', async (req, res, next) => {
  try {
    const { token } = req.params;
    const result = await query(
      `SELECT b.id, b.start_at, b.end_at, b.status, b.appointment_mode,
              b.comment_client, b.public_token, b.created_at, b.group_id,
              b.locked, b.reschedule_count, b.business_id,
              b.service_id, b.service_variant_id, b.practitioner_id,
              b.deposit_required, b.deposit_amount_cents, b.deposit_status, b.deposit_deadline, b.deposit_payment_url,
              CASE WHEN sv.name IS NOT NULL THEN s.name || ' — ' || sv.name ELSE s.name END AS service_name,
              s.category AS service_category,
              COALESCE(sv.duration_min, s.duration_min) AS duration_min,
              COALESCE(sv.price_cents, s.price_cents) AS price_cents,
              s.color AS service_color,
              p.display_name AS practitioner_name, p.title AS practitioner_title,
              c.full_name AS client_name, c.phone AS client_phone, c.email AS client_email,
              biz.name AS business_name, biz.slug AS business_slug, biz.phone AS business_phone,
              biz.email AS business_email, biz.address AS business_address,
              biz.settings AS business_settings, biz.theme AS business_theme,
              biz.category AS business_category, biz.sector AS business_sector
       FROM bookings b
       LEFT JOIN services s ON s.id = b.service_id
       LEFT JOIN service_variants sv ON sv.id = b.service_variant_id
       JOIN practitioners p ON p.id = b.practitioner_id
       LEFT JOIN clients c ON c.id = b.client_id
       JOIN businesses biz ON biz.id = b.business_id
       WHERE b.public_token = $1`,
      [token]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Rendez-vous introuvable' });

    const bk = result.rows[0];
    const settings = bk.business_settings || {};

    // Cancellation (same logic as GET /booking/:token)
    const cancelWindowHours = settings.cancel_deadline_hours ?? settings.cancellation_window_hours ?? 24;
    const cancelDeadline = new Date(new Date(bk.start_at).getTime() - cancelWindowHours * 3600000);
    const canCancel = bk.status === 'pending' || ((['confirmed', 'pending_deposit'].includes(bk.status)) && new Date() < cancelDeadline);

    // Reschedule eligibility
    const reschEnabled = !!settings.reschedule_enabled;
    const reschDeadlineHours = settings.reschedule_deadline_hours ?? 24;
    const reschMaxCount = settings.reschedule_max_count ?? 1;
    const reschWindowDays = settings.reschedule_window_days ?? 30;
    const reschDeadline = new Date(new Date(bk.start_at).getTime() - reschDeadlineHours * 3600000);
    const now = new Date();

    let reschAllowed = true;
    let reschReason = null;
    if (!reschEnabled) { reschAllowed = false; reschReason = null; } // feature off — hide section
    else if (!['confirmed', 'pending_deposit'].includes(bk.status)) { reschAllowed = false; reschReason = 'Le rendez-vous ne peut pas être modifié dans son état actuel.'; }
    else if (bk.locked) { reschAllowed = false; reschReason = 'Ce rendez-vous est verrouillé. Contactez le salon.'; }
    else if ((bk.reschedule_count || 0) >= reschMaxCount) { reschAllowed = false; reschReason = 'Nombre maximum de modifications atteint. Contactez le salon.'; }
    else if (now >= reschDeadline) { reschAllowed = false; reschReason = `Le délai de modification (${reschDeadlineHours}h avant) est dépassé.`; }
    else if (new Date(bk.start_at) <= now) { reschAllowed = false; reschReason = 'Ce rendez-vous est déjà passé.'; }

    // Group members
    let groupServices = null;
    let groupEndAt = null;
    let isSplitBooking = false;
    if (bk.group_id) {
      const grp = await query(
        `SELECT CASE WHEN sv.name IS NOT NULL THEN COALESCE(s.category || ' - ', '') || s.name || ' \u2014 ' || sv.name ELSE COALESCE(s.category || ' - ', '') || s.name END AS name,
                COALESCE(sv.duration_min, s.duration_min) AS duration_min,
                COALESCE(sv.price_cents, s.price_cents) AS price_cents, s.color, b.end_at,
                b.practitioner_id, p.display_name AS practitioner_name, b.start_at AS svc_start_at,
                b.service_id, b.service_variant_id
         FROM bookings b
         LEFT JOIN services s ON s.id = b.service_id
         LEFT JOIN service_variants sv ON sv.id = b.service_variant_id
         LEFT JOIN practitioners p ON p.id = b.practitioner_id
         WHERE b.group_id = $1 AND b.business_id = $2
         ORDER BY b.group_order, b.start_at`,
        [bk.group_id, bk.business_id]
      );
      if (grp.rows.length > 1) {
        const pracIds = new Set(grp.rows.map(r => r.practitioner_id));
        isSplitBooking = pracIds.size > 1;
        groupServices = grp.rows.map(r => ({
          name: r.name, duration_min: r.duration_min, price_cents: r.price_cents, color: r.color,
          practitioner_name: isSplitBooking ? r.practitioner_name : null,
          start_at: r.svc_start_at, end_at: r.end_at
        }));
        groupEndAt = grp.rows[grp.rows.length - 1].end_at;
      }
      // For split reschedule: store service/variant IDs
      if (isSplitBooking) {
        bk._splitServiceIds = grp.rows.map(r => r.service_id);
        bk._splitVariantIds = grp.rows.map(r => r.service_variant_id);
      }
    }

    // Fetch practitioner working days for date navigation
    const workDaysRes = await query(
      `SELECT DISTINCT weekday FROM availabilities
       WHERE practitioner_id = $1 AND business_id = $2 AND is_active = true
       ORDER BY weekday`,
      [bk.practitioner_id, bk.business_id]
    );
    const workingDays = workDaysRes.rows.map(r => r.weekday); // 0=Mon, 1=Tue, ... 6=Sun

    // Split bookings: reschedule IS allowed — we'll use multi-practitioner slot engine

    const serviceInfo = groupServices
      ? { name: groupServices.map(s => s.name).join(' + '), duration_min: groupServices.reduce((sum, s) => sum + (s.duration_min || 0), 0), price_cents: groupServices.reduce((sum, s) => sum + (s.price_cents || 0), 0), color: bk.service_color, members: groupServices }
      : { name: (bk.service_category ? bk.service_category + ' - ' : '') + (bk.service_name || ''), duration_min: bk.duration_min, price_cents: bk.price_cents, color: bk.service_color };

    res.json({
      booking: {
        id: bk.id, token: bk.public_token,
        start_at: bk.start_at, end_at: groupEndAt || bk.end_at, status: bk.status,
        appointment_mode: bk.appointment_mode, comment: bk.comment_client,
        created_at: bk.created_at,
        deposit_required: bk.deposit_required, deposit_amount_cents: bk.deposit_amount_cents,
        deposit_status: bk.deposit_status, deposit_deadline: bk.deposit_deadline, deposit_payment_url: bk.deposit_payment_url,
        service: serviceInfo,
        practitioner: { name: bk.practitioner_name, title: bk.practitioner_title },
        client: { name: bk.client_name, phone: bk.client_phone, email: bk.client_email }
      },
      business: {
        name: bk.business_name, slug: bk.business_slug,
        phone: bk.business_phone, email: bk.business_email,
        address: bk.business_address, theme: bk.business_theme,
        category_labels: getCategoryLabels(bk.business_category),
        practitioner_label: SECTOR_PRACTITIONER[bk.business_sector] || 'Praticien·ne'
      },
      cancellation: {
        allowed: canCancel,
        deadline: cancelDeadline.toISOString(),
        window_hours: cancelWindowHours,
        policy_text: settings.cancel_policy_text || null,
        reason: !canCancel && ['confirmed', 'pending_deposit'].includes(bk.status) ? 'Délai d\'annulation dépassé' : null
      },
      reschedule: {
        enabled: reschEnabled,
        allowed: reschAllowed,
        reason: reschReason,
        count: bk.reschedule_count || 0,
        max_count: reschMaxCount,
        deadline: reschDeadline.toISOString(),
        window_days: reschWindowDays,
        service_id: bk.service_id,
        practitioner_id: bk.practitioner_id,
        variant_id: bk.service_variant_id,
        duration_min: bk.duration_min,
        appointment_mode: bk.appointment_mode,
        is_split: isSplitBooking,
        split_service_ids: bk._splitServiceIds || null,
        split_variant_ids: bk._splitVariantIds || null,
        working_days: workingDays
      }
    });
  } catch (err) { next(err); }
});

module.exports = router;
