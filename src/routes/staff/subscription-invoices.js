/**
 * GET /api/staff/subscription-invoices — liste paginée des factures
 * d'abonnement Genda pour le business authentifié.
 */
const router = require('express').Router();
const { query } = require('../../services/db');
const { requireAuth } = require('../../middleware/auth');

router.get('/', requireAuth, async (req, res, next) => {
  try {
    const limit = Math.min(Math.max(parseInt(req.query.limit) || 20, 1), 100);
    const offset = Math.max(parseInt(req.query.offset) || 0, 0);
    const businessId = req.businessId;

    const [rowsRes, countRes] = await Promise.all([
      query(
        `SELECT id, stripe_invoice_number, stripe_pdf_url,
                period_start, period_end,
                amount_total_cents, status, created_at
           FROM subscription_invoices
          WHERE business_id = $1
          ORDER BY created_at DESC
          LIMIT $2 OFFSET $3`,
        [businessId, limit, offset]
      ),
      query(
        `SELECT COUNT(*) AS c FROM subscription_invoices WHERE business_id = $1`,
        [businessId]
      )
    ]);

    res.json({
      invoices: rowsRes.rows,
      pagination: {
        total_count: parseInt(countRes.rows[0].c, 10),
        limit,
        offset
      }
    });
  } catch (err) { next(err); }
});

module.exports = router;
