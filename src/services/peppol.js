/**
 * Peppol integration via Billit API.
 *
 * Wraps the 3 things we need :
 * 1. buildUBLXml(stripeInvoice, emitter, recipient) — deterministic UBL 2.1 BIS 3.0 XML
 * 2. sendInvoice(subInvoiceRow) — POST Billit with timeout + row update
 * 3. handleWebhook(body, signature) — validate HMAC + UPDATE status
 *
 * Every public function must be safe to call even if Billit is down : INSERT
 * rows in 'pending' state and let the cron retry. No throw that could crash
 * the Stripe webhook handler.
 *
 * See docs/superpowers/specs/2026-04-21-peppol-integration-design.md
 */
const db = require('./db');
const { create } = require('xmlbuilder2');

function query(...args) {
  return db.query(...args);
}

let _settingsCache = null;
let _settingsCacheAt = 0;
const SETTINGS_TTL_MS = 60 * 60 * 1000; // 1h

async function loadPlatformSettings() {
  if (_settingsCache && Date.now() - _settingsCacheAt < SETTINGS_TTL_MS) {
    return _settingsCache;
  }
  const r = await query(`SELECT * FROM platform_settings WHERE id = 1 LIMIT 1`);
  if (r.rows.length === 0) return null;
  _settingsCache = r.rows[0];
  _settingsCacheAt = Date.now();
  return _settingsCache;
}

function _invalidateSettingsCache() {
  _settingsCache = null;
  _settingsCacheAt = 0;
}

function _isoDate(unixSec) {
  return new Date(unixSec * 1000).toISOString().slice(0, 10);
}

function _fmtAmount(cents) {
  return (cents / 100).toFixed(2);
}

function _deriveBcePeppolId(vatNumber) {
  // BE VAT 'BE0123456789' → BCE '0123456789' → Peppol participant '0208:0123456789'
  if (!vatNumber) return null;
  const match = /^BE(\d{10})$/i.exec(vatNumber.replace(/\s/g, ''));
  if (!match) return null;
  return match[1];
}

