const router = require('express').Router();
const { queryWithRLS } = require('../../services/db');
const { requireAuth, resolvePractitionerScope, requirePro, blockIfImpersonated } = require('../../middleware/auth');
const { sendEmail, buildEmailHTML, escHtml } = require('../../services/email');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

router.use(requireAuth);
router.use(requirePro);
router.use(resolvePractitionerScope);

// ============================================================
// GET /api/waitlist — list waitlist entries with filters
// Dashboard: section Liste d'attente
// ============================================================
router.get('/', async (req, res, next) => {
  try {
    const bid = req.businessId;
    const { practitioner_id, service_id, status } = req.query;

    // Validate UUID query params
    if (practitioner_id && !UUID_RE.test(practitioner_id)) return res.status(400).json({ error: 'practitioner_id invalide' });
    if (service_id && !UUID_RE.test(service_id)) return res.status(400).json({ error: 'service_id invalide' });

    let where = 'w.business_id = $1';
    const params = [bid];
    let idx = 2;

    // Apply practitioner scope filter
    const pracFilter = req.practitionerFilter;
    if (pracFilter) {
      where += ` AND w.practitioner_id = $${idx}`;
      params.push(pracFilter);
      idx++;
    } else if (practitioner_id) {
      where += ` AND w.practitioner_id = $${idx}`;
      params.push(practitioner_id);
      idx++;
    }
    if (service_id) {
      where += ` AND w.service_id = $${idx}`;
      params.push(service_id);
      idx++;
    }
    if (status) {
      where += ` AND w.status = $${idx}`;
      params.push(status);
      idx++;
    } else {
      where += ` AND w.status IN ('waiting', 'offered')`;
    }

    const result = await queryWithRLS(bid,
      `SELECT w.*,
        p.display_name AS practitioner_name,
        s.name AS service_name, s.duration_min
       FROM waitlist_entries w
       JOIN practitioners p ON p.id = w.practitioner_id
       JOIN services s ON s.id = w.service_id
       WHERE ${where}
       ORDER BY w.priority ASC, w.created_at ASC`,
      params
    );

    // Stats
    const stats = await queryWithRLS(bid,
      `SELECT
        COUNT(*) FILTER (WHERE status = 'waiting') AS waiting,
        COUNT(*) FILTER (WHERE status = 'offered') AS offered,
        COUNT(*) FILTER (WHERE status = 'booked') AS booked,
        COUNT(*) FILTER (WHERE status = 'expired') AS expired
       FROM waitlist_entries WHERE business_id = $1`,
      [bid]
    );

    res.json({
      entries: result.rows,
      stats: stats.rows[0]
    });
  } catch (err) { next(err); }
});

