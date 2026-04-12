/**
 * Calendar Render — eventContent and eventClassNames callbacks for FullCalendar.
 * Controls how events look (HTML content, CSS classes) without any data fetching or DOM side effects.
 *
 * Extracted from calendar-events.js for separation of concerns.
 */
import { calState } from '../../state.js';
import { esc, safeId } from '../../utils/dom.js';
import { fcDarkenHex } from './calendar-init.js';

/** Build display label: "Category - Service — Variant" or fallback */
export function fmtSvcLabel(category, serviceName, variantName, customLabel) {
  if (!serviceName) return customLabel || 'RDV libre';
  let label = category ? category + ' - ' + serviceName : serviceName;
  if (variantName) label += ' — ' + variantName;
  return label;
}

const DEFAULT_ACCENT = '#0D7377';
const ST_COLORS = { confirmed:'var(--green)', pending:'#EAB308', modified_pending:'var(--amber)', pending_deposit:'var(--amber)', completed:'#374151', no_show:'var(--red)', cancelled:'var(--red)' };

/* Harmonised Lucide-style SVG icons — stroke-based, currentColor, no fill */
const gi = svg => svg.replace('<svg class="gi" ', '<svg class="gi" '); // inject .gi class for inline icon contexts
const S = 'fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"';
const IC = {
  crown:   gi(`<svg class="gi" viewBox="0 0 24 24" ${S}><path d="M2 4l3 12h14l3-12-5 4-5-6-5 6z"/><path d="M5 16h14v4H5z"/></svg>`),
  lock:    gi(`<svg class="gi" viewBox="0 0 24 24" ${S}><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>`),
  dollar:  gi(`<svg class="gi" viewBox="0 0 24 24" ${S}><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>`),
  chain:   gi(`<svg class="gi" viewBox="0 0 24 24" ${S}><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>`),
  sparkle: gi(`<svg class="gi" viewBox="0 0 24 24" ${S}><path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z"/></svg>`),
  note:    gi(`<svg class="gi" viewBox="0 0 24 24" ${S}><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>`),
  wrench:  gi(`<svg class="gi" viewBox="0 0 24 24" ${S}><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg>`),
  tag:     gi(`<svg class="gi" viewBox="0 0 24 24" ${S}><path d="M12 2H2v10l9.29 9.29c.94.94 2.48.94 3.42 0l6.58-6.58c.94-.94.94-2.48 0-3.42L12 2Z"/><path d="M7 7h.01"/></svg>`),
};

/**
 * Returns the `eventContent` callback for custom rendering.
 */
