/**
 * Pre-RDV document cron job
 * Runs daily — finds bookings N days out, matches templates, sends emails
 * Trigger: GET /api/cron/pre-rdv-docs?key=CRON_SECRET
 */
const router = require('express').Router();
const crypto = require('crypto');
const { query } = require('../../services/db');
const { sendPreRdvEmail } = require('../../services/email');

// Cron authentication via secret key (timing-safe comparison)
// SVC-V11-16: Hash both values before comparing to avoid leaking secret length
function requireCronKey(req, res, next) {
  const key = req.query.key || req.headers['x-cron-key'];
  const secret = process.env.CRON_SECRET;
  if (!secret || !key) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  const ha = crypto.createHash('sha256').update(String(key)).digest();
  const hb = crypto.createHash('sha256').update(String(secret)).digest();
  if (!crypto.timingSafeEqual(ha, hb)) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  next();
}

/**
 * GET /api/cron/pre-rdv-docs
 * Scans all active templates, finds matching bookings, creates sends, emails clients
 */
router.get('/pre-rdv-docs', requireCronKey, async (req, res) => {
  const started = Date.now();
  let totalSent = 0, totalSkipped = 0, totalFailed = 0;

  try {
    // 1. Get all active templates grouped by send_days_before
    const templates = await query(
      `SELECT dt.*, b.name AS business_name, b.email AS business_email,
              b.address AS business_address, b.theme, b.id AS biz_id
       FROM document_templates dt
       JOIN businesses b ON b.id = dt.business_id
       WHERE dt.is_active = true AND b.is_active = true
       ORDER BY dt.send_days_before`
    );

    if (templates.rows.length === 0) {
      return res.json({ message: 'No active templates', sent: 0 });
    }

    // Group by send_days_before for efficient booking queries
    const byDays = {};
    templates.rows.forEach(t => {
      const d = t.send_days_before || 2;
      if (!byDays[d]) byDays[d] = [];
      byDays[d].push(t);
    });

    for (const [days, tmpls] of Object.entries(byDays)) {
      // 2. Find bookings exactly N days from now with confirmed status
      // RTE-V10-013: Use Brussels timezone for targetDate calculation
      // SVC-V12-005: Deterministic UTC-based date construction
      const brusselsDate = new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Brussels' });
      const [y, m, d] = brusselsDate.split('-').map(Number);
      const target = new Date(Date.UTC(y, m - 1, d + parseInt(days)));
      const dateStr = target.toISOString().split('T')[0];

      // RTE-V10-012: Filter bookings by business_ids of the templates in this group
      const businessIds = [...new Set(tmpls.map(t => t.biz_id))];

      const bookings = await query(
        `SELECT bk.id, bk.service_id, bk.client_id, bk.business_id, bk.start_at, bk.token,
                c.full_name AS client_name, c.email AS client_email,
                CASE WHEN sv.name IS NOT NULL THEN s.name || ' — ' || sv.name ELSE s.name END AS service_name
         FROM bookings bk
         JOIN clients c ON c.id = bk.client_id
         JOIN services s ON s.id = bk.service_id
         LEFT JOIN service_variants sv ON sv.id = bk.service_variant_id
         WHERE bk.status = 'confirmed'
           AND DATE(bk.start_at AT TIME ZONE 'Europe/Brussels') = $1
           AND c.email IS NOT NULL AND c.email != ''
           AND bk.business_id = ANY($2)`,
        [dateStr, businessIds]
      );

      for (const booking of bookings.rows) {
        // 3. Match templates for this booking
        const matching = tmpls.filter(t =>
          t.biz_id === booking.business_id &&
          (t.service_id === null || t.service_id === booking.service_id)
        );

        for (const template of matching) {
          // SVC-V11-13: Wrap each notification insert+send in try/catch
          // so one failure doesn't abort the entire batch
          try {
            // 4. Check if already sent for this booking+template
            const existing = await query(
              `SELECT id FROM pre_rdv_sends
               WHERE booking_id = $1 AND template_id = $2`,
              [booking.id, template.id]
            );

            if (existing.rows.length > 0) {
              totalSkipped++;
              continue;
            }

            // 5. Create send record + send email
            const token = crypto.randomBytes(32).toString('hex');

            const insertResult = await query(
              `INSERT INTO pre_rdv_sends (business_id, booking_id, template_id, client_id, email_to, token, status)
               VALUES ($1, $2, $3, $4, $5, $6, 'pending')
               ON CONFLICT (booking_id, template_id) DO NOTHING
               RETURNING id`,
              [booking.business_id, booking.id, template.id, booking.client_id, booking.client_email, token]
            );

            // Another cron instance already inserted this row — skip
            if (insertResult.rows.length === 0) {
              totalSkipped++;
              continue;
            }

            const business = {
              name: template.business_name,
              email: template.business_email,
              address: template.business_address,
              theme: template.theme
            };

            const result = await sendPreRdvEmail({ booking, template, token, business });

            if (result.success) {
              await query(
                `UPDATE pre_rdv_sends SET status = 'sent', sent_at = NOW() WHERE token = $1`,
                [token]
              );
              totalSent++;
            } else {
              await query(
                `UPDATE pre_rdv_sends SET status = 'failed' WHERE token = $1`,
                [token]
              );
              totalFailed++;
            }
          } catch (sendErr) {
            console.error(`[CRON] Pre-RDV send error for booking=${booking.id} template=${template.id}:`, sendErr.message);
            totalFailed++;
          }
        }
      }
    }

    const elapsed = Date.now() - started;
    console.log(`[CRON] Pre-RDV docs: ${totalSent} sent, ${totalSkipped} skipped, ${totalFailed} failed (${elapsed}ms)`);
    res.json({ sent: totalSent, skipped: totalSkipped, failed: totalFailed, elapsed_ms: elapsed });
  } catch (err) {
    console.error('[CRON] Pre-RDV docs error:', err);
    res.status(500).json({ error: process.env.NODE_ENV === 'production' ? 'Internal error' : err.message });
  }
});

