/**
 * Sub-invoices (factures d'abonnement Genda → commerçant) — section collapsable
 * dans Settings. Rendu table avec Période / N° / TTC / Statut / PDF.
 */
import { api } from '../state.js';
import { formatEur as fmtEur } from '../utils/format.js';
import { IC } from '../utils/icons.js';

const esc = s => String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;')
                                 .replace(/>/g,'&gt;').replace(/"/g,'&quot;');

const STATUS_MAP = {
  'peppol_delivered': { icon: IC.check,          color: 'var(--green)',  label: 'Reçue via Peppol' },
  'peppol_sent':      { icon: IC.clock,          color: 'var(--text-3)', label: 'En cours via Peppol…' },
  'email_sent':       { icon: IC.mail,           color: 'var(--text-3)', label: 'Envoyée par email' },
  'peppol_bounced':   { icon: IC.alertTriangle,  color: 'var(--red)',    label: 'Échec Peppol' },
  'pending':          { icon: IC.clock,          color: 'var(--text-3)', label: 'En attente' },
  'failed':           { icon: IC.alertTriangle,  color: 'var(--red)',    label: 'Échec' }
};

function formatPeriod(startIso, endIso) {
  const s = new Date(startIso);
  const e = new Date(endIso);
  const dd = d => String(d.getDate()).padStart(2, '0');
  const mm = d => String(d.getMonth() + 1).padStart(2, '0');
  return `${dd(s)}/${mm(s)} → ${dd(e)}/${mm(e)}/${e.getFullYear()}`;
}

function renderBadge(status) {
  const s = STATUS_MAP[status] || STATUS_MAP.pending;
  return `<span style="display:inline-flex;align-items:center;gap:4px;color:${s.color};font-size:.82rem">${s.icon}<span>${esc(s.label)}</span></span>`;
}

function renderEmpty() {
  return `<div class="empty" style="padding:20px;text-align:center;color:var(--text-3);font-size:.85rem">Aucune facture d'abonnement pour le moment.</div>`;
}

function renderTable(invoices) {
  const rows = invoices.map(inv => `
    <tr>
      <td>${esc(formatPeriod(inv.period_start, inv.period_end))}</td>
      <td style="font-family:var(--mono, monospace);font-size:.82rem">${esc(inv.stripe_invoice_number || '—')}</td>
      <td style="text-align:right;font-weight:600">${fmtEur(inv.amount_total_cents)}</td>
      <td>${renderBadge(inv.status)}</td>
      <td style="text-align:center">
        ${inv.stripe_pdf_url
          ? `<a href="${esc(inv.stripe_pdf_url)}" target="_blank" rel="noopener" aria-label="Télécharger PDF">${IC.download}</a>`
          : '—'}
      </td>
    </tr>
  `).join('');
  return `
    <table class="tbl" style="width:100%;font-size:.85rem">
      <thead>
        <tr>
          <th scope="col" style="text-align:left">Période</th>
          <th scope="col" style="text-align:left">N°</th>
          <th scope="col" style="text-align:right">TTC</th>
          <th scope="col" style="text-align:left">Statut</th>
          <th scope="col" style="text-align:center">PDF</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  `;
}

export async function renderSubInvoicesBlock(container) {
  if (!container) return;
  container.innerHTML = '<div class="loading"><div class="spinner"></div></div>';
  try {
    const d = await api.get('/api/staff/subscription-invoices?limit=20');
    const invoices = d.invoices || [];
    const countEl = document.getElementById('subInvoicesCount');
    if (countEl) countEl.textContent = invoices.length > 0 ? `(${invoices.length})` : '';
    container.innerHTML = invoices.length === 0 ? renderEmpty() : renderTable(invoices);
  } catch (e) {
    container.innerHTML = `<div class="empty" style="color:var(--red)">Erreur: ${esc(e.message || 'unknown')}</div>`;
  }
}
