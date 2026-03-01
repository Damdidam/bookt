/**
 * Calendar Events - FullCalendar event-related config callbacks and tooltip helpers.
 * Returns config objects for the FullCalendar options object.
 */
import { api, calState } from '../../state.js';
import { esc, gToast } from '../../utils/dom.js';
import { fcIsMobile } from '../../utils/touch.js';
import { fcHexAlpha, fcRefresh } from './calendar-init.js';
import { fcOpenDetail } from './booking-detail.js';
import { fcOpenQuickCreate } from './quick-create.js';
import { atView } from './calendar-toolbar.js';

// ── Tooltip locale maps ──
const STATUS_FR = { confirmed: 'Confirm\u00e9', pending: 'En attente', completed: 'Termin\u00e9', cancelled: 'Annul\u00e9', no_show: 'Absent', modified_pending: 'Modifi\u00e9', pending_deposit: 'Acompte requis' };
const MODE_FR = { cabinet: 'Au cabinet', visio: 'Visio', phone: 'T\u00e9l\u00e9phone' };

// ── Tooltip helpers ──
function fcShowTooltip(event, x, y) {
  fcHideTooltip();
  const p = event.extendedProps;
  const start = event.start;
  const end = event.end;
  if (!start) return;

  const timeStr = start.toLocaleTimeString('fr-BE', { hour: '2-digit', minute: '2-digit' }) + (end ? ' \u2013 ' + end.toLocaleTimeString('fr-BE', { hour: '2-digit', minute: '2-digit' }) : '');
  const dateStr = start.toLocaleDateString('fr-BE', { weekday: 'short', day: 'numeric', month: 'short' });
  const dur = end ? Math.round((end - start) / 60000) : p.duration_min || 0;

  let html = `<div class="tt-name">${esc(p.client_name || event.title || '\u2014')}</div>`;
  html += `<div class="tt-row"><span class="tt-icon"><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><rect x="8" y="2" width="8" height="4" rx="1"/></svg></span>${esc(p.service_name || p.custom_label || 'RDV libre')}</div>`;
  html += `<div class="tt-row"><span class="tt-icon"><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg></span>${dateStr}</div>`;
  html += `<div class="tt-row"><span class="tt-icon"><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg></span>${timeStr} (${dur} min)</div>`;
  if (p.practitioner_name) html += `<div class="tt-row"><span class="tt-icon"><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg></span>${esc(p.practitioner_name)}</div>`;
  if (p.appointment_mode) html += `<div class="tt-row"><span class="tt-icon">${p.appointment_mode === 'visio' ? '<svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>' : p.appointment_mode === 'phone' ? '<svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"/></svg>' : '<svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="2" width="16" height="20" rx="2"/><path d="M9 22v-4h6v4"/><path d="M8 6h.01"/><path d="M16 6h.01"/><path d="M12 6h.01"/><path d="M12 10h.01"/><path d="M12 14h.01"/><path d="M16 10h.01"/><path d="M16 14h.01"/><path d="M8 10h.01"/><path d="M8 14h.01"/></svg>'}</span>${MODE_FR[p.appointment_mode] || p.appointment_mode}</div>`;
  if (p.client_phone) html += `<div class="tt-row"><span class="tt-icon"><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="2" width="14" height="20" rx="2"/><line x1="12" y1="18" x2="12.01" y2="18"/></svg></span>${esc(p.client_phone)}</div>`;
  const st = p.status || 'confirmed';
  html += `<div class="tt-badge ${st}">${STATUS_FR[st] || st}</div>`;

  // Deposit info in tooltip
  if (p.deposit_required && p.deposit_status) {
    const depAmt = ((p.deposit_amount_cents || 0) / 100).toFixed(2);
    const depLabel = p.deposit_status === 'paid' ? 'Pay\u00e9 \u2705' : p.deposit_status === 'refunded' ? 'Rembours\u00e9' : p.deposit_status === 'cancelled' ? 'Conserv\u00e9' : 'En attente';
    html += `<div class="tt-row" style="margin-top:4px;padding-top:4px;border-top:1px solid rgba(255,255,255,.15)"><span class="tt-icon">\ud83d\udcb0</span>Acompte : ${depAmt}\u20ac \u2014 ${depLabel}</div>`;
  }

  // Group: list members
  if (p._isGroup && p._members) {
    html += `<div style="margin-top:6px;padding-top:6px;border-top:1px solid rgba(255,255,255,.15)">`;
    p._members.forEach(m => {
      html += `<div class="tt-row"><span class="tt-icon">\u2022</span>${esc(m.service_name || 'RDV')} \u2014 ${esc(m.client_name || '')}</div>`;
    });
    html += `</div>`;
  }

  const tt = document.createElement('div');
  tt.className = 'fc-tooltip';
  tt.id = 'fcTooltip';
  tt.innerHTML = html;
  document.body.appendChild(tt);
  fcMoveTooltip(x, y);
}