function buildEventContent() {
  return function (arg) {
    const p = arg.event.extendedProps;
    // Skip featured slot background events — they are purely visual (gold dashed boxes)
    if (p._isFeaturedSlot) return { html: '' };
    const accent = p._accent || DEFAULT_ACCENT;
    const safeAccent = /^#[0-9a-fA-F]{3,8}$/.test(accent) ? accent : DEFAULT_ACCENT;
    const darkAccent = fcDarkenHex(safeAccent, 0.7);
    const isMonth = arg.view.type === 'dayGridMonth';

    // -- Internal task --
    if (p._isTask) {
      if (isMonth) {
        const t = arg.event.start ? arg.event.start.toLocaleTimeString('fr-BE', { timeZone: 'Europe/Brussels', hour: '2-digit', minute: '2-digit' }) : '';
        return { html: `<span class="ev-month-pill ev-task-pill" style="color:${darkAccent}">${t} ${gi(IC.wrench)} <strong>${esc(p.title)}</strong></span>` };
      }
      const noteLine = p.note ? '<span class="ev-service">' + esc(p.note.length > 40 ? p.note.slice(0, 37) + '…' : p.note) + '</span>' : '';
      const stDot = p.status === 'completed' ? '<span class="ev-badge ev-badge-st" style="background:var(--text-3)"></span>' : '';
      return { html: `<div class="ev-inner ev-task-inner" style="color:${darkAccent}"><span class="ev-client">${gi(IC.wrench)} ${esc(p.title)}</span>${noteLine}<div class="ev-badges">${stDot}</div></div>` };
    }

    // -- Month view (same for singles and groups) --
    if (isMonth) {
      const t = arg.event.start ? arg.event.start.toLocaleTimeString('fr-BE', { timeZone: 'Europe/Brussels', hour: '2-digit', minute: '2-digit' }) : '';
      const name = (p.client_name || arg.event.title || '').split(' ')[0];
      const extra = p._isGroup ? ' ' + gi(IC.chain) : (!p.service_name ? ' ' + gi(IC.sparkle) : '');
      return { html: `<span class="ev-month-pill" style="color:${darkAccent}">${t} <strong>${esc(name)}</strong>${extra}</span>` };
    }

    // -- Week/Day: group container --
    if (p._isGroup) {
      const members = p._members || [];
      const hasFilter = calState.fcHiddenCategories && calState.fcHiddenCategories.size > 0;
      const isPartial = hasFilter && members.some(m => calState.fcHiddenCategories.has(m.service_category || ''));
      const svcs = members.map(m => {
        const label = esc(fmtSvcLabel(m.service_category, m.service_name, m.variant_name, m.custom_label));
        if (hasFilter) {
          const catMatch = !calState.fcHiddenCategories.has(m.service_category || '');
          return catMatch ? '<strong>' + label + '</strong>' : '<span style="opacity:.3">' + label + '</span>';
        }
        return label;
      }).join(' \u00b7 ');
      const clientDim = isPartial ? ' style="opacity:.4"' : '';
      const iconDim = isPartial ? 'opacity:.3' : 'opacity:.8';
      const tStart = arg.event.start ? arg.event.start.toLocaleTimeString('fr-BE', { timeZone: 'Europe/Brussels', hour: '2-digit', minute: '2-digit' }).replace(':', 'h') : '';
      const tEnd = arg.event.end ? arg.event.end.toLocaleTimeString('fr-BE', { timeZone: 'Europe/Brussels', hour: '2-digit', minute: '2-digit' }).replace(':', 'h') : '';
      const timeSpan = tStart ? '<span class="ev-time">' + tStart + (tEnd ? ' \u2013 ' + tEnd : '') + '</span>' : '';
      const grpVip = p.client_is_vip ? '<span class="ev-badge-vip" title="VIP">' + IC.crown + '</span>' : '';
      const grpLock = members.some(m => m.locked) ? '<span class="ev-badge-lock" title="Verrouill\u00e9">' + IC.lock + '</span>' : '';
      const grpSt = members.every(m => m.status === 'cancelled') ? 'cancelled' : members.every(m => m.status === 'no_show') ? 'no_show' : members.every(m => m.status === 'completed') ? 'completed' : (members[0].status || 'confirmed');
      const grpStC = ST_COLORS[grpSt] || ST_COLORS.confirmed;
      const grpPromo = members.some(m => m.discount_pct || m.promotion_discount_cents > 0 || m.promotion_id) ? '<span class="ev-badge-promo" title="Promo">' + IC.tag + '</span>' : '';
      const grpHasNote = members.some(m => m.internal_note || m.notes_count > 0 || m.client_notes || m.comment_client);
      const grpNote = grpHasNote ? '<span class="ev-badge-note" title="Note">' + IC.note + '</span>' : '';
      const _grpDepSt = members.find(m => m.deposit_required)?.deposit_status;
      const grpDep = !_grpDepSt ? '' : _grpDepSt === 'paid' ? '<span class="ev-badge-dep paid" title="Acompte pay\u00e9">' + IC.dollar + '</span>' : ['refunded','waived'].includes(_grpDepSt) ? '<span class="ev-badge-dep" style="opacity:.4" title="Acompte ' + _grpDepSt + '">' + IC.dollar + '</span>' : _grpDepSt === 'cancelled' ? '<span class="ev-badge-dep" style="color:var(--red)" title="Acompte retenu">' + IC.dollar + '</span>' : '<span class="ev-badge-dep" title="Acompte en attente">' + IC.dollar + '</span>';
      const grpStDot = '<span class="ev-badge ev-badge-st" style="background:' + grpStC + '"></span>';
      const grpBadges = grpStDot + grpVip + grpLock + grpDep + grpPromo + grpNote;
      return { html: `<div class="ev-inner" style="color:${darkAccent}"><span class="ev-client"${clientDim}>${esc(p.client_name || 'Groupe')} ${timeSpan} <span style="font-size:.68rem;${iconDim}">${gi(IC.chain)}${members.length}</span></span><div class="ev-badges">${grpBadges}</div><span class="ev-service">${svcs}</span></div>` };
    }

    // -- Week/Day: single event --
    const svcLabel = esc(fmtSvcLabel(p.service_category, p.service_name, p.variant_name, p.custom_label));
    const sStart = arg.event.start ? arg.event.start.toLocaleTimeString('fr-BE', { timeZone: 'Europe/Brussels', hour: '2-digit', minute: '2-digit' }).replace(':', 'h') : '';
    const sEnd = arg.event.end ? arg.event.end.toLocaleTimeString('fr-BE', { timeZone: 'Europe/Brussels', hour: '2-digit', minute: '2-digit' }).replace(':', 'h') : '';
    const sTimeSpan = sStart ? '<span class="ev-time">' + sStart + (sEnd ? ' \u2013 ' + sEnd : '') + '</span>' : '';
    const vipBadge = p.client_is_vip ? '<span class="ev-badge-vip" title="VIP">' + IC.crown + '</span>' : '';
    const depBadge = !p.deposit_required ? '' : p.deposit_status === 'paid' ? '<span class="ev-badge-dep paid" title="Acompte pay\u00e9">' + IC.dollar + '</span>' : ['refunded','waived'].includes(p.deposit_status) ? '<span class="ev-badge-dep" style="opacity:.4" title="Acompte ' + p.deposit_status + '">' + IC.dollar + '</span>' : p.deposit_status === 'cancelled' ? '<span class="ev-badge-dep" style="color:var(--red)" title="Acompte retenu">' + IC.dollar + '</span>' : '<span class="ev-badge-dep" title="Acompte en attente">' + IC.dollar + '</span>';
    const quoteBadge = p.service_quote_only ? '<span class="ev-badge-quote" title="Sur devis" style="color:var(--primary)">' + IC.fileText + '</span>' : '';
    const promoBadge = (p.discount_pct || p.promotion_discount_cents > 0 || p.promotion_id) ? '<span class="ev-badge-promo" title="Promo' + (p.discount_pct ? ' -' + p.discount_pct + '%' : '') + '">' + IC.tag + '</span>' : '';
    const lockBadge = p.locked ? '<span class="ev-badge-lock" title="Verrouill\u00e9">' + IC.lock + '</span>' : '';
    const hasNote = p.internal_note || p.notes_count > 0 || p.client_notes || p.comment_client;
    const noteBadge = hasNote ? '<span class="ev-badge-note" title="Note">' + IC.note + '</span>' : '';
    const stColor = ST_COLORS[p.status] || ST_COLORS.confirmed;
    const stDot = '<span class="ev-badge ev-badge-st" style="background:' + stColor + '"></span>';
    const freeTag = !p.service_name ? '<span style="font-size:.68rem;opacity:.85;margin-left:3px">' + gi(IC.sparkle) + '</span>' : '';
    const sBadges = stDot + vipBadge + lockBadge + depBadge + quoteBadge + promoBadge + noteBadge;
    return { html: `<div class="ev-inner" style="color:${darkAccent}"><span class="ev-client">${esc(p.client_name || arg.event.title)} ${sTimeSpan}${freeTag}</span><div class="ev-badges">${sBadges}</div><span class="ev-service">${svcLabel}</span></div>` };
  };
}

