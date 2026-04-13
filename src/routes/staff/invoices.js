const router = require('express').Router();
const { queryWithRLS, query, transactionWithRLS } = require('../../services/db');
const { requireAuth, requireOwner, requirePro, blockIfImpersonated } = require('../../middleware/auth');
const { generateInvoicePDF, generateStructuredComm, getNextInvoiceNumber } = require('../../services/invoice-pdf');

router.use(requireAuth);
router.use(requirePro);
router.use(requireOwner);

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
// GET /api/invoices/unbilled — completed bookings without invoice (last 7 days)
// ============================================================
router.get('/unbilled', async (req, res, next) => {
  try {
    const bid = req.businessId;
    const { client_id } = req.query;
    if (!client_id) return res.status(400).json({ error: 'client_id requis' });

    const result = await queryWithRLS(bid,
      `SELECT b.id, b.start_at, b.group_id, b.deposit_payment_intent_id, b.deposit_amount_cents,
              b.deposit_status, b.booked_price_cents,
              b.promotion_label, b.promotion_discount_pct, b.promotion_discount_cents,
              COALESCE((SELECT SUM(gct.amount_cents) FROM gift_card_transactions gct WHERE gct.booking_id = b.id AND gct.type = 'debit'), 0) AS gc_paid_cents,
              s.name AS service_name, s.price_cents AS service_price_cents,
              sv.name AS variant_name, sv.price_cents AS variant_price_cents,
              p.display_name AS practitioner_name
       FROM bookings b
       JOIN services s ON s.id = b.service_id
       LEFT JOIN service_variants sv ON sv.id = b.service_variant_id
       LEFT JOIN practitioners p ON p.id = b.practitioner_id
       WHERE b.business_id = $1
         AND b.client_id = $2
         AND b.status = 'completed'
         AND b.start_at >= NOW() - INTERVAL '7 days'
         AND NOT EXISTS (
           SELECT 1 FROM invoice_items ii
           JOIN invoices inv ON inv.id = ii.invoice_id
           WHERE ii.booking_id = b.id AND inv.status != 'cancelled'
         )
       ORDER BY b.start_at DESC`,
      [bid, client_id]
    );

    // Enrich with pass info — check both deposit_payment_intent_id AND pass_transactions
    const bookings = result.rows;
    const bookingIds = bookings.map(b => b.id);

    // Find all pass debits for these bookings
    let passDebits = {};
    if (bookingIds.length > 0) {
      const ptRes = await queryWithRLS(bid,
        `SELECT pt.booking_id, p.code, p.name, p.sessions_total, p.sessions_remaining, p.service_id
         FROM pass_transactions pt
         JOIN passes p ON p.id = pt.pass_id
         WHERE pt.booking_id = ANY($1) AND pt.type = 'debit'`,
        [bookingIds]
      );
      for (const r of ptRes.rows) {
        passDebits[r.booking_id] = { code: r.code, name: r.name, sessions_total: r.sessions_total, sessions_remaining: r.sessions_remaining, service_id: r.service_id };
      }
    }

    // Also check deposit_payment_intent_id for pass_ prefix (backward compat)
    const passCodes = [...new Set(bookings
      .filter(b => b.deposit_payment_intent_id?.startsWith('pass_'))
      .map(b => b.deposit_payment_intent_id.replace('pass_', '')))];
    if (passCodes.length > 0) {
      const passRes = await queryWithRLS(bid,
        `SELECT code, name, sessions_total, sessions_remaining, service_id
         FROM passes WHERE business_id = $1 AND code = ANY($2)`,
        [bid, passCodes]
      );
      for (const p of passRes.rows) {
        // Fill in any bookings that have this pass in deposit but weren't in pass_transactions
        for (const b of bookings) {
          if (b.deposit_payment_intent_id === `pass_${p.code}` && !passDebits[b.id]) {
            passDebits[b.id] = p;
          }
        }
      }
    }

    for (const b of bookings) {
      if (passDebits[b.id]) {
        b.pass_info = passDebits[b.id];
        b.pass_covered = true;
      }
    }

    res.json({ bookings });
  } catch (err) { next(err); }
});

