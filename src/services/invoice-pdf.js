const PDFDocument = require('pdfkit');

/**
 * Generate a Belgian-compliant invoice PDF
 * Returns a Buffer
 */
async function generateInvoicePDF(invoice, items, opts = {}) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50, bufferPages: true });
    const buffers = [];
    doc.on('data', b => buffers.push(b));
    doc.on('end', () => resolve(Buffer.concat(buffers)));
    doc.on('error', reject);

    const W = doc.page.width - 100; // usable width
    const isQuote = invoice.type === 'quote';
    const isCreditNote = invoice.type === 'credit_note';
    const title = isQuote ? 'DEVIS' : isCreditNote ? 'NOTE DE CRÉDIT' : 'FACTURE';
    const lang = invoice.language || 'fr';

    // Colors
    const PRIMARY = '#0D7377';
    const TEXT = '#1A1816';
    const MUTED = '#6B6560';
    const LIGHT = '#F5F4F1';
    const BORDER = '#E0DDD8';

    // ===== HEADER =====
    // Business name (left)
    doc.fontSize(18).font('Helvetica-Bold').fillColor(PRIMARY)
      .text(invoice.business_name, 50, 50, { width: W / 2 });

    // Invoice title (right)
    doc.fontSize(24).font('Helvetica-Bold').fillColor(TEXT)
      .text(title, W / 2 + 50, 50, { width: W / 2, align: 'right' });

    // Invoice number + date
    doc.fontSize(9).font('Helvetica').fillColor(MUTED);
    let y = 80;
    doc.text(`N° ${invoice.invoice_number}`, W / 2 + 50, y, { width: W / 2, align: 'right' });
    y += 14;
    doc.text(`Date : ${formatDate(invoice.issue_date, lang)}`, W / 2 + 50, y, { width: W / 2, align: 'right' });
    if (invoice.due_date && !isQuote) {
      y += 14;
      doc.text(`Échéance : ${formatDate(invoice.due_date, lang)}`, W / 2 + 50, y, { width: W / 2, align: 'right' });
    }

    // Business details (left)
    y = 80;
    doc.fontSize(8.5).font('Helvetica').fillColor(MUTED);
    if (invoice.business_address) { doc.text(invoice.business_address, 50, y, { width: W / 2 }); y += 12; }
    if (invoice.business_bce) { doc.text(`BCE/TVA : ${invoice.business_bce}`, 50, y); y += 12; }
    if (invoice.business_iban) { doc.text(`IBAN : ${invoice.business_iban}`, 50, y); y += 12; }
    if (invoice.business_bic) { doc.text(`BIC : ${invoice.business_bic}`, 50, y); y += 12; }

    // Divider
    y = Math.max(y, 130) + 10;
    doc.moveTo(50, y).lineTo(W + 50, y).strokeColor(BORDER).lineWidth(1).stroke();
    y += 20;

    // ===== CLIENT BLOCK =====
    doc.roundedRect(50, y, W / 2 - 10, 80, 4).fillColor(LIGHT).fill();
    doc.fontSize(7.5).font('Helvetica-Bold').fillColor(MUTED)
      .text(isQuote ? 'DESTINATAIRE' : 'FACTURÉ À', 60, y + 10);
    doc.fontSize(10).font('Helvetica-Bold').fillColor(TEXT)
      .text(invoice.client_name, 60, y + 24);
    let cy = y + 38;
    doc.fontSize(8.5).font('Helvetica').fillColor(MUTED);
    if (invoice.client_address) { doc.text(invoice.client_address, 60, cy, { width: W / 2 - 30 }); cy += 12; }
    if (invoice.client_bce) { doc.text(`TVA : ${invoice.client_bce}`, 60, cy); cy += 12; }
    if (invoice.client_email) { doc.text(invoice.client_email, 60, cy); }

    y += 95;

    // ===== ITEMS TABLE =====
    // Table header
    const cols = { desc: 50, qty: 340, price: 390, vat: 450, total: 490 };
    doc.roundedRect(50, y, W, 22, 3).fillColor(PRIMARY).fill();
    doc.fontSize(8).font('Helvetica-Bold').fillColor('#FFF');
    doc.text('Description', cols.desc + 10, y + 6);
    doc.text('Qté', cols.qty, y + 6, { width: 40, align: 'right' });
    doc.text('Prix unit.', cols.price, y + 6, { width: 50, align: 'right' });
    doc.text('TVA', cols.vat, y + 6, { width: 35, align: 'right' });
    doc.text('Total', cols.total, y + 6, { width: 55, align: 'right' });
    y += 26;

    // Table rows
    items.forEach((item, i) => {
      if (i % 2 === 0) {
        doc.rect(50, y - 2, W, 20).fillColor('#FAFAF9').fill();
      }
      doc.fontSize(9).font('Helvetica').fillColor(TEXT);
      doc.text(item.description, cols.desc + 10, y + 2, { width: 270 });
      doc.text(String(item.quantity), cols.qty, y + 2, { width: 40, align: 'right' });
      doc.text(formatMoney(item.unit_price_cents), cols.price, y + 2, { width: 50, align: 'right' });
      doc.fontSize(8).fillColor(MUTED);
      doc.text(`${item.vat_rate}%`, cols.vat, y + 2, { width: 35, align: 'right' });
      doc.fontSize(9).fillColor(TEXT);
      doc.text(formatMoney(item.total_cents), cols.total, y + 2, { width: 55, align: 'right' });
      y += 22;
    });

    // Divider
    y += 4;
    doc.moveTo(350, y).lineTo(W + 50, y).strokeColor(BORDER).lineWidth(0.5).stroke();
    y += 10;

    // ===== TOTALS =====
    const totX = 390;
    const totW = W + 50 - totX;
    doc.fontSize(9).font('Helvetica').fillColor(MUTED);
    doc.text('Sous-total HT', totX, y); doc.text(formatMoney(invoice.subtotal_cents), totX, y, { width: totW, align: 'right' }); y += 16;
    doc.text(`TVA (${invoice.vat_rate}%)`, totX, y); doc.text(formatMoney(invoice.vat_amount_cents), totX, y, { width: totW, align: 'right' }); y += 18;

    // Total box
    doc.roundedRect(totX - 10, y - 4, totW + 20, 28, 4).fillColor(PRIMARY).fill();
    doc.fontSize(11).font('Helvetica-Bold').fillColor('#FFF');
    doc.text('TOTAL TTC', totX, y + 3);
    doc.text(formatMoney(invoice.total_cents), totX, y + 3, { width: totW, align: 'right' });
    y += 40;

    // ===== PAYMENT INFO =====
    if (!isQuote && invoice.status !== 'paid') {
      doc.roundedRect(50, y, W, 60, 4).fillColor(LIGHT).fill();
      doc.fontSize(8.5).font('Helvetica-Bold').fillColor(TEXT)
        .text('INFORMATIONS DE PAIEMENT', 60, y + 10);
      doc.fontSize(8.5).font('Helvetica').fillColor(MUTED);
      let py = y + 24;
      if (invoice.business_iban) { doc.text(`Virement sur : ${invoice.business_iban}`, 60, py); py += 12; }
      if (invoice.structured_comm) {
        doc.font('Helvetica-Bold').fillColor(PRIMARY)
          .text(`Communication structurée : ${invoice.structured_comm}`, 60, py);
        py += 12;
      }
      doc.font('Helvetica').fillColor(MUTED);
      if (invoice.due_date) { doc.text(`À payer avant le ${formatDate(invoice.due_date, lang)}`, 60, py); }
      y += 70;
    }

    // ===== NOTES =====
    if (invoice.notes) {
      y += 5;
      doc.fontSize(8.5).font('Helvetica-Oblique').fillColor(MUTED)
        .text(invoice.notes, 50, y, { width: W });
      y += 30;
    }

    // ===== FOOTER =====
    const footerY = doc.page.height - 60;
    doc.moveTo(50, footerY).lineTo(W + 50, footerY).strokeColor(BORDER).lineWidth(0.5).stroke();
    doc.fontSize(7).font('Helvetica').fillColor(MUTED);
    const footer = invoice.footer_text || `${invoice.business_name}${invoice.business_bce ? ' · ' + invoice.business_bce : ''} · Facture générée par Genda.be`;
    doc.text(footer, 50, footerY + 8, { width: W, align: 'center' });

    // Status watermark
    if (invoice.status === 'paid') {
      doc.save();
      doc.rotate(-30, { origin: [doc.page.width / 2, doc.page.height / 2] });
      doc.fontSize(60).font('Helvetica-Bold').fillColor('#1B7A4220')
        .text('PAYÉE', 100, doc.page.height / 2 - 30, { width: 400, align: 'center' });
      doc.restore();
    } else if (invoice.status === 'cancelled') {
      doc.save();
      doc.rotate(-30, { origin: [doc.page.width / 2, doc.page.height / 2] });
      doc.fontSize(60).font('Helvetica-Bold').fillColor('#DC262620')
        .text('ANNULÉE', 80, doc.page.height / 2 - 30, { width: 400, align: 'center' });
      doc.restore();
    }

    doc.end();
  });
}