function fcMoveTooltip(x, y) {
  const tt = document.getElementById('fcTooltip');
  if (!tt) return;
  const r = tt.getBoundingClientRect();
  let left = x + 12, top = y + 12;
  if (left + r.width > window.innerWidth - 8) left = x - r.width - 12;
  if (top + r.height > window.innerHeight - 8) top = y - r.height - 12;
  if (left < 8) left = 8;
  if (top < 8) top = 8;
  tt.style.left = left + 'px';
  tt.style.top = top + 'px';
}

function fcHideTooltip() {
  document.getElementById('fcTooltip')?.remove();
}

/**
 * Returns the `events` callback for FullCalendar (fetches bookings from API).
 */
function buildEventsCallback() {
  return function (info, successCb, failCb) {
    const params = new URLSearchParams({ from: info.startStr, to: info.endStr });
    if (calState.fcCurrentFilter !== 'all') params.set('practitioner_id', calState.fcCurrentFilter);
    fetch('/api/bookings?' + params.toString(), { headers: { 'Authorization': 'Bearer ' + api.getToken() } })
      .then(r => r.json()).then(d => {
        const bookings = d.bookings || [];
        const grouped = {}, singles = [];
        bookings.forEach(b => {
          if (b.group_id) {
            if (!grouped[b.group_id]) grouped[b.group_id] = [];
            grouped[b.group_id].push(b);
          } else { singles.push(b); }
        });

        const events = [];

        // Single events
        singles.forEach(b => {
          const frozen = ['completed', 'cancelled', 'no_show'].includes(b.status);
          const accent = b.booking_color || b.service_color || b.practitioner_color || '#0D7377';
          events.push({
            id: b.id, title: b.client_name || 'Sans nom',
            start: b.start_at, end: b.end_at,
            backgroundColor: fcHexAlpha(accent, 0.1), borderColor: accent, textColor: accent,
            editable: !frozen, durationEditable: !frozen,
            extendedProps: { ...b, _accent: accent }
          });
        });

        // Grouped events -> single container per group
        Object.keys(grouped).forEach(gid => {
          const members = grouped[gid].sort((a, b) => (a.group_order || 0) - (b.group_order || 0));
          const first = members[0], last = members[members.length - 1];
          const accent = first.booking_color || first.service_color || first.practitioner_color || '#0D7377';
          const anyFrozen = members.some(m => ['completed', 'cancelled', 'no_show'].includes(m.status));
          const minStart = members.reduce((mn, m) => m.start_at < mn ? m.start_at : mn, members[0].start_at);
          const maxEnd = members.reduce((mx, m) => m.end_at > mx ? m.end_at : mx, members[0].end_at);
          events.push({
            id: 'group_' + gid,
            title: first.client_name || 'Sans nom',
            start: minStart, end: maxEnd,
            backgroundColor: fcHexAlpha(accent, 0.1), borderColor: accent, textColor: accent,
            editable: !anyFrozen, durationEditable: false,
            extendedProps: {
              _isGroup: true, _groupId: gid, _accent: accent,
              _members: members.map(m => ({ ...m, _accent: m.booking_color || m.service_color || m.practitioner_color || accent })),
              client_name: first.client_name,
              practitioner_id: first.practitioner_id,
              status: first.status
            }
          });
        });

        // Filter by status visibility toggles
        const filtered = events.filter(ev => {
          const p = ev.extendedProps;
          if (p._isGroup) {
            const members = p._members || [];
            const allCancelled = members.every(m => m.status === 'cancelled');
            const allNoShow = members.every(m => m.status === 'no_show');
            if (allCancelled && !calState.fcShowCancelled) return false;
            if (allNoShow && !calState.fcShowNoShow) return false;
            return true;
          }
          if (p.status === 'cancelled' && !calState.fcShowCancelled) return false;
          if (p.status === 'no_show' && !calState.fcShowNoShow) return false;
          return true;
        });
        successCb(filtered);
      }).catch(e => failCb(e));
  };
}

