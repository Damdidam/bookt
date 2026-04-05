const router = require('express').Router();
const { query } = require('../../services/db');
const { bookingActionLimiter } = require('../../middleware/rate-limiter');

// ============================================================
// GET /api/public/booking/:token/calendar.ics
// ICS calendar export (legacy endpoint)
// ============================================================
router.get('/booking/:token/calendar.ics', bookingActionLimiter, async (req, res, next) => {
  try {
    const { token } = req.params;
    const result = await query(
      `SELECT b.start_at, b.end_at, b.group_id, b.business_id,
              CASE WHEN sv.name IS NOT NULL THEN s.name || ' — ' || sv.name ELSE s.name END AS service_name,
                  s.category AS service_category,
              p.display_name AS practitioner_name,
              biz.name AS business_name, biz.address AS business_address
       FROM bookings b
       LEFT JOIN services s ON s.id = b.service_id
       LEFT JOIN service_variants sv ON sv.id = b.service_variant_id
       LEFT JOIN practitioners p ON p.id = b.practitioner_id
       JOIN businesses biz ON biz.id = b.business_id
       WHERE b.public_token = $1`,
      [token]
    );
    if (result.rows.length === 0) return res.status(404).send('Not found');
    const bk = result.rows[0];

    // For multi-service groups, get all services and use last end_at
    let summary = bk.service_name || 'Rendez-vous';
    let endAt = bk.end_at;
    if (bk.group_id) {
      const grp = await query(
        `SELECT CASE WHEN sv.name IS NOT NULL THEN COALESCE(s.category || ' - ', '') || s.name || ' — ' || sv.name ELSE COALESCE(s.category || ' - ', '') || s.name END AS name, b.end_at
         FROM bookings b LEFT JOIN services s ON s.id = b.service_id
         LEFT JOIN service_variants sv ON sv.id = b.service_variant_id
         WHERE b.group_id = $1 AND b.business_id = $2
         ORDER BY b.group_order, b.start_at`,
        [bk.group_id, bk.business_id]
      );
      if (grp.rows.length > 1) {
        summary = grp.rows.map(r => r.name).join(' + ');
        endAt = grp.rows[grp.rows.length - 1].end_at;
      }
    }

    const fmtDt = (d) => new Date(d).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
    const uid = `booking-${token}@genda.be`;
    const now = fmtDt(new Date());
    const title = `${summary} — ${bk.business_name}`;
    const desc = bk.practitioner_name ? `Avec ${bk.practitioner_name}` : '';
    const location = bk.business_address || '';

    const ics = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//Genda//Booking//FR',
      'CALSCALE:GREGORIAN',
      'METHOD:PUBLISH',
      'BEGIN:VEVENT',
      `UID:${uid}`,
      `DTSTAMP:${now}`,
      `DTSTART:${fmtDt(bk.start_at)}`,
      `DTEND:${fmtDt(endAt || bk.start_at)}`,
      `SUMMARY:${title.replace(/[,;\\]/g, ' ')}`,
      desc ? `DESCRIPTION:${desc.replace(/[,;\\]/g, ' ')}` : '',
      location ? `LOCATION:${location.replace(/[,;\\]/g, ' ')}` : '',
      'STATUS:CONFIRMED',
      'BEGIN:VALARM',
      'TRIGGER:-PT1H',
      'ACTION:DISPLAY',
      'DESCRIPTION:Rappel rendez-vous',
      'END:VALARM',
      'END:VEVENT',
      'END:VCALENDAR'
    ].filter(Boolean).join('\r\n');

    res.set({
      'Content-Type': 'text/calendar; charset=utf-8',
      'Content-Disposition': `attachment; filename="rdv-${(bk.business_name || 'genda').replace(/[^a-zA-Z0-9]/g, '_')}.ics"`
    });
    res.send(ics);
  } catch (err) {
    console.error('[ICS] Error:', err.message);
    next(err);
  }
});

