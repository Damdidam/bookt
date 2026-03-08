/**
 * Calendar Render — eventContent and eventClassNames callbacks for FullCalendar.
 * Controls how events look (HTML content, CSS classes) without any data fetching or DOM side effects.
 *
 * Extracted from calendar-events.js for separation of concerns.
 */
import { calState } from '../../state.js';
import { esc, safeId } from '../../utils/dom.js';

const DEFAULT_ACCENT = '#0D7377';

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
    const isMonth = arg.view.type === 'dayGridMonth';

    // -- Month view (same for singles and groups) --
    if (isMonth) {
      const t = arg.event.start ? arg.event.start.toLocaleTimeString('fr-BE', { hour: '2-digit', minute: '2-digit' }) : '';
      const name = (p.client_name || arg.event.title || '').split(' ')[0];
      const extra = p._isGroup ? ' <svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>' : (!p.service_name ? ' <svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z"/></svg>' : '');
      return { html: `<span class="ev-month-pill" style="color:${safeAccent}">${t} <strong>${esc(name)}</strong>${extra}</span>` };
    }

    // -- Week/Day: group container --
    if (p._isGroup) {
      const members = p._members || [];
      const hasFilter = calState.fcHiddenCategories && calState.fcHiddenCategories.size > 0;
      const isPartial = hasFilter && members.some(m => calState.fcHiddenCategories.has(m.service_category || ''));
      const svcs = members.map(m => {
        const label = esc(m.variant_name ? (m.service_name||'RDV libre')+' — '+m.variant_name : (m.service_name || m.custom_label || 'RDV libre'));
        if (hasFilter) {
          const catMatch = !calState.fcHiddenCategories.has(m.service_category || '');
          return catMatch ? '<strong>' + label + '</strong>' : '<span style="opacity:.3">' + label + '</span>';
        }
        return label;
      }).join(' · ');
      const clientDim = isPartial ? ' style="opacity:.4"' : '';
      const iconDim = isPartial ? 'opacity:.3' : 'opacity:.5';
      return { html: `<div class="ev-inner" style="color:${safeAccent}"><span class="ev-client"${clientDim}>${esc(p.client_name || 'Groupe')} <span style="font-size:.58rem;${iconDim}"><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>${members.length}</span></span><span class="ev-service">${svcs}</span></div>` };
    }

    // -- Week/Day: single event --
    const svcLabel = esc(p.variant_name ? (p.service_name||'RDV libre')+' — '+p.variant_name : (p.service_name || p.custom_label || 'RDV libre'));
    const depBadge = p.deposit_required ? (p.deposit_status === 'paid' ? '<span class="ev-badge-dep paid" title="Acompte payé">💰✓</span>' : '<span class="ev-badge-dep" title="Acompte en attente">💰</span>') : '';
    const badges = [
      (p.internal_note ? '<span class="ev-badge ev-badge-note" style="background:' + safeAccent + '"></span>' : ''),
      (p.status === 'modified_pending' ? '<span class="ev-badge ev-badge-mod"></span>' : '')
    ].filter(Boolean).join('');
    const freeTag = !p.service_name ? '<span style="font-size:.58rem;opacity:.6;margin-left:3px"><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z"/></svg></span>' : '';
    return { html: `<div class="ev-inner" style="color:${safeAccent}"><span class="ev-client">${esc(p.client_name || arg.event.title)}${freeTag}${depBadge}</span><span class="ev-service">${svcLabel}</span>${badges ? '<div class="ev-badges">' + badges + '</div>' : ''}</div>` };
  };
}

/**
 * Returns the `eventClassNames` callback.
 */
function buildEventClassNames() {
  return function (arg) {
    const p = arg.event.extendedProps;
    const cls = [];
    if (p._isGroup) {
      const members = p._members || [];
      const hasCancel = members.every(m => m.status === 'cancelled');
      const hasNoShow = members.every(m => m.status === 'no_show');
      const hasCompleted = members.every(m => m.status === 'completed');
      if (hasCancel) cls.push('ev-cancelled');
      else if (hasNoShow) cls.push('ev-no_show');
      else if (hasCompleted) cls.push('ev-completed');
    } else {
      cls.push('ev-' + safeId(p.status || 'confirmed'));
    }
    return cls;
  };
}

export { buildEventContent, buildEventClassNames };