// ============================================================
// POST /api/waitlist — manually add someone to waitlist (pro)
// ============================================================
router.post('/', async (req, res, next) => {
  try {
    const bid = req.businessId;
    const { practitioner_id, service_id, service_variant_id, client_name, client_email,
            client_phone, preferred_days, preferred_time, note } = req.body;

    if (!practitioner_id || !service_id || !client_name || !client_email) {
      return res.status(400).json({ error: 'Praticien, prestation, nom et email requis' });
    }

    // V12-018: Force practitioner_id for practitioner-role users
    const finalPracId = req.user.role === 'practitioner' ? req.user.practitionerId : practitioner_id;

    // Verify practitioner belongs to business
    const pracCheck = await queryWithRLS(bid,
      `SELECT id FROM practitioners WHERE id = $1 AND business_id = $2`,
      [finalPracId, bid]
    );
    if (pracCheck.rows.length === 0) {
      return res.status(400).json({ error: 'Praticien invalide pour ce salon' });
    }

    // Verify service belongs to business
    const svcCheck = await queryWithRLS(bid,
      `SELECT id FROM services WHERE id = $1 AND business_id = $2`,
      [service_id, bid]
    );
    if (svcCheck.rows.length === 0) {
      return res.status(400).json({ error: 'Prestation invalide pour ce salon' });
    }

    // Optional variant — verify it belongs to this service + business (BUG-WL-VARIANT-STAFF fix)
    let finalVariantId = null;
    if (service_variant_id) {
      const varCheck = await queryWithRLS(bid,
        `SELECT sv.id FROM service_variants sv
           JOIN services s ON s.id = sv.service_id
          WHERE sv.id = $1 AND sv.service_id = $2 AND s.business_id = $3`,
        [service_variant_id, service_id, bid]
      );
      if (varCheck.rows.length === 0) {
        return res.status(400).json({ error: 'Variante de prestation invalide' });
      }
      finalVariantId = service_variant_id;
    }

    // Duplicate check: same email already waiting for this (practitioner, service, variant).
    // Variant-aware: NULL=NULL via IS NOT DISTINCT FROM (entry variant A n'empêche pas variant B).
    const dupCheck = await queryWithRLS(bid,
      `SELECT 1 FROM waitlist_entries
       WHERE business_id = $1 AND practitioner_id = $2 AND service_id = $3
         AND service_variant_id IS NOT DISTINCT FROM $5
         AND LOWER(client_email) = LOWER($4) AND status = 'waiting'
       LIMIT 1`,
      [bid, finalPracId, service_id, client_email.toLowerCase().trim(), finalVariantId]
    );
    if (dupCheck.rows.length > 0) {
      return res.status(409).json({ error: 'Ce client est déjà en liste d\'attente pour cette prestation' });
    }

    // Validate preferred_days: must be an array of integers 0-6
    let validatedDays = [0,1,2,3,4];
    if (preferred_days !== undefined) {
      if (!Array.isArray(preferred_days) || !preferred_days.every(d => Number.isInteger(d) && d >= 0 && d <= 6)) {
        return res.status(400).json({ error: 'preferred_days doit être un tableau d\'entiers entre 0 et 6' });
      }
      validatedDays = preferred_days;
    }

    // Get next priority
    const maxP = await queryWithRLS(bid,
      `SELECT COALESCE(MAX(priority), 0) + 1 AS next_priority
       FROM waitlist_entries
       WHERE practitioner_id = $1 AND service_id = $2 AND status = 'waiting'`,
      [finalPracId, service_id]
    );

    const result = await queryWithRLS(bid,
      `INSERT INTO waitlist_entries
        (business_id, practitioner_id, service_id, service_variant_id, client_name, client_email,
         client_phone, preferred_days, preferred_time, note, priority)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       RETURNING *`,
      [bid, finalPracId, service_id, finalVariantId, client_name, client_email,
       client_phone || null,
       JSON.stringify(validatedDays),
       preferred_time || 'any',
       note || null,
       maxP.rows[0].next_priority]
    );

    res.status(201).json({ entry: result.rows[0] });
  } catch (err) { next(err); }
});

