/**
 * Pre-RDV document cron job
 * Runs daily — finds bookings N days out, matches templates, sends emails
 * Trigger: GET /api/cron/pre-rdv-docs?key=CRON_SECRET
 */
const router = require('express').Router();
const crypto = require('crypto');
const { query } = require('../../services/db');
const { sendPreRdvEmail } = require('../../services/email');

// Cron authentication via secret key
function requireCronKey(req, res, next) {
  const key = req.query.key || req.headers['x-cron-key'];
  const secret = process.env.CRON_SECRET;
  if (!secret || key !== secret) {
    return res.status(403).json({ error: 'Invalid cron key' });
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
      const targetDate = new Date();
      targetDate.setDate(targetDate.getDate() + parseInt(days));
      const dateStr = targetDate.toISOString().split('T')[0];

      const bookings = await query(
        `SELECT bk.id, bk.service_id, bk.client_id, bk.business_id, bk.start_at, bk.token,
                c.full_name AS client_name, c.email AS client_email,
                s.name AS service_name
         FROM bookings bk
         JOIN clients c ON c.id = bk.client_id
         JOIN services s ON s.id = bk.service_id
         WHERE bk.status = 'confirmed'
           AND DATE(bk.start_at AT TIME ZONE 'Europe/Brussels') = $1
           AND c.email IS NOT NULL AND c.email != ''`,
        [dateStr]
      );

      for (const booking of bookings.rows) {
        // 3. Match templates for this booking
        const matching = tmpls.filter(t =>
          t.biz_id === booking.business_id &&
          (t.service_id === null || t.service_id === booking.service_id)
        );

        for (const template of matching) {
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

          await query(
            `INSERT INTO pre_rdv_sends (business_id, booking_id, template_id, client_id, email_to, token, status)
             VALUES ($1, $2, $3, $4, $5, $6, 'pending')`,
            [booking.business_id, booking.id, template.id, booking.client_id, booking.client_email, token]
          );

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
        }
      }
    }

    const elapsed = Date.now() - started;
    console.log(`[CRON] Pre-RDV docs: ${totalSent} sent, ${totalSkipped} skipped, ${totalFailed} failed (${elapsed}ms)`);
    res.json({ sent: totalSent, skipped: totalSkipped, failed: totalFailed, elapsed_ms: elapsed });
  } catch (err) {
    console.error('[CRON] Pre-RDV docs error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// GET /api/cron/waitlist-expired — process expired waitlist offers
// Run every 5-10 min. Moves expired offers to next in queue (auto mode).
// ============================================================
router.get('/waitlist-expired', async (req, res) => {
  if (req.query.key !== process.env.CRON_SECRET) {
    return res.status(401).json({ error: 'Invalid cron key' });
  }

  try {
    const { processExpiredOffers } = require('../../services/waitlist');
    const result = await processExpiredOffers();
    console.log(`[CRON] Waitlist expired: ${result.processed} processed`);
    res.json(result);
  } catch (err) {
    console.error('[CRON] Waitlist expired error:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
