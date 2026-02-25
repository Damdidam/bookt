const router = require('express').Router();
const { queryWithRLS, query } = require('../../services/db');
const { requireAuth, requireOwner } = require('../../middleware/auth');
const { generateInvoicePDF, generateStructuredComm, getNextInvoiceNumber } = require('../../services/invoice-pdf');

router.use(requireAuth);

// ============================================================
// GET /api/invoices — list invoices with filters
// ============================================================
router.get('/', async (req, res, next) => {
  try {
    const bid = req.businessId;
    const { status, type, client_id, from, to, limit, offset } = req.query;

    let sql = `SELECT i.*, c.full_name AS client_display_name
      FROM invoices i LEFT JOIN clients c ON c.id = i.client_id
      WHERE i.business_id = $1`;
    const params = [bid];
    let idx = 2;

    if (status) { sql += ` AND i.status = $${idx}`; params.push(status); idx++; }
    if (type) { sql += ` AND i.type = $${idx}`; params.push(type); idx++; }
    if (client_id) { sql += ` AND i.client_id = $${idx}`; params.push(client_id); idx++; }
    if (from) { sql += ` AND i.issue_date >= $${idx}`; params.push(from); idx++; }
    if (to) { sql += ` AND i.issue_date <= $${idx}`; params.push(to); idx++; }

    sql += ` ORDER BY i.issue_date DESC, i.created_at DESC`;
    sql += ` LIMIT $${idx} OFFSET $${idx + 1}`;
    params.push(parseInt(limit) || 50, parseInt(offset) || 0);

    const result = await queryWithRLS(bid, sql, params);

    // Summary stats
    const stats = await queryWithRLS(bid,
      `SELECT
        COUNT(*) FILTER (WHERE status = 'draft') AS drafts,
        COUNT(*) FILTER (WHERE status = 'sent') AS sent,
        COUNT(*) FILTER (WHERE status = 'paid') AS paid,
        COUNT(*) FILTER (WHERE status = 'overdue') AS overdue,
        COALESCE(SUM(total_cents) FILTER (WHERE status = 'paid'), 0) AS total_paid,
        COALESCE(SUM(total_cents) FILTER (WHERE status IN ('sent', 'overdue')), 0) AS total_pending
       FROM invoices WHERE business_id = $1`,
      [bid]
    );

    res.json({
      invoices: result.rows,
      stats: stats.rows[0]
    });
  } catch (err) { next(err); }
});