/**
 * Returns the `eventContent` callback for custom rendering.
 */
function buildEventContent() {
  return function (arg) {
    const p = arg.event.extendedProps;
    const accent = p._accent || '#0D7377';
    const isMonth = arg.view.type === 'dayGridMonth';

    // -- Month view (same for singles and groups) --
    if (isMonth) {
      const t = arg.event.start ? arg.event.start.toLocaleTimeString('fr-BE', { hour: '2-digit', minute: '2-digit' }) : '';
      const name = (p.client_name || arg.event.title || '').split(' ')[0];
      const extra = p._isGroup ? ' <svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>' : (!p.service_name ? ' <svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z"/></svg>' : '');
      return { html: `<span class="ev-month-pill" style="color:${accent}">${t} <strong>${name}</strong>${extra}</span>` };
    }

    // -- Week/Day: group container --
    if (p._isGroup) {
      const members = p._members || [];
      const svcs = members.map(m => m.service_name || m.custom_label || 'RDV libre').join(' \u00b7 ');
      return { html: `<div class="ev-inner" style="color:${accent}"><span class="ev-client">${p.client_name || 'Groupe'} <span style="font-size:.58rem;opacity:.5"><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>${members.length}</span></span><span class="ev-service">${svcs}</span></div>` };
    }

    // -- Week/Day: single event --
    const svcLabel = p.service_name || p.custom_label || 'RDV libre';
    const depBadge = p.deposit_required ? (p.deposit_status === 'paid' ? '<span class="ev-badge-dep paid" title="Acompte pay\u00e9">\ud83d\udcb0\u2713</span>' : '<span class="ev-badge-dep" title="Acompte en attente">\ud83d\udcb0</span>') : '';
    const badges = [
      (p.internal_note ? '<span class="ev-badge ev-badge-note" style="background:' + accent + '"></span>' : ''),
      (p.status === 'modified_pending' ? '<span class="ev-badge ev-badge-mod"></span>' : '')
    ].filter(Boolean).join('');
    const freeTag = !p.service_name ? '<span style="font-size:.58rem;opacity:.6;margin-left:3px"><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z"/></svg></span>' : '';
    return { html: `<div class="ev-inner" style="color:${accent}"><span class="ev-client">${p.client_name || arg.event.title}${freeTag}${depBadge}</span><span class="ev-service">${svcLabel}</span>${badges ? '<div class="ev-badges">' + badges + '</div>' : ''}</div>` };
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
      const hasCancel = members.some(m => m.status === 'cancelled');
      const hasNoShow = members.some(m => m.status === 'no_show');
      const hasCompleted = members.every(m => m.status === 'completed');
      if (hasCancel) cls.push('ev-cancelled');
      else if (hasNoShow) cls.push('ev-no_show');
      else if (hasCompleted) cls.push('ev-completed');
    } else {
      cls.push('ev-' + (p.status || 'confirmed'));
    }
    return cls;
  };
}

