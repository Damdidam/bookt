const router = require('express').Router();
const { queryWithRLS } = require('../../services/db');
const { requireAuth, requireRole } = require('../../middleware/auth');

router.use(requireAuth);
router.use(requireRole('owner', 'manager'));

// ============================================================
// GET /api/deposits — list deposit transactions + stats
// UI: Acomptes section (reconciliation & dispute)
// ============================================================
router.get('/', async (req, res, next) => {
  try {
    const bid = req.businessId;
    const { status, from, to } = req.query;

    let sql = `
      SELECT b.id, b.start_at, b.end_at, b.status AS booking_status,
             b.deposit_required, b.deposit_status, b.deposit_amount_cents,
             b.deposit_paid_at, b.deposit_payment_intent_id, b.deposit_deadline,
             b.cancel_reason, b.created_at,
             c.id AS client_id, c.full_name AS client_name, c.email AS client_email,
             c.phone AS client_phone, c.no_show_count,
             s.name AS service_name, s.price_cents AS service_price_cents,
             p.display_name AS practitioner_name
      FROM bookings b
      JOIN clients c ON c.id = b.client_id
      JOIN services s ON s.id = b.service_id
      JOIN practitioners p ON p.id = b.practitioner_id
      WHERE b.business_id = $1 AND b.deposit_required = true`;
    const params = [bid];
    let idx = 2;

    if (status && status !== 'all') {
      sql += ` AND b.deposit_status = $${idx}`;
      params.push(status);
      idx++;
    }
    if (from) {
      sql += ` AND b.created_at >= $${idx}`;
      params.push(from);
      idx++;
    }
    if (to) {
      sql += ` AND b.created_at <= $${idx}`;
      params.push(to + 'T23:59:59Z');
      idx++;
    }

    sql += ` ORDER BY b.created_at DESC LIMIT 200`;

    const result = await queryWithRLS(bid, sql, params);

    // Summary stats
    const stats = await queryWithRLS(bid, `
      SELECT
        COUNT(*) AS total,
        COUNT(*) FILTER (WHERE deposit_status = 'pending') AS pending_count,
        COUNT(*) FILTER (WHERE deposit_status = 'paid') AS paid_count,
        COUNT(*) FILTER (WHERE deposit_status = 'refunded') AS refunded_count,
        COUNT(*) FILTER (WHERE deposit_status = 'cancelled') AS kept_count,
        COALESCE(SUM(deposit_amount_cents) FILTER (WHERE deposit_status = 'pending'), 0) AS pending_cents,
        COALESCE(SUM(deposit_amount_cents) FILTER (WHERE deposit_status = 'paid'), 0) AS paid_cents,
        COALESCE(SUM(deposit_amount_cents) FILTER (WHERE deposit_status = 'refunded'), 0) AS refunded_cents,
        COALESCE(SUM(deposit_amount_cents) FILTER (WHERE deposit_status = 'cancelled'), 0) AS kept_cents
      FROM bookings
      WHERE business_id = $1 AND deposit_required = true
    `, [bid]);

    // Fetch related audit logs
    const bookingIds = result.rows.map(r => r.id);
    let auditMap = {};
    if (bookingIds.length > 0) {
      const auditResult = await queryWithRLS(bid, `
        SELECT al.entity_id AS booking_id, al.action, al.new_data, al.old_data, al.created_at AS audit_date,
               u.email AS actor_email
        FROM audit_logs al
        LEFT JOIN users u ON u.id = al.actor_user_id
        WHERE al.business_id = $1
          AND al.entity_type = 'booking'
          AND al.action IN ('deposit_refund', 'status_change')
          AND al.entity_id = ANY($2)
        ORDER BY al.created_at DESC
      `, [bid, bookingIds]);

      auditResult.rows.forEach(a => {
        if (!auditMap[a.booking_id]) auditMap[a.booking_id] = [];
        auditMap[a.booking_id].push(a);
      });
    }

    const deposits = result.rows.map(row => ({
      ...row,
      audit_trail: auditMap[row.id] || []
    }));

    res.json({ deposits, stats: stats.rows[0] });
  } catch (err) { next(err); }
});

// ============================================================
// GET /api/deposits/export — CSV export for dispute documentation
// ============================================================
router.get('/export', async (req, res, next) => {
  try {
    const bid = req.businessId;
    const { status, from, to } = req.query;

    let sql = `
      SELECT b.id, b.created_at, b.start_at, b.status AS booking_status,
             b.deposit_status, b.deposit_amount_cents, b.deposit_paid_at,
             b.deposit_payment_intent_id, b.deposit_deadline, b.cancel_reason,
             c.full_name AS client_name, c.email AS client_email, c.phone AS client_phone,
             s.name AS service_name, s.price_cents AS service_price_cents,
             p.display_name AS practitioner_name
      FROM bookings b
      JOIN clients c ON c.id = b.client_id
      JOIN services s ON s.id = b.service_id
      JOIN practitioners p ON p.id = b.practitioner_id
      WHERE b.business_id = $1 AND b.deposit_required = true`;
    const params = [bid];
    let idx = 2;

    if (status && status !== 'all') {
      sql += ` AND b.deposit_status = $${idx}`;
      params.push(status);
      idx++;
    }
    if (from) {
      sql += ` AND b.created_at >= $${idx}`;
      params.push(from);
      idx++;
    }
    if (to) {
      sql += ` AND b.created_at <= $${idx}`;
      params.push(to + 'T23:59:59Z');
      idx++;
    }

    sql += ` ORDER BY b.created_at DESC`;

    const result = await queryWithRLS(bid, sql, params);

    const statusLabels = { pending: 'En attente', paid: 'Pay\u00e9', refunded: 'Rembours\u00e9', cancelled: 'Conserv\u00e9' };
    const bkLabels = { pending: 'En attente', confirmed: 'Confirm\u00e9', cancelled: 'Annul\u00e9', completed: 'Termin\u00e9', no_show: 'No-show', pending_deposit: 'Attente acompte', modified_pending: 'Modifi\u00e9' };
    const fmt = (d) => d ? new Date(d).toLocaleDateString('fr-BE') : '';
    const fmtEur = (c) => ((c || 0) / 100).toFixed(2).replace('.', ',');

    const header = 'Date cr\u00e9ation;Date RDV;Client;Email;T\u00e9l\u00e9phone;Prestation;Prix prestation;Montant acompte;Statut acompte;Date paiement;Statut RDV;Praticien;Stripe PI;Raison annulation\n';
    const rows = result.rows.map(r => [
      fmt(r.created_at),
      fmt(r.start_at),
      `"${(r.client_name || '').replace(/"/g, '""')}"`,
      r.client_email || '',
      r.client_phone || '',
      `"${(r.service_name || '').replace(/"/g, '""')}"`,
      fmtEur(r.service_price_cents),
      fmtEur(r.deposit_amount_cents),
      statusLabels[r.deposit_status] || r.deposit_status || '',
      fmt(r.deposit_paid_at),
      bkLabels[r.booking_status] || r.booking_status || '',
      `"${(r.practitioner_name || '').replace(/"/g, '""')}"`,
      r.deposit_payment_intent_id || '',
      `"${(r.cancel_reason || '').replace(/"/g, '""')}"`
    ].join(';')).join('\n');

    const csv = '\uFEFF' + header + rows;
    const filename = `acomptes-${new Date().toISOString().split('T')[0]}.csv`;
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(csv);
  } catch (err) { next(err); }
});

module.exports = router;