// ============================================================
// GET /api/cron/waitlist-expired — process expired waitlist offers
// Run every 5-10 min. Moves expired offers to next in queue (auto mode).
// ============================================================
// SVC-V11-7: Use shared requireCronKey middleware instead of duplicated inline check
router.get('/waitlist-expired', requireCronKey, async (req, res) => {
  try {
    const { processExpiredOffers } = require('../../services/waitlist');
    const result = await processExpiredOffers();
    console.log(`[CRON] Waitlist expired: ${result.processed} processed`);
    res.json(result);
  } catch (err) {
    console.error('[CRON] Waitlist expired error:', err);
    res.status(500).json({ error: process.env.NODE_ENV === 'production' ? 'Internal error' : err.message });
  }
});

// ============================================================
// GET /api/cron/reminders — send patient email + SMS reminders
// Run every 10 min. Sends 24h and 2h reminders for upcoming bookings.
// ============================================================
router.get('/reminders', requireCronKey, async (req, res) => {
  const started = Date.now();
  try {
    const { processReminders } = require('../../services/reminders');
    const stats = await processReminders();
    const elapsed = Date.now() - started;
    console.log(`[CRON] Reminders: ${JSON.stringify(stats)} (${elapsed}ms)`);
    res.json({ ...stats, elapsed_ms: elapsed });
  } catch (err) {
    console.error('[CRON] Reminders error:', err);
    res.status(500).json({ error: process.env.NODE_ENV === 'production' ? 'Internal error' : err.message });
  }
});