/**
 * Returns the `eventDidMount` callback.
 */
function buildEventDidMount() {
  return function (info) {
    const p = info.event.extendedProps;
    const accent = p._accent || '#0D7377';

    // Ensure left border shows
    info.el.style.borderLeftWidth = '3px';
    info.el.style.borderLeftStyle = 'solid';
    info.el.style.borderLeftColor = accent;
    info.el.style.borderTopWidth = '0';
    info.el.style.borderRightWidth = '0';
    info.el.style.borderBottomWidth = '0';

    info.el.setAttribute('data-eid', info.event.id);

    // Resolve booking ID (for groups -> first member)
    const bookingId = p._isGroup ? p._members?.[0]?.id : info.event.id;

    // -- Tooltip (hover desktop only, tap touch) --
    const isTouch = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
    if (!isTouch) {
      info.el.addEventListener('mouseenter', function (e) {
        fcShowTooltip(info.event, e.clientX, e.clientY);
      });
      info.el.addEventListener('mousemove', function (e) {
        fcMoveTooltip(e.clientX, e.clientY);
      });
      info.el.addEventListener('mouseleave', function () {
        fcHideTooltip();
      });
    }

    // Desktop: native dblclick
    info.el.addEventListener('dblclick', function (e) {
      e.stopPropagation();
      fcHideTooltip();
      fcOpenDetail(bookingId);
    });

    // Touch: single tap -> tooltip (brief), double tap -> detail
    let lastTap = 0;
    info.el.addEventListener('touchend', function (e) {
      // Skip if touch was on resize handle or during drag/resize
      if (e.target.closest('.fc-event-resizer')) return;
      if (info.el.classList.contains('fc-event-dragging') || info.el.classList.contains('fc-event-resizing')) return;
      const now = Date.now();
      if (now - lastTap < 600) {
        e.preventDefault();
        fcHideTooltip();
        fcOpenDetail(bookingId);
        lastTap = 0;
      } else {
        lastTap = now;
        // Single tap -> show tooltip briefly, hide on next touch anywhere
        const touch = e.changedTouches?.[0];
        if (touch) {
          fcShowTooltip(info.event, touch.clientX, touch.clientY);
          clearTimeout(window._ttAutoHide);
          window._ttAutoHide = setTimeout(fcHideTooltip, 2500);
          // Hide tooltip on next touch anywhere
          const dismiss = function () { fcHideTooltip(); document.removeEventListener('touchstart', dismiss, true); };
          setTimeout(function () { document.addEventListener('touchstart', dismiss, true); }, 100);
        }
      }
    }, { passive: false });

    // Custom touch resize — bypasses FullCalendar's interaction plugin for reliable tablet resize
    if (isTouch) {
      const resizer = info.el.querySelector('.fc-event-resizer-end');
      if (resizer) {
        resizer.addEventListener('touchstart', function (e) {
          const frozen = ['completed', 'cancelled', 'no_show'].includes(p.status);
          if (frozen || p._isGroup) return;
          e.preventDefault();
          e.stopPropagation();

          const slot = document.querySelector('.fc-timegrid-slot');
          if (!slot || !info.event.end) return;
          const slotH = slot.getBoundingClientRect().height;
          const durStr = calState.fcCalOptions?.slotDuration || '00:15:00';
          const durParts = durStr.split(':');
          const slotMins = parseInt(durParts[0]) * 60 + parseInt(durParts[1]);

          const startY = e.touches[0].clientY;
          const origEnd = new Date(info.event.end);
          const origH = info.el.offsetHeight;
          let lastSlots = 0;

          info.el.classList.add('fc-event-dragging');
          info.el.style.setProperty('bottom', 'auto', 'important');
          info.el.style.zIndex = '999';

          function onMove(ev) {
            ev.preventDefault();
            const dy = ev.touches[0].clientY - startY;
            const ds = Math.round(dy / slotH);
            lastSlots = ds;
            const newH = origH + ds * slotH;
            if (newH >= slotH) info.el.style.height = newH + 'px';
          }

          function onEnd() {
            document.removeEventListener('touchmove', onMove);
            document.removeEventListener('touchend', onEnd);
            info.el.classList.remove('fc-event-dragging');
            info.el.style.removeProperty('bottom');
            info.el.style.removeProperty('height');
            info.el.style.removeProperty('z-index');
            if (lastSlots === 0) return;

            const newEnd = new Date(origEnd.getTime() + lastSlots * slotMins * 60000);
            if (newEnd <= info.event.start) return;
            info.event.setEnd(newEnd);

            fetch('/api/bookings/' + info.event.id + '/resize', {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + api.getToken() },
              body: JSON.stringify({ end_at: newEnd.toISOString() })
            }).then(function (r) {
              if (!r.ok) return r.json().then(function (d) { throw new Error(d.error || 'Erreur'); });
              var dur = Math.round((newEnd - info.event.start) / 60000);
              gToast('Durée → ' + dur + ' min', 'success');
            }).catch(function (err) {
              info.event.setEnd(origEnd);
              calState.fcCal.refetchEvents();
              var msg = (err.message || '').includes('hevauche') || (err.message || '').includes('créneau')
                ? 'Chevauchement — durée non modifiée' : (err.message || 'Erreur');
              gToast(msg, 'error');
            });
          }

          document.addEventListener('touchmove', onMove, { passive: false });
          document.addEventListener('touchend', onEnd);
        }, { passive: false });
      }
    }
  };
}