// ============================================================
// POST /api/invoices — create invoice (from booking or manual)
// H3 fix: blockIfImpersonated — admin impersonated ne doit pas créer de factures fiscales
// (numéros F-YYYY-XXXXXX immuables, compliance BE AR n°1 art.14)
// ============================================================
router.post('/', requireOwner, blockIfImpersonated, async (req, res, next) => {
  try {
    const bid = req.businessId;
    const { booking_id, booking_ids, client_id, type, items, notes, vat_rate,
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
      // Fetch the booking + check if it's part of a group
      const bkResult = await queryWithRLS(bid,
        `SELECT b.*, s.name AS service_name, s.category AS service_category, s.price_cents, s.duration_min,
                sv.name AS variant_name, sv.price_cents AS variant_price_cents,
                c.full_name, c.email, c.phone, c.bce_number, c.id AS c_id
         FROM bookings b
         JOIN services s ON s.id = b.service_id
         LEFT JOIN service_variants sv ON sv.id = b.service_variant_id
         JOIN clients c ON c.id = b.client_id
         WHERE b.id = $1 AND b.business_id = $2`,
        [booking_id, bid]
      );
      if (bkResult.rows.length > 0) {
        const bk = bkResult.rows[0];
        // Guard: don't create invoice for cancelled bookings
        if (bk.status === 'cancelled') {
          return res.status(400).json({ error: 'Impossible de créer une facture pour un rendez-vous annulé' });
        }
        if (!client) {
          client = { id: bk.c_id, full_name: bk.full_name, email: bk.email,
                     phone: bk.phone, bce_number: bk.bce_number };
        }

        // If grouped booking, fetch ALL siblings to include all services
        let allBookings = [bk];
        if (bk.group_id) {
          const grpResult = await queryWithRLS(bid,
            `SELECT b.*, s.name AS service_name, s.category AS service_category, s.price_cents, s.duration_min,
                    sv.name AS variant_name, sv.price_cents AS variant_price_cents
             FROM bookings b
             JOIN services s ON s.id = b.service_id
             LEFT JOIN service_variants sv ON sv.id = b.service_variant_id
             WHERE b.group_id = $1 AND b.business_id = $2 AND b.status NOT IN ('cancelled')
             ORDER BY b.group_order, b.start_at`,
            [bk.group_id, bid]
          );
          if (grpResult.rows.length > 1) allBookings = grpResult.rows;
        }

        // Check pass_transactions for pass-covered bookings (H2 fix: don't rely on deposit_payment_intent_id)
        const passBookingIds = new Set();
        try {
          const ptRes = await queryWithRLS(bid,
            `SELECT DISTINCT booking_id FROM pass_transactions WHERE booking_id = ANY($1) AND type = 'debit'`,
            [allBookings.map(b => b.id)]
          );
          for (const r of ptRes.rows) passBookingIds.add(r.booking_id);
        } catch (_) {}

        // Build line items for each service in the group (pass-covered = 0€)
        invoiceItems = allBookings.map(sib => {
          const svcLabel = sib.service_category ? `${sib.service_category} - ${sib.service_name}${sib.variant_name ? ' \u2014 ' + sib.variant_name : ''}` : (sib.variant_name ? `${sib.service_name} \u2014 ${sib.variant_name}` : sib.service_name);
          const isPassCovered = passBookingIds.has(sib.id) || (sib.deposit_payment_intent_id && sib.deposit_payment_intent_id.startsWith('pass_'));
          return {
            booking_id: sib.id,
            description: `${svcLabel} — ${new Date(sib.start_at).toLocaleDateString('fr-BE', { timeZone: 'Europe/Brussels' })}${isPassCovered ? ' (pass)' : ''}`,
            quantity: 1,
            unit_price_cents: isPassCovered ? 0 : (sib.booked_price_cents ?? sib.variant_price_cents ?? sib.price_cents ?? 0),
            vat_rate: vat_rate || 21
          };
        });

        // Add promo discount line — find the sibling with the promo (group_order=0)
        const promoSib = allBookings.find(sib => sib.promotion_discount_cents > 0 && sib.promotion_label);
        if (promoSib) {
          invoiceItems.push({
            description: `Réduction : ${promoSib.promotion_label}${promoSib.promotion_discount_pct ? ' (-' + promoSib.promotion_discount_pct + '%)' : ''}`,
            quantity: 1,
            unit_price_cents: -promoSib.promotion_discount_cents,
            vat_rate: vat_rate || 21
          });
        }

        // Add deposit deduction line if deposit was paid
        if (bk.deposit_status === 'paid' && bk.deposit_amount_cents > 0) {
          invoiceItems.push({
            description: 'Acompte versé',
            quantity: 1,
            unit_price_cents: -bk.deposit_amount_cents,
            vat_rate: vat_rate || 21
          });
        }
      }
    }

    if (!client && !req.body.client_name) {
      return res.status(400).json({ error: 'Client requis' });
    }

    // Calculate totals (before transaction — pure computation).
    // Prices are TTC (VAT included). Extract VAT per LINE using each item.vat_rate
    // so multi-rate invoices (e.g. 6% service + 21% product) compute correctly.
    const parsedVat = parseFloat(vat_rate);
    const vatR = isNaN(parsedVat) ? 21 : parsedVat;
    let subtotal = 0;
    let vatAmount = 0;
    invoiceItems.forEach(item => {
      item.total_cents = Math.round((item.quantity || 1) * (item.unit_price_cents || 0));
      subtotal += item.total_cents;
      const lineRate = (item.vat_rate !== undefined && item.vat_rate !== null) ? parseFloat(item.vat_rate) : vatR;
      vatAmount += Math.round(item.total_cents * lineRate / (100 + lineRate));
    });
    const total = subtotal;

    // Due date
    const issueDate = new Date();
    const dueDate = new Date(issueDate);
    dueDate.setDate(dueDate.getDate() + (due_days || 30));

    // Atomic: generate invoice number + create invoice + insert items in one transaction
    const invoice = await transactionWithRLS(bid, async (txClient) => {
      // Generate invoice number (advisory lock stays held within this transaction)
      const invoiceNumber = await getNextInvoiceNumber(
        (sql, params) => txClient.query(sql, params),
        bid, invoiceType
      );

      const structuredComm = generateStructuredComm(invoiceNumber);

      const invResult = await txClient.query(
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

      for (const [i, item] of invoiceItems.entries()) {
        await txClient.query(
          `INSERT INTO invoice_items (invoice_id, booking_id, description, quantity, unit_price_cents, vat_rate, total_cents, sort_order)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [invoiceId, item.booking_id || null, item.description, item.quantity || 1,
           item.unit_price_cents || 0, (item.vat_rate !== undefined && item.vat_rate !== null) ? parseFloat(item.vat_rate) : vatR,
           item.total_cents || 0, i]
        );
      }

      return invResult.rows[0];
    });

    res.status(201).json({ invoice });
  } catch (err) {
    // V11-017: Handle duplicate invoice number gracefully
    if (err.code === '23505' && err.constraint && err.constraint.includes('invoice_number')) {
      return res.status(409).json({ error: 'Ce numéro de facture existe déjà. Veuillez réessayer.' });
    }
    next(err);
  }
});

// ============================================================
// POST /api/invoices/:id/credit-note — issue a credit note for a paid/sent invoice
// BE legal compliance (AR n°1 art.14): a paid invoice can only be cancelled via a credit note,
// which is a separate document with its own number (NC-YYYY-XXXXXX), referencing the original.
// Items copied with NEGATIVE amounts (subtotal/vat/total all negated). VAT rates preserved per line.
// ============================================================
router.post('/:id/credit-note', requireOwner, blockIfImpersonated, async (req, res, next) => {
  try {
    const bid = req.businessId;
    // M3 fix (security): cap reason length to avoid storage bloat / PDF DoS (notes col = TEXT)
    const rawReason = req.body?.reason;
    const reason = (typeof rawReason === 'string' && rawReason.trim()) ? rawReason.trim().slice(0, 500) : null;
    const mark_original_cancelled = req.body?.mark_original_cancelled === true;

    const result = await transactionWithRLS(bid, async (txClient) => {
      // Lock + load the original
      const orig = await txClient.query(
        `SELECT * FROM invoices WHERE id = $1 AND business_id = $2 FOR UPDATE`,
        [req.params.id, bid]
      );
      if (orig.rows.length === 0) throw Object.assign(new Error('Facture introuvable'), { status: 404 });
      const inv = orig.rows[0];

      if (inv.type === 'credit_note') {
        throw Object.assign(new Error('Impossible d\'émettre une note de crédit sur une note de crédit'), { status: 400 });
      }
      if (inv.type === 'quote') {
        throw Object.assign(new Error('Impossible d\'émettre une note de crédit sur un devis'), { status: 400 });
      }
      if (!['sent', 'paid', 'overdue'].includes(inv.status)) {
        throw Object.assign(new Error(`Note de crédit autorisée uniquement pour facture sent/paid/overdue (actuel : ${inv.status})`), { status: 400 });
      }

      // Block double credit notes for the same invoice
      const existing = await txClient.query(
        `SELECT id, invoice_number FROM invoices WHERE related_invoice_id = $1 AND business_id = $2 AND type = 'credit_note' LIMIT 1`,
        [inv.id, bid]
      );
      if (existing.rows.length > 0) {
        throw Object.assign(new Error(`Une note de crédit existe déjà : ${existing.rows[0].invoice_number}`), { status: 409 });
      }

      // Generate NC-YYYY-XXXXXX (advisory lock inside getNextInvoiceNumber)
      const cnNumber = await getNextInvoiceNumber((sql, params) => txClient.query(sql, params), bid, 'credit_note');

      // Insert the credit note (totals negated)
      // H6 fix: copy payment_method from original so CSV export (r.payment_method) n'affiche pas vide
      const cnRes = await txClient.query(
        `INSERT INTO invoices (business_id, booking_id, client_id, invoice_number, type, status,
          issue_date, due_date, client_name, client_email, client_phone, client_address, client_bce,
          business_name, business_address, business_bce, business_iban, business_bic,
          subtotal_cents, vat_amount_cents, total_cents, vat_rate,
          structured_comm, notes, footer_text, language, related_invoice_id, payment_method)
         VALUES ($1,$2,$3,$4,'credit_note','draft',$5,NULL,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25)
         RETURNING *`,
        [bid, inv.booking_id, inv.client_id, cnNumber,
         new Date().toISOString().split('T')[0],
         inv.client_name, inv.client_email, inv.client_phone, inv.client_address, inv.client_bce,
         inv.business_name, inv.business_address, inv.business_bce, inv.business_iban, inv.business_bic,
         -inv.subtotal_cents, -inv.vat_amount_cents, -inv.total_cents, inv.vat_rate,
         null, reason ? `Note de crédit pour facture ${inv.invoice_number}\n\nMotif : ${reason}` : `Note de crédit pour facture ${inv.invoice_number}`,
         inv.footer_text, inv.language, inv.id, inv.payment_method]
      );
      const cnId = cnRes.rows[0].id;

      // Copy items with negated amounts (preserve booking_id link + per-line vat_rate)
      const items = await txClient.query(
        `SELECT booking_id, description, quantity, unit_price_cents, vat_rate, total_cents, sort_order
           FROM invoice_items WHERE invoice_id = $1 ORDER BY sort_order`,
        [inv.id]
      );
      for (const it of items.rows) {
        await txClient.query(
          `INSERT INTO invoice_items (invoice_id, booking_id, description, quantity, unit_price_cents, vat_rate, total_cents, sort_order)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [cnId, it.booking_id, it.description, it.quantity, -it.unit_price_cents, it.vat_rate, -it.total_cents, it.sort_order]
        );
      }

      // Optional: mark the original 'cancelled' AFTER credit note exists (now legally permitted)
      if (mark_original_cancelled === true) {
        await txClient.query(
          `UPDATE invoices SET status = 'cancelled', updated_at = NOW() WHERE id = $1`,
          [inv.id]
        );
      }

      // H5 fix: audit_logs entry for compliance BE — trace qui a émis la NC (impersonation inclus)
      await txClient.query(
        `INSERT INTO audit_logs (business_id, actor_user_id, entity_type, entity_id, action, old_data, new_data)
         VALUES ($1, $2, 'invoice', $3, 'credit_note_issued', $4, $5)`,
        [bid, req.user.id, inv.id,
         JSON.stringify({ invoice_number: inv.invoice_number, status: inv.status, total_cents: inv.total_cents }),
         JSON.stringify({ credit_note_number: cnNumber, credit_note_id: cnId, reason: reason || null, mark_original_cancelled, impersonated_by: req.user.impersonatedBy || null })]
      );

      return cnRes.rows[0];
    });

    res.status(201).json({ ok: true, credit_note: result });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    next(err);
  }
});

// ============================================================
// PATCH /api/invoices/:id/status — change status
// H4 fix: blockIfImpersonated — transitions sent→paid, draft→cancelled sont auditables
// et ne doivent pas être effectuées via impersonation.
// ============================================================
router.patch('/:id/status', requireOwner, blockIfImpersonated, async (req, res, next) => {
  try {
    const bid = req.businessId;
    const { status, paid_date } = req.body;
    const valid = ['draft', 'sent', 'paid', 'overdue', 'cancelled'];
    if (!valid.includes(status)) return res.status(400).json({ error: 'Statut invalide' });

    // S3-18: Validate status transitions.
    // BE law (AR n°1 art. 14): a paid invoice cannot be silently cancelled — must emit a credit note.
    // A cancelled invoice cannot be reopened (immutability).
    const TRANSITIONS = {
      draft: ['sent', 'paid', 'cancelled'],
      sent: ['paid', 'overdue', 'cancelled'],
      overdue: ['paid', 'cancelled'],
      paid: [],        // cannot cancel a paid invoice — issue a credit note (type='credit_note') instead
      cancelled: []    // immutable once cancelled
    };
    const current = await queryWithRLS(bid,
      `SELECT status FROM invoices WHERE id = $1 AND business_id = $2`, [req.params.id, bid]
    );
    if (current.rows.length === 0) return res.status(404).json({ error: 'Facture introuvable' });
    const allowed = TRANSITIONS[current.rows[0].status] || [];
    if (!allowed.includes(status)) return res.status(400).json({ error: `Transition ${current.rows[0].status} → ${status} non autorisée` });

    await queryWithRLS(bid,
      `UPDATE invoices SET status = $1, paid_date = $2, updated_at = NOW()
       WHERE id = $3 AND business_id = $4`,
      [status, status === 'paid' ? (paid_date || new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Brussels' })) : null,
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
router.delete('/:id', requireOwner, blockIfImpersonated, async (req, res, next) => {
  try {
    const bid = req.businessId;

    // V12-015: Wrap in transactionWithRLS with FOR UPDATE to prevent TOCTOU race
    await transactionWithRLS(bid, async (client) => {
      const check = await client.query(
        `SELECT id FROM invoices WHERE id = $1 AND business_id = $2 AND status = 'draft' FOR UPDATE`,
        [req.params.id, bid]
      );
      if (check.rows.length === 0) {
        throw Object.assign(new Error('Facture introuvable ou non supprimable'), { status: 400 });
      }
      await client.query(`DELETE FROM invoice_items WHERE invoice_id = $1`, [req.params.id]);
      await client.query(`DELETE FROM invoices WHERE id = $1 AND business_id = $2`, [req.params.id, bid]);
    });

    res.json({ deleted: true });
  } catch (err) {
    if (err.status === 400) return res.status(400).json({ error: err.message });
    next(err);
  }
});

// ============================================================
// GET /api/invoices/export — CSV export of all invoices + line items
// UI: Settings > Zone danger > Exporter mes données
// ============================================================
router.get('/export', async (req, res, next) => {
  try {
    const bid = req.businessId;
    const result = await query(
      `SELECT i.*,
              COALESCE(
                (SELECT string_agg(
                  ii.description || ' x' || ii.quantity || ' @ ' || (COALESCE(ii.unit_price_cents, 0)::float / 100)::text || '€',
                  ' | '
                  ORDER BY ii.id)
                 FROM invoice_items ii WHERE ii.invoice_id = i.id
                ), '') AS items_summary
       FROM invoices i
       WHERE i.business_id = $1
       ORDER BY i.issue_date DESC, i.invoice_number DESC
       LIMIT 50000`,
      [bid]
    );

    const fmt = (d) => d ? new Date(d).toLocaleDateString('fr-BE', { timeZone: 'Europe/Brussels' }) : '';
    const fmtEur = (c) => ((c || 0) / 100).toFixed(2).replace('.', ',');
    const esc = (s) => `"${(s || '').replace(/"/g, '""')}"`;

    const header = '"Numéro";"Type";"Statut";"Date émission";"Date échéance";"Date paiement";"Client";"Email client";"Tél client";"Adresse client";"BCE client";"Sous-total (€)";"TVA (€)";"Total (€)";"Taux TVA";"Moyen paiement";"Communication structurée";"Notes";"Lignes détail"\n';
    const typeLabels = { invoice: 'Facture', quote: 'Devis', credit_note: 'Note de crédit' };
    const statusLabels = { draft: 'Brouillon', sent: 'Envoyée', paid: 'Payée', overdue: 'En retard', cancelled: 'Annulée' };

    const rows = result.rows.map(r => [
      esc(r.invoice_number || ''),
      esc(typeLabels[r.type] || r.type || ''),
      esc(statusLabels[r.status] || r.status || ''),
      esc(fmt(r.issue_date)),
      esc(fmt(r.due_date)),
      esc(fmt(r.paid_date)),
      esc(r.client_name),
      esc(r.client_email || ''),
      esc(r.client_phone || ''),
      esc(r.client_address),
      esc(r.client_bce || ''),
      esc(fmtEur(r.subtotal_cents)),
      esc(fmtEur(r.vat_amount_cents)),
      esc(fmtEur(r.total_cents)),
      esc(r.vat_rate != null ? `${r.vat_rate}%` : ''),
      esc(r.payment_method || ''),
      esc(r.structured_comm || ''),
      esc(r.notes),
      esc(r.items_summary)
    ].join(';')).join('\n');

    const csv = '\uFEFF' + header + rows;
    const filename = `factures-${new Date().toISOString().split('T')[0]}.csv`;
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(csv);
  } catch (err) { next(err); }
});

module.exports = router;