// ============================================================
// GET /api/cron/deposit-reminders — auto-remind clients with pending deposits
// Run every hour. Sends reminder when deadline is within 48h and not yet reminded.
// ============================================================
router.get('/deposit-reminders', requireCronKey, async (req, res) => {
  const started = Date.now();
  let sent = 0, skipped = 0, failed = 0;

  try {
    // Find all pending_deposit bookings where:
    // - deposit_reminder_sent = false (or NULL)
    // - deadline is within 48h from now (but not past)
    // - client has email
    const bookings = await query(`
      SELECT b.id, b.start_at, b.end_at, b.deposit_amount_cents, b.deposit_deadline,
             b.public_token, b.group_id, b.business_id,
             c.full_name AS client_name, c.email AS client_email,
             CASE WHEN sv.name IS NOT NULL THEN s.name || ' — ' || sv.name ELSE s.name END AS service_name,
             p.display_name AS practitioner_name,
             biz.name AS business_name, biz.email AS business_email,
             biz.address AS business_address, biz.theme, biz.settings
      FROM bookings b
      LEFT JOIN clients c ON c.id = b.client_id
      LEFT JOIN services s ON s.id = b.service_id
      LEFT JOIN service_variants sv ON sv.id = b.service_variant_id
      JOIN practitioners p ON p.id = b.practitioner_id
      JOIN businesses biz ON biz.id = b.business_id
      WHERE b.status = 'pending_deposit'
        AND b.deposit_status = 'pending'
        AND b.deposit_required = true
        AND (b.deposit_reminder_sent IS NULL OR b.deposit_reminder_sent = false)
        AND b.deposit_deadline IS NOT NULL
        AND b.deposit_deadline > NOW()
        AND b.deposit_deadline <= NOW() + INTERVAL '48 hours'
        AND c.email IS NOT NULL AND c.email != ''
        AND biz.is_active = true
    `);

    for (const bk of bookings.rows) {
      try {
        // Fetch group services if applicable
        let groupServices = null;
        if (bk.group_id) {
          const grp = await query(
            `SELECT CASE WHEN sv.name IS NOT NULL THEN s.name || ' — ' || sv.name ELSE s.name END AS name,
                    COALESCE(sv.duration_min, s.duration_min) AS duration_min,
                    COALESCE(sv.price_cents, s.price_cents) AS price_cents, b2.end_at
             FROM bookings b2 LEFT JOIN services s ON s.id = b2.service_id
             LEFT JOIN service_variants sv ON sv.id = b2.service_variant_id
             WHERE b2.group_id = $1 AND b2.business_id = $2
             ORDER BY b2.group_order, b2.start_at`,
            [bk.group_id, bk.business_id]
          );
          if (grp.rows.length > 1) {
            groupServices = grp.rows;
            bk.end_at = grp.rows[grp.rows.length - 1].end_at;
          }
        }

        const baseUrl = process.env.APP_BASE_URL || process.env.BASE_URL || 'https://genda.be';
        const depositUrl = `${baseUrl}/deposit/${bk.public_token}`;
        const payUrl = `${baseUrl}/api/public/deposit/${bk.public_token}/pay`;

        const { sendDepositReminderEmail } = require('../../services/email');
        const result = await sendDepositReminderEmail({
          booking: bk,
          business: { name: bk.business_name, email: bk.business_email, address: bk.business_address, theme: bk.theme, settings: bk.settings },
          depositUrl,
          payUrl,
          groupServices
        });

        if (result.success) {
          // Mark as reminded
          await query(`UPDATE bookings SET deposit_reminder_sent = true WHERE id = $1`, [bk.id]);
          // Log notification
          await query(`
            INSERT INTO notifications (business_id, booking_id, type, recipient_email, status, provider, provider_message_id, sent_at)
            VALUES ($1, $2, 'email_deposit_reminder', $3, 'sent', 'brevo', $4, NOW())
          `, [bk.business_id, bk.id, bk.client_email, result.messageId || null]);
          sent++;
        } else {
          failed++;
        }
      } catch (e) {
        console.error(`[CRON] Deposit reminder error for booking=${bk.id}:`, e.message);
        failed++;
      }
    }

    const elapsed = Date.now() - started;
    console.log(`[CRON] Deposit reminders: ${sent} sent, ${skipped} skipped, ${failed} failed (${elapsed}ms)`);
    res.json({ sent, skipped, failed, elapsed_ms: elapsed });
  } catch (err) {
    console.error('[CRON] Deposit reminders error:', err);
    res.status(500).json({ error: process.env.NODE_ENV === 'production' ? 'Internal error' : err.message });
  }
});

module.exports = router;

// ============================================================
// Reminder engine export (for in-process cron in server.js)
// ============================================================
module.exports.processReminders = require('../../services/reminders').processReminders;