/**
 * Returns the `dateClick` callback.
 */
function buildDateClick() {
  return function (info) {
    if (calState.fcCal?.view?.type === 'dayGridMonth') return;
    const now = Date.now();
    if (window._fcLastDateClick && now - window._fcLastDateClick < 600 && window._fcLastDateClickDate === info.dateStr) {
      fcOpenQuickCreate(info.dateStr);
      window._fcLastDateClick = 0;
    } else {
      window._fcLastDateClick = now;
      window._fcLastDateClickDate = info.dateStr;
    }
  };
}

/**
 * Returns the `eventDrop` callback (drag & drop move).
 */
function buildEventDrop() {
  return async function (info) {
    const ev = info.event, p = ev.extendedProps;
    try {
      // For group containers, move the first member -- backend moves siblings
      const bookingId = p._isGroup ? p._members[0].id : ev.id;
      const pracId = p._isGroup ? p._members[0].practitioner_id : p.practitioner_id;
      const r = await fetch(`/api/bookings/${bookingId}/move`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + api.getToken() },
        body: JSON.stringify({ start_at: ev.start.toISOString(), end_at: ev.end.toISOString(), practitioner_id: pracId })
      });
      if (!r.ok) { const d = await r.json(); throw new Error(d.error || 'Erreur'); }
      const result = await r.json();
      gToast(result.group_moved ? `${p.client_name || 'Client'} \u2014 ${result.count} prestations d\u00e9plac\u00e9es` : (p.client_name || 'RDV') + ' d\u00e9plac\u00e9', 'success');
      calState.fcCal.refetchEvents();
    } catch (e) {
      // Save target date BEFORE revert (revert resets event.start to original)
      const targetDate = info.event.start.toISOString().split('T')[0];
      info.revert();
      const isCollision = e.message.includes('hevauche') || e.message.includes('pris') || e.message.includes('occup\u00e9');
      // In month view + collision -> offer to switch to day view for precise placement
      if (isCollision && calState.fcCal?.view?.type === 'dayGridMonth') {
        window._atPendingDaySwitch = targetDate;
        gToast('<svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/></svg> Cr\u00e9neau occup\u00e9 \u2014 voir le jour pour replacer ?', 'error', { label: 'Voir le jour \u2192', fn: `atView('timeGridDay');fcCal.gotoDate(window._atPendingDaySwitch);document.getElementById('gToast').style.display='none'` });
      } else {
        gToast(isCollision ? '<svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/></svg> Cr\u00e9neau occup\u00e9 \u2014 impossible de d\u00e9placer ici' : e.message, 'error');
      }
    }
  };
}