// ============================================================
// POST /api/invoices — create invoice (from booking or manual)
// ============================================================
router.post('/', requireOwner, async (req, res, next) => {
  try {
    const bid = req.businessId;
    const { booking_id, client_id, type, items, notes, vat_rate,
            due_days, language, client_address, client_bce } = req.body;

    const invoiceType = type || 'invoice';

    // Get business info
    const bizResult = await queryWithRLS(bid,
      `SELECT name, address, bce_number, email, phone,
              settings->>'iban' AS iban, settings->>'bic' AS bic,
              settings->>'invoice_footer' AS invoice_footer
       FROM businesses WHERE id = $1`,
      [bid]
    );
    const biz = bizResult.rows[0];

    // Get client info
    let client = null;
    if (client_id) {
      const cResult = await queryWithRLS(bid,
        `SELECT * FROM clients WHERE id = $1 AND business_id = $2`,
        [client_id, bid]
      );
      client = cResult.rows[0];
    }

    // If from booking, auto-build items
    let invoiceItems = items || [];
    if (booking_id && invoiceItems.length === 0) {
      const bkResult = await queryWithRLS(bid,
        `SELECT b.*, s.name AS service_name, s.price_cents, s.duration_min,
                c.full_name, c.email, c.phone, c.bce_number, c.id AS c_id
         FROM bookings b
         JOIN services s ON s.id = b.service_id
         JOIN clients c ON c.id = b.client_id
         WHERE b.id = $1 AND b.business_id = $2`,
        [booking_id, bid]
      );
      if (bkResult.rows.length > 0) {
        const bk = bkResult.rows[0];
        if (!client) {
          client = { id: bk.c_id, full_name: bk.full_name, email: bk.email,
                     phone: bk.phone, bce_number: bk.bce_number };
        }
        invoiceItems = [{
          description: `${bk.service_name} — ${new Date(bk.start_at).toLocaleDateString('fr-BE')}`,
          quantity: 1,
          unit_price_cents: bk.price_cents || 0,
          vat_rate: vat_rate || 21
        }];
      }
    }

    if (!client && !req.body.client_name) {
      return res.status(400).json({ error: 'Client requis' });
    }

    // Generate invoice number
    const invoiceNumber = await getNextInvoiceNumber(
      (sql, params) => queryWithRLS(bid, sql, params),
      bid, invoiceType
    );

    // Calculate totals
    const vatR = parseFloat(vat_rate) || 21;
    let subtotal = 0;
    invoiceItems.forEach(item => {
      item.total_cents = Math.round((item.quantity || 1) * (item.unit_price_cents || 0));
      subtotal += item.total_cents;
    });
    const vatAmount = Math.round(subtotal * vatR / 100);
    const total = subtotal + vatAmount;

    // Structured communication
    const structuredComm = generateStructuredComm(invoiceNumber);

    // Due date
    const issueDate = new Date();
    const dueDate = new Date(issueDate);
    dueDate.setDate(dueDate.getDate() + (due_days || 30));

    // Create invoice
    const invResult = await queryWithRLS(bid,
      `INSERT INTO invoices (business_id, booking_id, client_id, invoice_number, type, status,
        issue_date, due_date, client_name, client_email, client_phone, client_address, client_bce,
        business_name, business_address, business_bce, business_iban, business_bic,
        subtotal_cents, vat_amount_cents, total_cents, vat_rate,
        structured_comm, notes, footer_text, language)
       VALUES ($1,$2,$3,$4,$5,'draft',$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25)
       RETURNING *`,
      [bid, booking_id || null, client?.id || null,
       invoiceNumber, invoiceType,
       issueDate.toISOString().split('T')[0],
       invoiceType !== 'quote' ? dueDate.toISOString().split('T')[0] : null,
       req.body.client_name || client?.full_name,
       client?.email || null, client?.phone || null,
       client_address || null, client_bce || client?.bce_number || null,
       biz.name, biz.address || null, biz.bce_number || null,
       biz.iban || null, biz.bic || null,
       subtotal, vatAmount, total, vatR,
       structuredComm, notes || null,
       biz.invoice_footer || null,
       language || 'fr']
    );

    const invoiceId = invResult.rows[0].id;

    // Insert items
    for (const item of invoiceItems) {
      await queryWithRLS(bid,
        `INSERT INTO invoice_items (invoice_id, description, quantity, unit_price_cents, vat_rate, total_cents, sort_order)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [invoiceId, item.description, item.quantity || 1,
         item.unit_price_cents || 0, item.vat_rate || vatR,
         item.total_cents || 0, item.sort_order || 0]
      );
    }

    res.status(201).json({ invoice: invResult.rows[0] });
  } catch (err) { next(err); }
});

// ============================================================
// PATCH /api/invoices/:id/status — change status
// ============================================================
router.patch('/:id/status', requireOwner, async (req, res, next) => {
  try {
    const bid = req.businessId;
    const { status, paid_date } = req.body;
    const valid = ['draft', 'sent', 'paid', 'overdue', 'cancelled'];
    if (!valid.includes(status)) return res.status(400).json({ error: 'Statut invalide' });

    await queryWithRLS(bid,
      `UPDATE invoices SET status = $1, paid_date = $2, updated_at = NOW()
       WHERE id = $3 AND business_id = $4`,
      [status, status === 'paid' ? (paid_date || new Date().toISOString().split('T')[0]) : null,
       req.params.id, bid]
    );
    res.json({ updated: true, status });
  } catch (err) { next(err); }
});

// ============================================================
// GET /api/invoices/:id/pdf — generate and download PDF
// ============================================================
router.get('/:id/pdf', async (req, res, next) => {
  try {
    const bid = req.businessId;
    const invResult = await queryWithRLS(bid,
      `SELECT * FROM invoices WHERE id = $1 AND business_id = $2`,
      [req.params.id, bid]
    );
    if (invResult.rows.length === 0) return res.status(404).json({ error: 'Facture introuvable' });

    const invoice = invResult.rows[0];
    const itemsResult = await queryWithRLS(bid,
      `SELECT * FROM invoice_items WHERE invoice_id = $1 ORDER BY sort_order`,
      [invoice.id]
    );

    const pdfBuffer = await generateInvoicePDF(invoice, itemsResult.rows);

    const filename = `${invoice.invoice_number.replace(/\//g, '-')}.pdf`;
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${filename}"`);
    res.send(pdfBuffer);
  } catch (err) { next(err); }
});

// ============================================================
// DELETE /api/invoices/:id — delete draft invoice
// ============================================================
router.delete('/:id', requireOwner, async (req, res, next) => {
  try {
    const bid = req.businessId;
    const check = await queryWithRLS(bid,
      `SELECT status FROM invoices WHERE id = $1 AND business_id = $2`, [req.params.id, bid]
    );
    if (check.rows.length === 0) return res.status(404).json({ error: 'Facture introuvable' });
    if (check.rows[0].status !== 'draft') return res.status(400).json({ error: 'Seuls les brouillons peuvent être supprimés' });

    await queryWithRLS(bid, `DELETE FROM invoice_items WHERE invoice_id = $1`, [req.params.id]);
    await queryWithRLS(bid, `DELETE FROM invoices WHERE id = $1 AND business_id = $2`, [req.params.id, bid]);
    res.json({ deleted: true });
  } catch (err) { next(err); }
});

module.exports = router;