/**
 * Returns the `eventClassNames` callback.
 */
function buildEventClassNames() {
  return function (arg) {
    const p = arg.event.extendedProps;
    const cls = [];
    if (p._isTask) {
      cls.push('ev-task');
      if (p.status === 'completed') cls.push('ev-task-done');
      if (p.status === 'cancelled') cls.push('ev-cancelled');
      return cls;
    }
    if (p._isGroup) {
      const members = p._members || [];
      const hasCancel = members.every(m => m.status === 'cancelled');
      const hasNoShow = members.every(m => m.status === 'no_show');
      const hasCompleted = members.every(m => m.status === 'completed');
      if (hasCancel) cls.push('ev-cancelled');
      else if (hasNoShow) cls.push('ev-no_show');
      else if (hasCompleted) cls.push('ev-completed');
      else if (members.some(m => m.status === 'modified_pending')) cls.push('ev-modified_pending');
      else if (members.some(m => m.status === 'pending_deposit')) cls.push('ev-pending_deposit');
      else if (members.some(m => m.status === 'pending')) cls.push('ev-pending');
      else if (members.some(m => m.status === 'confirmed')) cls.push('ev-confirmed');
    } else {
      cls.push('ev-' + safeId(p.status || 'confirmed'));
    }
    return cls;
  };
}

export { buildEventContent, buildEventClassNames };