function buildUBLXml(stripeInvoice, emitter, recipient) {
  const emitterBce = emitter.bce_number;
  const recipientBce = _deriveBcePeppolId(recipient.vat_number);
  const currency = (stripeInvoice.currency || 'eur').toUpperCase();

  const line = stripeInvoice.lines.data[0];
  const lineAmountHt = _fmtAmount(line.amount);
  const vatRate = line.tax_amounts?.[0]?.tax_rate?.percentage ?? 21;
  const totalHt = _fmtAmount(stripeInvoice.subtotal);
  const totalVat = _fmtAmount(stripeInvoice.tax);
  const totalTtc = _fmtAmount(stripeInvoice.total);

  const doc = create({ version: '1.0', encoding: 'UTF-8' })
    .ele('Invoice', {
      xmlns: 'urn:oasis:names:specification:ubl:schema:xsd:Invoice-2',
      'xmlns:cac': 'urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2',
      'xmlns:cbc': 'urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2'
    });

  doc.ele('cbc:CustomizationID').txt('urn:cen.eu:en16931:2017#compliant#urn:fdc:peppol.eu:2017:poacc:billing:3.0');
  doc.ele('cbc:ProfileID').txt('urn:fdc:peppol.eu:2017:poacc:billing:01:1.0');
  doc.ele('cbc:ID').txt(stripeInvoice.number || stripeInvoice.id);
  doc.ele('cbc:IssueDate').txt(_isoDate(Math.floor(Date.now() / 1000)));
  doc.ele('cbc:DueDate').txt(_isoDate(Math.floor(Date.now() / 1000)));
  doc.ele('cbc:InvoiceTypeCode').txt('380');
  doc.ele('cbc:Note').txt('Paiement reçu via Stripe');
  doc.ele('cbc:DocumentCurrencyCode').txt(currency);

  const period = doc.ele('cac:InvoicePeriod');
  period.ele('cbc:StartDate').txt(_isoDate(stripeInvoice.period_start));
  period.ele('cbc:EndDate').txt(_isoDate(stripeInvoice.period_end));

  // Supplier (emitter)
  const supplier = doc.ele('cac:AccountingSupplierParty').ele('cac:Party');
  supplier.ele('cbc:EndpointID', { schemeID: '0208' }).txt(emitterBce);
  supplier.ele('cac:PartyIdentification').ele('cbc:ID', { schemeID: '0208' }).txt(emitterBce);
  supplier.ele('cac:PartyName').ele('cbc:Name').txt(emitter.company_name);
  const sAddr = supplier.ele('cac:PostalAddress');
  sAddr.ele('cbc:StreetName').txt(emitter.address_street);
  sAddr.ele('cbc:CityName').txt(emitter.address_city);
  sAddr.ele('cbc:PostalZone').txt(emitter.address_zip);
  sAddr.ele('cac:Country').ele('cbc:IdentificationCode').txt(emitter.address_country);
  const sTax = supplier.ele('cac:PartyTaxScheme');
  sTax.ele('cbc:CompanyID').txt(emitter.vat_number);
  sTax.ele('cac:TaxScheme').ele('cbc:ID').txt('VAT');
  const sLegal = supplier.ele('cac:PartyLegalEntity');
  sLegal.ele('cbc:RegistrationName').txt(emitter.company_name);
  sLegal.ele('cbc:CompanyID', { schemeID: '0208' }).txt(emitterBce);
  supplier.ele('cac:Contact').ele('cbc:ElectronicMail').txt(emitter.contact_email);

  // Customer (recipient)
  const customer = doc.ele('cac:AccountingCustomerParty').ele('cac:Party');
  if (recipientBce) {
    customer.ele('cbc:EndpointID', { schemeID: '0208' }).txt(recipientBce);
    customer.ele('cac:PartyIdentification').ele('cbc:ID', { schemeID: '0208' }).txt(recipientBce);
  } else {
    customer.ele('cbc:EndpointID', { schemeID: '9925' }).txt(recipient.email);
  }
  customer.ele('cac:PartyName').ele('cbc:Name').txt(recipient.name || 'Client');
  const cAddr = customer.ele('cac:PostalAddress');
  cAddr.ele('cbc:StreetName').txt(recipient.address || '');
  cAddr.ele('cac:Country').ele('cbc:IdentificationCode').txt('BE');
  if (recipient.vat_number) {
    const cTax = customer.ele('cac:PartyTaxScheme');
    cTax.ele('cbc:CompanyID').txt(recipient.vat_number);
    cTax.ele('cac:TaxScheme').ele('cbc:ID').txt('VAT');
  }
  const cLegal = customer.ele('cac:PartyLegalEntity');
  cLegal.ele('cbc:RegistrationName').txt(recipient.name || 'Client');
  if (recipientBce) cLegal.ele('cbc:CompanyID', { schemeID: '0208' }).txt(recipientBce);
  customer.ele('cac:Contact').ele('cbc:ElectronicMail').txt(recipient.email);

  // Tax totals
  const taxTotal = doc.ele('cac:TaxTotal');
  taxTotal.ele('cbc:TaxAmount', { currencyID: currency }).txt(totalVat);
  const taxSubtotal = taxTotal.ele('cac:TaxSubtotal');
  taxSubtotal.ele('cbc:TaxableAmount', { currencyID: currency }).txt(totalHt);
  taxSubtotal.ele('cbc:TaxAmount', { currencyID: currency }).txt(totalVat);
  const taxCat = taxSubtotal.ele('cac:TaxCategory');
  taxCat.ele('cbc:ID').txt('S');
  taxCat.ele('cbc:Percent').txt(String(vatRate));
  taxCat.ele('cac:TaxScheme').ele('cbc:ID').txt('VAT');

  // Monetary totals
  const monTotal = doc.ele('cac:LegalMonetaryTotal');
  monTotal.ele('cbc:LineExtensionAmount', { currencyID: currency }).txt(totalHt);
  monTotal.ele('cbc:TaxExclusiveAmount', { currencyID: currency }).txt(totalHt);
  monTotal.ele('cbc:TaxInclusiveAmount', { currencyID: currency }).txt(totalTtc);
  monTotal.ele('cbc:PayableAmount', { currencyID: currency }).txt(totalTtc);

  // Invoice line
  const invLine = doc.ele('cac:InvoiceLine');
  invLine.ele('cbc:ID').txt('1');
  invLine.ele('cbc:InvoicedQuantity', { unitCode: 'MON' }).txt('1');
  invLine.ele('cbc:LineExtensionAmount', { currencyID: currency }).txt(lineAmountHt);
  const lItem = invLine.ele('cac:Item');
  lItem.ele('cbc:Name').txt(line.description || 'Abonnement Genda');
  const lTax = lItem.ele('cac:ClassifiedTaxCategory');
  lTax.ele('cbc:ID').txt('S');
  lTax.ele('cbc:Percent').txt(String(vatRate));
  lTax.ele('cac:TaxScheme').ele('cbc:ID').txt('VAT');
  const lPrice = invLine.ele('cac:Price');
  lPrice.ele('cbc:PriceAmount', { currencyID: currency }).txt(lineAmountHt);

  return doc.end({ prettyPrint: true });
}

