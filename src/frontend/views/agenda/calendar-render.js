/**
 * Calendar Render — eventContent and eventClassNames callbacks for FullCalendar.
 * Controls how events look (HTML content, CSS classes) without any data fetching or DOM side effects.
 *
 * Extracted from calendar-events.js for separation of concerns.
 */
import { calState } from '../../state.js';
import { esc, safeId } from '../../utils/dom.js';

const DEFAULT_ACCENT = '#0D7377';
const ST_COLORS = { confirmed:'#15803D', pending:'#EAB308', modified_pending:'#D97706', completed:'#374151', no_show:'#DC2626', cancelled:'#DC2626' };

/* ── Premium SVG icon library (Lucide-style, stroke-based, currentColor) ── */
const IC = {
  vip:   '<svg viewBox="0 0 24 24"><path d="M2 4l3 12h14l3-12-5 4-5-6-5 6-5-4z"/><path d="M5 16h14v4H5z"/></svg>',
  lock:  '<svg viewBox="0 0 24 24"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>',
  dep:   '<svg viewBox="0 0 24 24"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>',
  chain: '<svg viewBox="0 0 24 24"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>',
  free:  '<svg viewBox="0 0 24 24"><path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z"/></svg>',
  note:  '<svg viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>'
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
      // Corner statut
      const grpSt = members.every(m => m.status === 'cancelled') ? 'cancelled' : members.every(m => m.status === 'no_show') ? 'no_show' : members.every(m => m.status === 'completed') ? 'completed' : (members[0].status || 'confirmed');
      const corner = '<span class="ev-corner" style="--st-color:' + (ST_COLORS[grpSt] || ST_COLORS.confirmed) + '"></span>';
      // Icon bar
      const grpIcons = [
        p.client_is_vip ? IC.vip : '',
        members.some(m => m.locked) ? IC.lock : '',
        members.some(m => m.internal_note) ? IC.note : ''
      ].filter(Boolean);
      const iconBar = grpIcons.length ? '<span class="ev-icons">' + grpIcons.join('') + '</span>' : '';
      return { html: `<div class="ev-inner" style="color:${safeAccent}"><span class="ev-client"${clientDim}>${esc(p.client_name || 'Groupe')}${iconBar} <span style="font-size:.58rem;${iconDim}">${IC.chain}${members.length}</span></span><span class="ev-service">${svcs}</span>${corner}</div>` };
    }

    // -- Week/Day: single event --
    const svcLabel = esc(p.variant_name ? (p.service_name||'RDV libre')+' — '+p.variant_name : (p.service_name || p.custom_label || 'RDV libre'));
    // Corner statut
    const stColor = ST_COLORS[p.status] || ST_COLORS.confirmed;
    const corner = '<span class="ev-corner" style="--st-color:' + stColor + '"></span>';
    // Icon bar — ordre: VIP, lock, deposit, note, free
    const icons = [
      p.client_is_vip ? IC.vip : '',
      p.locked ? IC.lock : '',
      p.deposit_required ? IC.dep : '',
      p.internal_note ? IC.note : '',
      !p.service_name ? IC.free : ''
    ].filter(Boolean);
    const iconBar = icons.length ? '<span class="ev-icons">' + icons.join('') + '</span>' : '';
    return { html: `<div class="ev-inner" style="color:${safeAccent}"><span class="ev-client">${esc(p.client_name || arg.event.title)}${iconBar}</span><span class="ev-service">${svcLabel}</span>${corner}</div>` };
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