// ============================================================
// GET /api/public/booking/:token/ics
// ICS calendar export (new endpoint)
// ============================================================
router.get('/booking/:token/ics', bookingActionLimiter, async (req, res, next) => {
  try {
    const result = await query(
      `SELECT b.id, b.start_at, b.end_at, b.appointment_mode, b.group_id, b.business_id,
              CASE WHEN sv.name IS NOT NULL THEN s.name || ' — ' || sv.name ELSE s.name END AS service_name,
                  s.category AS service_category,
              COALESCE(sv.duration_min, s.duration_min) AS duration_min,
              c.full_name AS client_name,
              p.display_name AS practitioner_name,
              biz.name AS business_name, biz.address AS business_address
       FROM bookings b
       LEFT JOIN services s ON s.id = b.service_id
       LEFT JOIN service_variants sv ON sv.id = b.service_variant_id
       LEFT JOIN clients c ON c.id = b.client_id
       JOIN practitioners p ON p.id = b.practitioner_id
       JOIN businesses biz ON biz.id = b.business_id
       WHERE b.public_token = $1 AND b.status IN ('confirmed','pending','modified_pending','pending_deposit')`,
      [req.params.token]
    );
    if (result.rows.length === 0) return res.status(404).send('Rendez-vous introuvable');

    const bk = result.rows[0];
    // Override end_at and summary for group bookings
    let endAt = bk.end_at;
    let serviceName = bk.service_name || 'Rendez-vous';
    if (bk.group_id) {
      const grp = await query(
        `SELECT CASE WHEN sv.name IS NOT NULL THEN COALESCE(s.category || ' - ', '') || s.name || ' — ' || sv.name ELSE COALESCE(s.category || ' - ', '') || s.name END AS name, b2.end_at
         FROM bookings b2
         LEFT JOIN services s ON s.id = b2.service_id
         LEFT JOIN service_variants sv ON sv.id = b2.service_variant_id
         WHERE b2.group_id = $1 AND b2.business_id = $2
         ORDER BY b2.group_order, b2.start_at`,
        [bk.group_id, bk.business_id]
      );
      if (grp.rows.length > 1) {
        endAt = grp.rows[grp.rows.length - 1].end_at;
        serviceName = grp.rows.map(r => r.name).join(' + ');
      }
    }
    const start = new Date(bk.start_at);
    const end = new Date(endAt);
    const summary = `${serviceName} — ${bk.practitioner_name || ''}`;
    const loc = bk.appointment_mode === 'visio' ? 'Visioconférence' : bk.appointment_mode === 'phone' ? 'Téléphone' : (bk.business_address || bk.business_name);
    const desc = [bk.service_name || 'Rendez-vous', bk.practitioner_name ? `Avec ${bk.practitioner_name}` : '', bk.business_name].filter(Boolean).join('\\n');

    function icalDtUTC(d) {
      return d.getUTCFullYear() + String(d.getUTCMonth()+1).padStart(2,'0') + String(d.getUTCDate()).padStart(2,'0') +
        'T' + String(d.getUTCHours()).padStart(2,'0') + String(d.getUTCMinutes()).padStart(2,'0') + String(d.getUTCSeconds()).padStart(2,'0') + 'Z';
    }
    function esc(s) { if (!s) return ''; return String(s).replace(/\\/g,'\\\\').replace(/;/g,'\\;').replace(/,/g,'\\,').replace(/\n/g,'\\n').replace(/\r/g,''); }

    const ical = `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Genda//Booking//FR\r\nBEGIN:VEVENT\r\nUID:${bk.id}@genda.be\r\nDTSTART:${icalDtUTC(start)}\r\nDTEND:${icalDtUTC(end)}\r\nSUMMARY:${esc(summary)}\r\nDESCRIPTION:${esc(desc)}\r\nLOCATION:${esc(loc)}\r\nSTATUS:CONFIRMED\r\nBEGIN:VALARM\r\nTRIGGER:-PT30M\r\nACTION:DISPLAY\r\nDESCRIPTION:Rappel RDV\r\nEND:VALARM\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n`;

    res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="rdv-genda.ics"`);
    res.send(ical);
  } catch (err) { next(err); }
});

module.exports = router;
