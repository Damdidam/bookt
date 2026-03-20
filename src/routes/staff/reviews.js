/**
 * Reviews management (avis clients)
 * All routes require auth + business context
 */
const router = require('express').Router();
const { queryWithRLS } = require('../../services/db');
const { requireAuth, requireOwner } = require('../../middleware/auth');

router.use(requireAuth);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function stripHtml(str) {
  return str.replace(/<[^>]*>/g, '').trim();
}

// ============================================================
// GET /api/reviews/stats — stats (average, count, distribution)
// Must be declared BEFORE /:id routes
// ============================================================
router.get('/stats', async (req, res, next) => {
  try {
    const result = await queryWithRLS(req.businessId,
      `SELECT
        COUNT(*) as total,
        ROUND(AVG(rating)::numeric, 1) as average,
        COUNT(*) FILTER (WHERE rating = 5) as five,
        COUNT(*) FILTER (WHERE rating = 4) as four,
        COUNT(*) FILTER (WHERE rating = 3) as three,
        COUNT(*) FILTER (WHERE rating = 2) as two,
        COUNT(*) FILTER (WHERE rating = 1) as one
       FROM reviews
       WHERE business_id = $1 AND status = 'published'`,
      [req.businessId]
    );

    const row = result.rows[0];
    res.json({
      stats: {
        total: parseInt(row.total),
        average: row.average ? parseFloat(row.average) : 0,
        distribution: {
          5: parseInt(row.five),
          4: parseInt(row.four),
          3: parseInt(row.three),
          2: parseInt(row.two),
          1: parseInt(row.one)
        }
      }
    });
  } catch (err) { next(err); }
});

// ============================================================
// GET /api/reviews — list all reviews for the business
// ============================================================
router.get('/', async (req, res, next) => {
  try {
    const result = await queryWithRLS(req.businessId,
      `SELECT r.*, c.full_name as client_name, c.email, c.phone,
        p.display_name as practitioner_name,
        s.name as service_name
       FROM reviews r
       LEFT JOIN clients c ON c.id = r.client_id
       LEFT JOIN practitioners p ON p.id = r.practitioner_id
       LEFT JOIN bookings b ON b.id = r.booking_id
       LEFT JOIN services s ON s.id = b.service_id
       WHERE r.business_id = $1
       ORDER BY r.created_at DESC`,
      [req.businessId]
    );

    res.json({ reviews: result.rows });
  } catch (err) { next(err); }
});

// ============================================================
// PATCH /api/reviews/:id/reply — owner replies to a review
// ============================================================
router.patch('/:id/reply', requireOwner, async (req, res, next) => {
  try {
    if (!UUID_RE.test(req.params.id)) return res.status(400).json({ error: 'ID invalide' });

    const { reply } = req.body;
    if (!reply || typeof reply !== 'string') {
      return res.status(400).json({ error: 'La reponse est requise' });
    }

    const cleaned = stripHtml(reply);
    if (cleaned.length === 0) {
      return res.status(400).json({ error: 'La reponse ne peut pas etre vide' });
    }
    if (cleaned.length > 500) {
      return res.status(400).json({ error: 'La reponse ne doit pas depasser 500 caracteres' });
    }

    // Verify review exists and belongs to business
    const check = await queryWithRLS(req.businessId,
      `SELECT id FROM reviews WHERE id = $1 AND business_id = $2`,
      [req.params.id, req.businessId]
    );
    if (check.rows.length === 0) {
      return res.status(404).json({ error: 'Avis introuvable' });
    }

    const result = await queryWithRLS(req.businessId,
      `UPDATE reviews
       SET owner_reply = $1, owner_reply_at = NOW(), updated_at = NOW()
       WHERE id = $2 AND business_id = $3
       RETURNING *`,
      [cleaned, req.params.id, req.businessId]
    );

    res.json({ review: result.rows[0] });
  } catch (err) { next(err); }
});

// ============================================================
// DELETE /api/reviews/:id/reply — owner deletes their reply
// ============================================================
router.delete('/:id/reply', requireOwner, async (req, res, next) => {
  try {
    if (!UUID_RE.test(req.params.id)) return res.status(400).json({ error: 'ID invalide' });

    const result = await queryWithRLS(req.businessId,
      `UPDATE reviews
       SET owner_reply = NULL, owner_reply_at = NULL, updated_at = NOW()
       WHERE id = $1 AND business_id = $2
       RETURNING *`,
      [req.params.id, req.businessId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Avis introuvable' });
    }

    res.json({ review: result.rows[0] });
  } catch (err) { next(err); }
});

// ============================================================
// PATCH /api/reviews/:id/flag — flag/hide an abusive review
// ============================================================
router.patch('/:id/flag', requireOwner, async (req, res, next) => {
  try {
    if (!UUID_RE.test(req.params.id)) return res.status(400).json({ error: 'ID invalide' });

    const { status } = req.body;
    const validStatuses = ['published', 'flagged', 'hidden'];
    if (!status || !validStatuses.includes(status)) {
      return res.status(400).json({ error: 'Statut invalide. Valeurs acceptees: published, flagged, hidden' });
    }

    const result = await queryWithRLS(req.businessId,
      `UPDATE reviews
       SET status = $1, updated_at = NOW()
       WHERE id = $2 AND business_id = $3
       RETURNING *`,
      [status, req.params.id, req.businessId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Avis introuvable' });
    }

    res.json({ review: result.rows[0] });
  } catch (err) { next(err); }
});

module.exports = router;
