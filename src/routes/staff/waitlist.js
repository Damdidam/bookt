const router = require('express').Router();
const { queryWithRLS } = require('../../services/db');
const { requireAuth } = require('../../middleware/auth');

router.use(requireAuth);

// ============================================================
// GET /api/waitlist — list waitlist entries with filters
// Dashboard: section Liste d'attente
// ============================================================
router.get('/', async (req, res, next) => {
  try {
    const bid = req.businessId;
    const { practitioner_id, service_id, status } = req.query;

    let where = 'w.business_id = $1';
    const params = [bid];
    let idx = 2;

    if (practitioner_id) {
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
    const { practitioner_id, service_id, client_name, client_email,
            client_phone, preferred_days, preferred_time, note } = req.body;

    if (!practitioner_id || !service_id || !client_name || !client_email) {
      return res.status(400).json({ error: 'Praticien, prestation, nom et email requis' });
    }

    // Get next priority
    const maxP = await queryWithRLS(bid,
      `SELECT COALESCE(MAX(priority), 0) + 1 AS next_priority
       FROM waitlist_entries
       WHERE practitioner_id = $1 AND service_id = $2 AND status = 'waiting'`,
      [practitioner_id, service_id]
    );

    const result = await queryWithRLS(bid,
      `INSERT INTO waitlist_entries
        (business_id, practitioner_id, service_id, client_name, client_email,
         client_phone, preferred_days, preferred_time, note, priority)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING *`,
      [bid, practitioner_id, service_id, client_name, client_email,
       client_phone || null,
       JSON.stringify(preferred_days || [0,1,2,3,4]),
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
      const valid = ['waiting', 'offered', 'booked', 'expired', 'cancelled', 'declined'];
      if (!valid.includes(status)) return res.status(400).json({ error: 'Statut invalide' });
      sets.push(`status = $${idx}`);
      params.push(status);
      idx++;
    }

    const result = await queryWithRLS(bid,
      `UPDATE waitlist_entries SET ${sets.join(', ')}
       WHERE id = $1 AND business_id = $2 RETURNING *`,
      params
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Entrée introuvable' });

    res.json({ entry: result.rows[0] });
  } catch (err) { next(err); }
});

// ============================================================
// DELETE /api/waitlist/:id — remove entry
// ============================================================
router.delete('/:id', async (req, res, next) => {
  try {
    await queryWithRLS(req.businessId,
      `UPDATE waitlist_entries SET status = 'cancelled', updated_at = NOW()
       WHERE id = $1 AND business_id = $2`,
      [req.params.id, req.businessId]
    );
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
    const { start_at, end_at } = req.body;

    if (!start_at || !end_at) {
      return res.status(400).json({ error: 'Créneau requis (start_at, end_at)' });
    }

    const entry = await queryWithRLS(bid,
      `SELECT * FROM waitlist_entries WHERE id = $1 AND business_id = $2 AND status = 'waiting'`,
      [id, bid]
    );
    if (entry.rows.length === 0) {
      return res.status(404).json({ error: 'Entrée introuvable ou déjà traitée' });
    }

    const token = require('crypto').randomBytes(20).toString('hex');
    const expiresAt = new Date(Date.now() + 2 * 60 * 60 * 1000); // 2h

    await queryWithRLS(bid,
      `UPDATE waitlist_entries SET
        status = 'offered',
        offer_token = $1,
        offer_booking_start = $2,
        offer_booking_end = $3,
        offer_sent_at = NOW(),
        offer_expires_at = $4,
        updated_at = NOW()
       WHERE id = $5`,
      [token, start_at, end_at, expiresAt.toISOString(), id]
    );

    // TODO: Send email via Brevo when connected
    // For now, return the offer URL for manual sharing
    const offerUrl = `${process.env.BASE_URL || process.env.APP_BASE_URL}/waitlist/${token}`;

    res.json({
      offered: true,
      offer_url: offerUrl,
      offer_token: token,
      expires_at: expiresAt.toISOString(),
      client_email: entry.rows[0].client_email
    });
  } catch (err) { next(err); }
});

// ============================================================
// POST /api/waitlist/:id/contact — mark as contacted (manual mode)
// Pro contacted the client themselves
// ============================================================
router.post('/:id/contact', async (req, res, next) => {
  try {
    const { outcome } = req.body; // 'booked' or 'declined'
    await queryWithRLS(req.businessId,
      `UPDATE waitlist_entries SET
        status = $1, updated_at = NOW()
       WHERE id = $2 AND business_id = $3`,
      [outcome === 'booked' ? 'booked' : 'declined', req.params.id, req.businessId]
    );
    res.json({ updated: true });
  } catch (err) { next(err); }
});

module.exports = router;
