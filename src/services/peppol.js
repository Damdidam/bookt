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
const { query } = require('./db');
const { create } = require('xmlbuilder2');

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

module.exports = {
  loadPlatformSettings,
  buildUBLXml,
  _invalidateSettingsCache,
  _deriveBcePeppolId
};