/**
 * Returns the `eventResize` callback.
 */
function buildEventResize() {
  return async function (info) {
    const ev = info.event;
    try {
      const r = await fetch(`/api/bookings/${ev.id}/resize`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + api.getToken() },
        body: JSON.stringify({ end_at: ev.end.toISOString() })
      });
      if (!r.ok) { const d = await r.json(); throw new Error(d.error || 'Erreur'); }
      const dur = Math.round((ev.end - ev.start) / 60000);
      gToast('Dur\u00e9e \u2192 ' + dur + ' min', 'success');
    } catch (e) {
      info.revert();
      gToast(e.message.includes('hevauche') || e.message.includes('cr\u00e9neau')
        ? '<svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/></svg> Chevauchement \u2014 dur\u00e9e non modifi\u00e9e'
        : e.message, 'error');
    }
  };
}

/**
 * Returns the `eventOverlap` callback.
 */
function buildEventOverlap() {
  return function (stillEvent, movingEvent) {
    if (calState.fcAllowOverlap) return true;
    // Group container vs its own members -> always allow
    const sg = stillEvent.extendedProps?._groupId, mg = movingEvent?.extendedProps?._groupId;
    if (sg && mg && sg === mg) return true;
    const sp = stillEvent.extendedProps?.practitioner_id;
    const mp = movingEvent?.extendedProps?.practitioner_id;
    if (sp && mp && sp !== mp) return true;
    const st = stillEvent.extendedProps?.status;
    if (['cancelled', 'completed', 'no_show'].includes(st)) return true;
    return false;
  };
}

/**
 * Returns the `eventAllow` callback.
 */
function buildEventAllow() {
  return function (dropInfo, draggedEvent) {
    const dropDay = dropInfo.start.getDay();
    if (calState.fcHiddenDays.includes(dropDay)) return false;

    // Month view: dropInfo has all-day range (midnight->midnight), so we can't do
    // precise overlap checks here. Allow drop with basic checks; backend validates.
    if (calState.fcCal?.view?.type === 'dayGridMonth') {
      const origStart = draggedEvent.start;
      const newDate = dropInfo.start;
      const actualStart = new Date(newDate.getFullYear(), newDate.getMonth(), newDate.getDate(), origStart.getHours(), origStart.getMinutes());
      return actualStart >= new Date();
    }

    const effectiveStart = dropInfo.start;
    const effectiveEnd = dropInfo.end;

    if (calState.fcAllowOverlap) return effectiveStart >= new Date();
    const myPrac = draggedEvent.extendedProps?.practitioner_id;
    if (!myPrac) return true;
    if (effectiveStart < new Date()) return false;
    const myGroupId = draggedEvent.extendedProps?._groupId;
    const newStart = dropInfo.start, newEnd = dropInfo.end;
    const allEvents = calState.fcCal.getEvents();
    for (const ev of allEvents) {
      if (ev.id === draggedEvent.id) continue;
      if (myGroupId && ev.extendedProps?._groupId === myGroupId) continue;
      if (ev.extendedProps?.practitioner_id !== myPrac) continue;
      const st = ev.extendedProps?.status;
      if (st === 'cancelled' || st === 'no_show' || st === 'completed') continue;
      if (ev.start < newEnd && ev.end > newStart) return false;
    }
    return true;
  };
}

export {
  fcShowTooltip, fcMoveTooltip, fcHideTooltip,
  buildEventsCallback, buildEventContent, buildEventClassNames,
  buildEventDidMount, buildDateClick, buildEventDrop, buildEventResize,
  buildEventOverlap, buildEventAllow
};
