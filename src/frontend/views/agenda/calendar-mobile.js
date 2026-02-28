/**
 * Calendar Mobile - list view for mobile, day shifting.
 */
import { api, calState } from '../../state.js';
import { esc } from '../../utils/dom.js';
import { ST_LABELS, MODE_ICO, DAY_NAMES, MONTH_NAMES } from '../../utils/format.js';
import { bridge } from '../../utils/window-bridge.js';

async function fcLoadMobileList() {
  const el = document.getElementById('fcMobList');
  if (!el) return;
  const ds = calState.fcMobileDate.toISOString().split('T')[0];
  const from = ds + 'T00:00:00', to = ds + 'T23:59:59';
  try {
    const params = new URLSearchParams({ from, to });
    if (calState.fcCurrentFilter !== 'all') params.set('practitioner_id', calState.fcCurrentFilter);
    const r = await fetch('/api/bookings?' + params.toString(), { headers: { 'Authorization': 'Bearer ' + api.getToken() } });
    const d = await r.json();
    calState.fcAllBookings = d.bookings || [];
  } catch (e) { calState.fcAllBookings = []; }

  // Apply status visibility filter
  calState.fcAllBookings = calState.fcAllBookings.filter(b => {
    if (b.status === 'cancelled' && !calState.fcShowCancelled) return false;
    if (b.status === 'no_show' && !calState.fcShowNoShow) return false;
    return true;
  });

  const isToday = ds === new Date().toISOString().split('T')[0];
  const dayLabel = isToday ? "Aujourd'hui" : `${DAY_NAMES[calState.fcMobileDate.getDay()]} ${calState.fcMobileDate.getDate()} ${MONTH_NAMES[calState.fcMobileDate.getMonth()]}`;

  let h = `<div class="mob-list-header"><span class="mob-list-date">${dayLabel}</span><span class="mob-list-count">${calState.fcAllBookings.length} RDV</span></div>`;

  if (!calState.fcAllBookings.length) {
    h += `<div class="mob-empty"><div class="mob-empty-icon"><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg></div><div class="mob-empty-text">Aucun rendez-vous</div><div class="mob-empty-sub">${dayLabel}</div></div>`;
  } else {
    const sorted = [...calState.fcAllBookings].sort((a, b) => new Date(a.start_at) - new Date(b.start_at));
    sorted.forEach(b => {
      const s = new Date(b.start_at), e = new Date(b.end_at);
      const t1 = s.toLocaleTimeString('fr-BE', { hour: '2-digit', minute: '2-digit' });
      const dur = Math.round((e - s) / 60000);
      const prac = calState.fcPractitioners.find(p => p.id === b.practitioner_id);
      const stLabel = ST_LABELS[b.status] || b.status;
      const stClass = 'st-' + b.status;
      const badges = [
        (b.internal_note ? '<svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>' : ''),
        (b.status === 'modified_pending' ? '<svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>' : ''),
        (b.group_id ? '<svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>' : '')
      ].filter(Boolean);
      h += `<div class="mob-bk ${stClass}" onclick="fcOpenDetail('${b.id}')">
        ${badges.length ? '<div class="mob-bk-badges">' + badges.map(x => '<span>' + x + '</span>').join('') + '</div>' : ''}
        <div class="mob-bk-time"><div class="t">${t1}</div><div class="dur">${dur}min</div></div>
        <div class="mob-bk-info"><div class="name">${esc(b.client_name)}</div><div class="svc">${b.service_name || b.custom_label || 'RDV libre'} \u00b7 ${MODE_ICO[b.appointment_mode] || ''}</div><div class="prac"><span class="pdot" style="background:${prac?.color || 'var(--primary)'}"></span>${prac?.display_name || b.practitioner_name || ''}</div></div>
        <div class="mob-bk-status status-badge ${stClass}">${stLabel}</div>
      </div>`;
    });
  }
  el.innerHTML = h;
}

function fcMobShift(dir) {
  calState.fcMobileDate.setDate(calState.fcMobileDate.getDate() + dir);
  fcLoadMobileList();
  // Sync calendar too
  calState.fcCal.gotoDate(calState.fcMobileDate);
}

function fcMobToday() {
  calState.fcMobileDate = new Date();
  fcLoadMobileList();
  calState.fcCal.today();
}

// Expose to global scope for onclick handlers
bridge({ fcMobShift, fcMobToday });

export { fcLoadMobileList, fcMobShift, fcMobToday };