/**
 * Generate Belgian structured communication
 * Format: +++XXX/XXXX/XXXXX+++
 * Based on invoice number, with modulo 97 check digit
 */
function generateStructuredComm(invoiceNumber) {
  // Extract digits from invoice number
  const digits = invoiceNumber.replace(/\D/g, '');
  // Pad to 10 digits
  const base = digits.padStart(10, '0').slice(-10);
  const num = BigInt(base);
  const mod = Number(num % 97n);
  const check = mod === 0 ? 97 : mod;
  const full = base + String(check).padStart(2, '0');
  return `+++${full.slice(0, 3)}/${full.slice(3, 7)}/${full.slice(7)}+++`;
}

/**
 * Generate next invoice number for a business
 * Format: F-YYYY-NNNN (or D- for devis, NC- for credit note)
 */
async function getNextInvoiceNumber(queryFn, businessId, type) {
  const prefix = type === 'quote' ? 'D' : type === 'credit_note' ? 'NC' : 'F';
  const year = new Date().getFullYear();
  const pattern = `${prefix}-${year}-%`;

  const result = await queryFn(
    `SELECT invoice_number FROM invoices
     WHERE business_id = $1 AND invoice_number LIKE $2
     ORDER BY invoice_number DESC LIMIT 1`,
    [businessId, pattern]
  );

  let seq = 1;
  if (result.rows.length > 0) {
    const last = result.rows[0].invoice_number;
    const parts = last.split('-');
    seq = parseInt(parts[parts.length - 1]) + 1;
  }

  return `${prefix}-${year}-${String(seq).padStart(4, '0')}`;
}

function formatMoney(cents) {
  const val = (cents / 100).toFixed(2);
  return val.replace('.', ',') + ' €';
}

function formatDate(d, lang) {
  const date = new Date(d);
  const months = lang === 'nl'
    ? ['jan', 'feb', 'mrt', 'apr', 'mei', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'dec']
    : ['jan', 'fév', 'mar', 'avr', 'mai', 'jun', 'jul', 'aoû', 'sep', 'oct', 'nov', 'déc'];
  return `${date.getDate()} ${months[date.getMonth()]} ${date.getFullYear()}`;
}

module.exports = { generateInvoicePDF, generateStructuredComm, getNextInvoiceNumber };