// ============================================================
// PATCH /api/waitlist/:id — update entry (notes, status)
// ============================================================
router.patch('/:id', async (req, res, next) => {
  try {
    const bid = req.businessId;
    const { id } = req.params;
    if (!UUID_RE.test(id)) return res.status(400).json({ error: 'ID invalide' });
    const { staff_notes, status } = req.body;

    const sets = ['updated_at = NOW()'];
    const params = [id, bid];
    let idx = 3;

    if (staff_notes !== undefined) {
      sets.push(`staff_notes = $${idx}`);
      params.push(staff_notes);
      idx++;
    }
    if (status) {
      // BUG-WL-PATCH-STATUS fix: forbid staff-manual 'booked' — requires offer_booking_id
      // which only the accept flow can set. Allowing 'booked' via PATCH yields stats with
      // no linked booking (dashboard KPI broken). 'waiting'→'cancelled'/'declined' OK.
      const valid = ['waiting', 'offered', 'expired', 'cancelled', 'declined'];
      if (!valid.includes(status)) {
        return res.status(400).json({
          error: status === 'booked'
            ? 'Statut "booked" ne peut pas être défini manuellement — utilisez l\'acceptation d\'offre'
            : 'Statut invalide'
        });
      }
      sets.push(`status = $${idx}`);
      params.push(status);
      idx++;
    }

    // V13-007: Add practitioner scope check
    let whereSql = `WHERE id = $1 AND business_id = $2`;
    if (req.practitionerFilter) {
      whereSql += ` AND practitioner_id = $${idx}`;
      params.push(req.practitionerFilter);
      idx++;
    }

    const result = await queryWithRLS(bid,
      `UPDATE waitlist_entries SET ${sets.join(', ')}
       ${whereSql} RETURNING *`,
      params
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Entrée introuvable' });

    res.json({ entry: result.rows[0] });
  } catch (err) { next(err); }
});

// ============================================================
// DELETE /api/waitlist/:id — remove entry
// ============================================================
router.delete('/:id', blockIfImpersonated, async (req, res, next) => {
  try {
    if (!UUID_RE.test(req.params.id)) return res.status(400).json({ error: 'ID invalide' });
    // V13-008: Add practitioner scope check
    let sql = `UPDATE waitlist_entries SET status = 'cancelled', updated_at = NOW()
       WHERE id = $1 AND business_id = $2`;
    const params = [req.params.id, req.businessId];
    if (req.practitionerFilter) {
      sql += ` AND practitioner_id = $3`;
      params.push(req.practitionerFilter);
    }
    await queryWithRLS(req.businessId, sql, params);
    res.json({ deleted: true });
  } catch (err) { next(err); }
});

// ============================================================
// POST /api/waitlist/:id/offer — manually send offer (manual mode)
// Pro picks an entry and sends them a slot
// ============================================================
router.post('/:id/offer', async (req, res, next) => {
  try {
    const bid = req.businessId;
    const { id } = req.params;
    if (!UUID_RE.test(id)) return res.status(400).json({ error: 'ID invalide' });
    const { start_at, end_at } = req.body;

    if (!start_at || !end_at) {
      return res.status(400).json({ error: 'Créneau requis (start_at, end_at)' });
    }

    // V13-009: Add practitioner scope check
    // Parité cascades : LEFT JOIN sv + guard is_active pour refuser d'offrir à une entry
    // dont le variant a été désactivé (cohérence avec processWaitlistForCancellation,
    // processExpiredOffers cascade, decline cascade publique, gap-engine).
    let offerSql = `SELECT we.* FROM waitlist_entries we
                      LEFT JOIN service_variants sv ON sv.id = we.service_variant_id
                    WHERE we.id = $1 AND we.business_id = $2 AND we.status = 'waiting'
                      AND (we.service_variant_id IS NULL OR sv.is_active = true)`;
    const offerParams = [id, bid];
    if (req.practitionerFilter) {
      offerSql += ` AND we.practitioner_id = $3`;
      offerParams.push(req.practitionerFilter);
    }
    const entry = await queryWithRLS(bid, offerSql, offerParams);
    if (entry.rows.length === 0) {
      return res.status(404).json({ error: 'Entrée introuvable, déjà traitée, ou variante désactivée' });
    }

    // Validate dates
    const offerStart = new Date(start_at);
    const offerEnd = new Date(end_at);
    if (isNaN(offerStart.getTime()) || isNaN(offerEnd.getTime())) {
      return res.status(400).json({ error: 'Dates invalides' });
    }
    if (offerStart >= offerEnd) {
      return res.status(400).json({ error: 'La date de début doit être avant la date de fin' });
    }
    // BUG-WL-MIN-NOTICE fix: seuil configurable via business settings au lieu de 1h hardcoded.
    // Certains salons (urgence, last-minute) veulent offrir des slots à < 1h du RDV.
    // Utilise parseInt+isFinite pour traiter la valeur 0 explicite (zero notice = urgence)
    // correctement — le pattern `||` aurait écrasé 0 en falsy.
    const bizSet = await queryWithRLS(bid, `SELECT settings FROM businesses WHERE id = $1`, [bid]);
    const _wlSettings = bizSet.rows[0]?.settings || {};
    const _rawMinNotice = parseInt(_wlSettings.waitlist_min_notice_minutes);
    const _rawMinNoticeHours = parseInt(_wlSettings.min_notice_hours);
    const _minNoticeMinutes = Number.isFinite(_rawMinNotice) ? _rawMinNotice
                             : (Number.isFinite(_rawMinNoticeHours) ? _rawMinNoticeHours * 60 : 60);
    if (offerStart.getTime() < Date.now() + _minNoticeMinutes * 60000) {
      return res.status(400).json({ error: `Le créneau doit être au moins ${Math.round(_minNoticeMinutes / 60 * 10) / 10}h dans le futur` });
    }

    // BUG-WL-ADVISORY-LOCK fix: the conflict check + UPDATE pattern had a race window —
    // two staff offering the same slot simultaneously could both pass the check. Wrap the
    // check+UPDATE in a transaction with pg_advisory_xact_lock on (practitioner, start_at)
    // to serialize concurrent offers on the same slot.
    const wlPracId = entry.rows[0].practitioner_id;
    const { getMaxConcurrent } = require('./bookings-helpers');
    const maxConc = await getMaxConcurrent(bid, wlPracId);
    const token = require('crypto').randomBytes(20).toString('hex');
    const expiresAt = new Date(Date.now() + 2 * 60 * 60 * 1000); // 2h
    const { transactionWithRLS } = require('../../services/db');
    try {
      await transactionWithRLS(bid, async (txClient) => {
        await txClient.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`${wlPracId}_${offerStart.toISOString()}`]);
        const conflictCheck = await txClient.query(
          `SELECT COUNT(*)::int AS cnt FROM bookings
           WHERE business_id = $1 AND practitioner_id = $2
             AND status NOT IN ('cancelled', 'no_show')
             AND start_at < $4 AND end_at > $3`,
          [bid, wlPracId, start_at, end_at]
        );
        if (conflictCheck.rows[0].cnt >= maxConc) {
          throw Object.assign(new Error('Conflit : un rendez-vous existe déjà sur ce créneau'), { type: 'conflict', status: 409 });
        }
        await txClient.query(
          `UPDATE waitlist_entries SET
            status = 'offered',
            offer_token = $1,
            offer_booking_start = $2,
            offer_booking_end = $3,
            offer_sent_at = NOW(),
            offer_expires_at = $4,
            updated_at = NOW()
           WHERE id = $5 AND business_id = $6`,
          [token, start_at, end_at, expiresAt.toISOString(), id, bid]
        );
      });
    } catch (err) {
      if (err.status === 409) return res.status(409).json({ error: err.message });
      throw err;
    }

    const offerUrl = `${process.env.APP_BASE_URL || process.env.BASE_URL || 'https://genda.be'}/waitlist/${token}`;
    const wEntry = entry.rows[0];

    // Fetch practitioner, service, business info for the email
    const detailsResult = await queryWithRLS(bid,
      `SELECT p.display_name AS practitioner_name,
              s.name AS service_name, s.duration_min, s.price_cents,
              b.name AS business_name, b.theme, b.address, b.phone, b.email AS business_email
       FROM practitioners p
       JOIN services s ON s.id = $2 AND s.business_id = $3
       JOIN businesses b ON b.id = $3
       WHERE p.id = $1 AND p.business_id = $3`,
      [wEntry.practitioner_id, wEntry.service_id, bid]
    );
    const details = detailsResult.rows[0];

    if (details) {
      const slotDateFmt = new Date(start_at).toLocaleDateString('fr-BE', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Europe/Brussels' });
      const slotTimeFmt = new Date(start_at).toLocaleTimeString('fr-BE', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Brussels' });
      const slotEndTimeFmt = new Date(new Date(start_at).getTime() + (details.duration_min || 0) * 60000)
        .toLocaleTimeString('fr-BE', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Brussels' });

      const contactParts = [];
      if (details.phone) contactParts.push(escHtml(details.phone));
      if (details.business_email) contactParts.push(escHtml(details.business_email));
      const contactLine = contactParts.length > 0 ? `<p style="margin:8px 0 0;font-size:13px;color:#9C958E">${contactParts.join(' \u00b7 ')}</p>` : '';

      const offerHtml = buildEmailHTML({
        title: 'Un cr\u00e9neau s\'est lib\u00e9r\u00e9 !',
        preheader: `${details.service_name} chez ${details.practitioner_name} \u2014 ${slotDateFmt} \u00e0 ${slotTimeFmt}`,
        bodyHTML: `<p>Bonjour ${escHtml(wEntry.client_name)},</p>
          <p>Bonne nouvelle ! Un cr\u00e9neau s'est lib\u00e9r\u00e9 pour votre demande :</p>
          <div style="background:#F5F4F1;border-radius:8px;padding:16px;margin:16px 0">
            <p style="margin:0 0 6px"><strong>${escHtml(details.service_name)}</strong> (${details.duration_min} min)</p>
            ${details.price_cents ? `<p style="margin:0 0 4px;font-size:14px;color:#3D3832">${(details.price_cents / 100).toFixed(2).replace('.', ',')} \u20ac</p>` : ''}
            <p style="margin:0 0 4px;font-size:14px;color:#3D3832">Avec ${escHtml(details.practitioner_name)}</p>
            <p style="margin:0;font-size:14px;color:#3D3832">${escHtml(slotDateFmt)} \u00e0 ${escHtml(slotTimeFmt)} \u2013 ${slotEndTimeFmt}</p>
            ${details.address ? `<p style="margin:4px 0 0;font-size:14px;color:#3D3832">\ud83d\udccd <a href="https://maps.google.com/?q=${encodeURIComponent(details.address)}" style="color:#3D3832">${escHtml(details.address)}</a></p>` : ''}
          </div>${contactLine}
          <p style="font-weight:600;color:#D97706">\u23f1 Vous avez 2 heures pour r\u00e9server ce cr\u00e9neau avant qu'il ne soit propos\u00e9 \u00e0 quelqu'un d'autre.</p>`,
        ctaText: 'R\u00e9server maintenant',
        ctaUrl: offerUrl,
        businessName: details.business_name,
        primaryColor: details.theme?.primary_color,
        footerText: `${details.business_name}${details.address ? ' \u00b7 ' + details.address : ''} \u00b7 Via Genda.be`
      });

      sendEmail({
        to: wEntry.client_email,
        toName: wEntry.client_name,
        subject: `Cr\u00e9neau disponible \u2014 ${details.service_name} le ${slotDateFmt}`,
        html: offerHtml,
        fromName: details.business_name,
        replyTo: details.business_email || undefined
      }).catch(e => console.warn('[WAITLIST] Manual offer email error:', e.message));
    }

    res.json({
      offered: true,
      offer_url: offerUrl,
      offer_token: token,
      expires_at: expiresAt.toISOString(),
      client_email: wEntry.client_email
    });
  } catch (err) { next(err); }
});

// ============================================================
// POST /api/waitlist/:id/contact — mark as contacted (manual mode)
// Pro contacted the client themselves
// ============================================================
router.post('/:id/contact', async (req, res, next) => {
  try {
    if (!UUID_RE.test(req.params.id)) return res.status(400).json({ error: 'ID invalide' });
    const { outcome } = req.body; // 'booked' or 'declined'
    // V13-010: Add practitioner scope check
    let contactSql = `UPDATE waitlist_entries SET
        status = $1, updated_at = NOW()
       WHERE id = $2 AND business_id = $3`;
    const contactParams = [outcome === 'booked' ? 'booked' : 'declined', req.params.id, req.businessId];
    if (req.practitionerFilter) {
      contactSql += ` AND practitioner_id = $4`;
      contactParams.push(req.practitionerFilter);
    }
    await queryWithRLS(req.businessId, contactSql, contactParams);
    res.json({ updated: true });
  } catch (err) { next(err); }
});

module.exports = router;