function _extractRecipient(stripeInvoice) {
  const addr = stripeInvoice.customer_address || {};
  const taxIds = stripeInvoice.customer_tax_ids || [];
  const vat = taxIds.find(t => t.type === 'eu_vat')?.value || null;
  const addressStr = [addr.line1, addr.line2, addr.postal_code, addr.city, addr.country]
    .filter(Boolean).join(', ');
  return {
    name: stripeInvoice.customer_name || 'Client',
    vat_number: vat,
    address: addressStr,
    email: stripeInvoice.customer_email
  };
}

async function _sendToBillit(subInvoiceId, ublXml, recipient, emitter) {
  const apiUrl = process.env.BILLIT_API_URL;
  const apiKey = process.env.BILLIT_API_KEY;
  if (!apiUrl || !apiKey) {
    return { ok: false, reason: 'BILLIT not configured — row stays pending for cron retry' };
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  try {
    const res = await fetch(`${apiUrl}/invoices`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        reference: subInvoiceId,
        format: 'ubl',
        ubl_xml: ublXml,
        recipient_email_fallback: recipient.email
      }),
      signal: controller.signal
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      return { ok: false, reason: `Billit ${res.status}: ${text.slice(0, 200)}` };
    }
    const data = await res.json();
    return { ok: true, billitInvoiceId: data.invoiceId || data.id };
  } catch (e) {
    return { ok: false, reason: `Billit request failed: ${e.message}` };
  } finally {
    clearTimeout(timeout);
  }
}

async function dispatchFromStripeInvoice(stripeInvoice) {
  const emitter = await loadPlatformSettings();
  if (!emitter) {
    console.error('[PEPPOL] platform_settings empty — abort dispatch');
    return;
  }
  const recipient = _extractRecipient(stripeInvoice);
  const peppolParticipantId = _deriveBcePeppolId(recipient.vat_number);
  const ubl = buildUBLXml(stripeInvoice, emitter, recipient);

  const bizRes = await query(
    `SELECT id FROM businesses WHERE stripe_customer_id = $1 LIMIT 1`,
    [stripeInvoice.customer]
  );
  if (bizRes.rows.length === 0) {
    console.error('[PEPPOL] business not found for customer', stripeInvoice.customer);
    return;
  }
  const businessId = bizRes.rows[0].id;

  const insertRes = await query(
    `INSERT INTO subscription_invoices
      (business_id, stripe_invoice_id, stripe_invoice_number, stripe_pdf_url,
       period_start, period_end,
       amount_ht_cents, amount_vat_cents, amount_total_cents, vat_rate, currency,
       recipient_name, recipient_vat, recipient_address, recipient_email,
       peppol_participant_id, ubl_xml, status, next_retry_at)
     VALUES
      ($1, $2, $3, $4,
       to_timestamp($5), to_timestamp($6),
       $7, $8, $9, $10, $11,
       $12, $13, $14, $15,
       $16, $17, 'pending', NOW() + INTERVAL '1 minute')
     ON CONFLICT (stripe_invoice_id) DO NOTHING
     RETURNING id`,
    [
      businessId, stripeInvoice.id, stripeInvoice.number, stripeInvoice.invoice_pdf,
      stripeInvoice.period_start, stripeInvoice.period_end,
      stripeInvoice.subtotal, stripeInvoice.tax, stripeInvoice.total,
      stripeInvoice.lines.data[0]?.tax_amounts?.[0]?.tax_rate?.percentage ?? 21,
      (stripeInvoice.currency || 'eur').toUpperCase(),
      recipient.name, recipient.vat_number, recipient.address, recipient.email,
      peppolParticipantId ? `0208:${peppolParticipantId}` : null,
      ubl
    ]
  );
  if (insertRes.rows.length === 0) {
    return;
  }
  const subInvoiceId = insertRes.rows[0].id;

  const result = await _sendToBillit(subInvoiceId, ubl, recipient, emitter);
  if (result.ok) {
    await query(
      `UPDATE subscription_invoices
         SET billit_invoice_id = $1, status = 'peppol_sent', next_retry_at = NULL, updated_at = NOW()
         WHERE id = $2`,
      [result.billitInvoiceId, subInvoiceId]
    );
  } else {
    await query(
      `UPDATE subscription_invoices
         SET status_detail = $1, updated_at = NOW()
         WHERE id = $2`,
      [result.reason, subInvoiceId]
    );
  }
}

module.exports = {
  loadPlatformSettings,
  buildUBLXml,
  dispatchFromStripeInvoice,
  _invalidateSettingsCache,
  _deriveBcePeppolId,
  _extractRecipient,
  _sendToBillit
};
